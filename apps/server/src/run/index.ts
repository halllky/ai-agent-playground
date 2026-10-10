import type { ModelMessage } from 'ai';
import { asc, eq, inArray, max } from 'drizzle-orm';
import { findMainAgent, resourceSpecOf, type GraphDefinition, type RunEvent, type RunEventBody } from 'protocol';
import { db, lineageOf, runEvents, turns } from '../db/index.ts';
import { callAgent, type AgentCallOutcome, type CallHeader, type RunScope } from './agentCall.ts';
import { Volume } from '../volume/index.ts';
import type { TurnMemory } from './memory.ts';

type RunListener = (event: RunEvent) => void;

const activeRuns = new Map<string, Run>();

/** 保存済みのターンの実行をバックグラウンドで始める */
export function startTurn(turn: { id: string; parentTurnId: string | null; userText: string; graph: GraphDefinition }): void {
  const run = new Run(turn.id, turn.graph);
  activeRuns.set(turn.id, run);
  void run.execute(turn.parentTurnId, turn.userText).finally(() => activeRuns.delete(turn.id));
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
  return { live: run !== undefined, stop: run?.subscribe(listener) ?? (() => {}) };
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
      ...turnHeaderOf(id),
      type: 'turn.finish',
      status: 'error',
      error: 'サーバーの停止により中断されました',
    };
    db.insert(runEvents).values({ turnId: id, seq: event.seq!, event }).run();
    db.update(turns).set({ status: 'error' }).where(eq(turns.id, id)).run();
  }
}

/** 実行中のターン1件。イベントの採番・永続化と購読者への配信を受け持つ */
class Run implements RunScope {
  readonly signal: AbortSignal;
  readonly turnMemory: TurnMemory = new Map();
  private readonly controller = new AbortController();
  private readonly listeners = new Set<RunListener>();
  private seq = 0;

  constructor(
    readonly turnId: string,
    readonly graph: GraphDefinition,
  ) {
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
    const event: RunEvent = { turnId: this.turnId, seq: live ? null : ++this.seq, at: Date.now(), ...header, ...body };
    if (!live) db.insert(runEvents).values({ turnId: this.turnId, seq: event.seq!, event }).run();
    for (const listener of this.listeners) listener(event);
  }

  async execute(parentTurnId: string | null, userText: string): Promise<void> {
    const turnHeader = turnHeaderOf(this.turnId);
    const main = findMainAgent(this.graph);
    if (!main) {
      this.finish(turnHeader, 'error', [], 'メインエージェントがありません');
      return;
    }

    this.seedResources(turnHeader);
    try {
      const outcome = await callAgent(this, {
        node: main,
        parentCallId: null,
        toolCallId: null,
        depth: 0,
        settings: null,
        task: userText,
        messages: [...conversationBefore(parentTurnId), { role: 'user', content: userText }],
      });
      this.finish(turnHeader, outcome.status, outcome.responseMessages, outcome.error);
    } catch (e) {
      this.finish(turnHeader, 'error', [], e instanceof Error ? e.message : String(e));
    }
  }

  /** リソースノードの設定のファイルを、この会話でまだ使われていなければ写す。以降の編集はこの会話の中だけに効く */
  private seedResources(header: CallHeader): void {
    for (const node of this.graph.nodes) {
      if (node.kind !== 'resource') continue;
      const spec = resourceSpecOf(node);
      const volume = new Volume(this.turnId, spec);
      for (const failure of volume.seed(node.config.files)) {
        this.emit(header, { type: 'log', level: 'warn', message: `リソース ${node.config.name} のファイルを写せませんでした: ${failure}` });
      }
    }
  }

  private finish(header: CallHeader, status: AgentCallOutcome['status'], mainMessages: ModelMessage[], error: string | null) {
    db.update(turns).set({ status, mainMessages }).where(eq(turns.id, this.turnId)).run();
    this.emit(header, { type: 'turn.finish', status, error });
  }
}

/** どの呼び出しにも属さない、ターン全体についてのイベントのヘッダ */
function turnHeaderOf(turnId: string): CallHeader {
  return { callId: turnId, parentCallId: null, nodeId: '' };
}

/** parentTurnId までの分岐をたどった、メインエージェントから見た会話履歴 */
function conversationBefore(parentTurnId: string | null): ModelMessage[] {
  if (!parentTurnId) return [];
  const lineage = lineageOf(parentTurnId).reverse();
  const rows = db.select().from(turns).where(inArray(turns.id, lineage)).all();
  return lineage.flatMap((id) => {
    const turn = rows.find((r) => r.id === id)!;
    return [{ role: 'user', content: turn.userText } satisfies ModelMessage, ...turn.mainMessages];
  });
}
