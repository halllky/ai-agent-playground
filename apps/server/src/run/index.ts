import { randomUUID } from 'node:crypto';
import type { ModelMessage } from 'ai';
import { asc, eq, max } from 'drizzle-orm';
import { pathInFolder, type GraphDefinition, type RunEvent, type RunEventBody, type TurnFiles, type TurnRecord, type WorkfolderFiles } from 'protocol';
import { db, runEvents, turns, type TurnState } from '../db/index.ts';
import { runFlow, type FlowOutcome } from './flow.ts';
import { turnHeader, type CallHeader, type RunScope } from './invoke.ts';
import { FileError, Workfolder } from './nodes/files.ts';

type RunListener = (event: RunEvent) => void;

const activeRuns = new Map<string, Run>();

/**
 * 新しいターンを保存し、その実行をバックグラウンドで始める。
 * ターンの状態は親ターンが終わった時点の写しから始めるので、過去ターンからやり直した分岐では、分岐元の時点の状態に戻る
 */
export function startTurn(sessionId: string, graph: GraphDefinition, parentTurnId: string | null, userText: string): TurnRecord {
  const row: typeof turns.$inferSelect = {
    id: randomUUID(),
    sessionId,
    parentTurnId,
    userText,
    graph,
    status: 'running',
    reply: '',
    state: stateAfter(parentTurnId),
    createdAt: Date.now(),
  };
  db.insert(turns).values(row).run();
  const run = new Run(row);
  activeRuns.set(row.id, run);
  void run.execute().finally(() => activeRuns.delete(row.id));
  const { state: _, ...record } = row;
  return record;
}

/** 実行中のターンを止める。実行中でなければ false */
export function abortTurn(turnId: string): boolean {
  const run = activeRuns.get(turnId);
  run?.abort();
  return run !== undefined;
}

/**
 * ターンのイベントを、保存済みのものから順に listener へ渡し、実行中なら以降のイベントも渡し続ける。
 * live が false なら実行は終わっていて、以降のイベントは来ない。
 */
export function followTurn(turnId: string, listener: RunListener): { live: boolean; stop: () => void } {
  // 保存済みイベントの読み出しと購読開始を同期的に行うことで、その間に発生したイベントの取りこぼしを防いでいる
  const saved = db.select().from(runEvents).where(eq(runEvents.turnId, turnId)).orderBy(asc(runEvents.seq)).all();
  for (const row of saved) listener(row.event);
  const run = activeRuns.get(turnId);
  return { live: run !== undefined, stop: run?.subscribe(listener) ?? (() => { }) };
}

/**
 * ターン時点（実行中なら今）のワークフォルダと、親ターンの時点から変わったパス。ターンが無ければ undefined。
 * このターンで設定から写した初期ファイルも、変わったものに含まれる
 */
export function turnFiles(turnId: string): TurnFiles | undefined {
  const turn = db.select({ parentTurnId: turns.parentTurnId, state: turns.state }).from(turns).where(eq(turns.id, turnId)).get();
  if (!turn) return undefined;
  return { files: turn.state.files, changed: changedPaths(stateAfter(turn.parentTurnId).files, turn.state.files) };
}

/** サーバー停止で中断されたまま残っているターンを、エラー終了として閉じる */
export function closeInterruptedTurns(): void {
  const interrupted = db.select({ id: turns.id }).from(turns).where(eq(turns.status, 'running')).all();
  for (const { id } of interrupted) {
    const last = db.select({ seq: max(runEvents.seq) }).from(runEvents).where(eq(runEvents.turnId, id)).get();
    const event: RunEvent = {
      turnId: id,
      seq: (last?.seq ?? 0) + 1,
      at: Date.now(),
      ...turnHeader,
      type: 'turn.finish',
      status: 'error',
      reply: '',
      error: 'サーバーの停止により中断されました',
    };
    db.insert(runEvents).values({ turnId: id, seq: event.seq!, event }).run();
    db.update(turns).set({ status: 'error' }).where(eq(turns.id, id)).run();
  }
}

/** 実行中のターン1件。イベントの採番・永続化と購読者への配信、状態の保存を受け持つ */
class Run implements RunScope {
  readonly graph: GraphDefinition;
  readonly state: TurnState;
  readonly signal: AbortSignal;
  readonly turnMemory = new Map<string, ModelMessage[]>();
  readonly conversation: ModelMessage[];
  private readonly controller = new AbortController();
  private readonly listeners = new Set<RunListener>();
  private seq = 0;

  constructor(private readonly turn: typeof turns.$inferSelect) {
    this.graph = turn.graph;
    this.state = turn.state;
    this.conversation = conversationBefore(turn.parentTurnId);
    this.signal = this.controller.signal;
  }

  abort(): void {
    this.controller.abort();
  }

  subscribe(listener: RunListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(header: CallHeader, body: RunEventBody): void {
    const live = body.type === 'text.delta';
    const event: RunEvent = { turnId: this.turn.id, seq: live ? null : ++this.seq, at: Date.now(), ...header, ...body };
    if (!live) db.insert(runEvents).values({ turnId: this.turn.id, seq: event.seq!, event }).run();
    for (const listener of this.listeners) listener(event);
  }

  saveState(): void {
    db.update(turns).set({ state: this.state }).where(eq(turns.id, this.turn.id)).run();
  }

  async execute(): Promise<void> {
    let outcome: FlowOutcome;
    try {
      this.seedFiles();
      outcome = await runFlow(this, this.turn.userText);
    } catch (e) {
      outcome = { status: 'error', reply: '', error: e instanceof Error ? e.message : String(e) };
    }
    db.update(turns).set({ status: outcome.status, reply: outcome.reply }).where(eq(turns.id, this.turn.id)).run();
    this.emit(turnHeader, { type: 'turn.finish', ...outcome });
  }

  /**
   * files ノードの初期ファイルを、この会話でまだ写していなければワークフォルダに写す。以降の編集はこの会話の中だけに効く。
   * 同じパスのファイルがすでにあれば、会話の中の中身を残して写さない
   */
  private seedFiles(): void {
    const workfolder = new Workfolder(this.state.files, () => {});
    for (const node of this.graph.nodes) {
      if (node.kind !== 'files' || this.state.seededFolders.includes(node.id)) continue;
      this.state.seededFolders.push(node.id);
      for (const file of node.config.files) {
        const path = pathInFolder(node.config.path, file.path);
        if (workfolder.has(path)) continue;
        try {
          workfolder.write(path, file.content);
        } catch (e) {
          if (!(e instanceof FileError)) throw e;
          this.emit(turnHeader, { type: 'log', level: 'warn', message: `初期ファイル ${path} を写せませんでした: ${e.message}` });
        }
      }
    }
    this.saveState();
  }
}

/** parentTurnId のターンが終わった時点の状態の写し。会話の先頭なら空 */
function stateAfter(parentTurnId: string | null): TurnState {
  const parent = parentTurnId ? db.select({ state: turns.state }).from(turns).where(eq(turns.id, parentTurnId)).get() : undefined;
  return parent?.state ?? { files: {}, seededFolders: [], memories: {} };
}

/** before から after までに追加・変更・削除されたパス */
function changedPaths(before: WorkfolderFiles, after: WorkfolderFiles): string[] {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((path) => before[path] !== after[path]).sort();
}

/** parentTurnId までの分岐をたどった、ユーザーの発言と返答の会話 */
function conversationBefore(parentTurnId: string | null): ModelMessage[] {
  const messages: ModelMessage[] = [];
  for (let id = parentTurnId; id; ) {
    const turn = db
      .select({ parentTurnId: turns.parentTurnId, userText: turns.userText, reply: turns.reply })
      .from(turns)
      .where(eq(turns.id, id))
      .get();
    if (!turn) break;
    messages.unshift({ role: 'user', content: turn.userText }, { role: 'assistant', content: turn.reply });
    id = turn.parentTurnId;
  }
  return messages;
}
