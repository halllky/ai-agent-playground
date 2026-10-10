import type { RunEvent, RunEventOf, RunStatus, StepRecord } from 'protocol';
import { totalsOf, type Totals } from './totals.ts';

/** 1ターン分の表示内容 */
export type CallTree = {
  /** メインエージェントの呼び出し。まだ始まっていなければ undefined */
  root: CallView | undefined;
  /** どの呼び出しにも属さない、ターン全体についての記録 */
  notes: CallNote[];
};

/** エージェント呼び出し1回分の表示内容 */
export type CallView = {
  callId: string;
  nodeId: string;
  task: string;
  status: RunStatus;
  error: string | null;
  items: CallItem[];
  /** この呼び出し自身のステップ。サブエージェントのものは含めない */
  steps: StepRecord[];
  /** サブエージェントのステップも含めた集計 */
  totals: Totals;
  /** どのツールコールにも対応付けられなかった記録 */
  notes: CallNote[];
};

/** 呼び出しの中に時系列で並べる要素。テキストか、ツールコール（サブエージェント呼び出しを含む） */
export type CallItem =
  | { kind: 'text'; stepIndex: number; text: string; aborted: boolean }
  | {
      kind: 'tool';
      toolCallId: string;
      toolName: string;
      input: unknown;
      startedAt: number;
      result?: { output: unknown; isError: boolean; durationMs: number };
      /** ツールの実行中に出たログやファイルの変更 */
      notes: CallNote[];
      /** このツールコールがサブエージェント呼び出しなら、その中身 */
      child?: CallView;
    };

/** 応答の本文とは別に残る記録 */
export type CallNote = Pick<RunEventOf<'log'>, 'type' | 'level' | 'message'> | Pick<RunEventOf<'file.change'>, 'type' | 'volume' | 'path' | 'deleted'>;

/**
 * ターンのイベント列から、メインエージェントを根とする呼び出しの入れ子を組み立てる。
 * ステップのテキストは step.finish で届くが、表示上はそのステップのツールコールより前に置く。
 */
export function buildCallTree(events: RunEvent[]): CallTree {
  const calls = new Map<string, CallView & { stepStart: number }>();
  const tree: CallTree = { root: undefined, notes: [] };

  for (const event of events) {
    const call = calls.get(event.callId);
    switch (event.type) {
      case 'call.start': {
        const created = {
          callId: event.callId,
          nodeId: event.nodeId,
          task: event.task,
          status: 'running' as const,
          error: null,
          items: [],
          steps: [],
          totals: totalsOf([]),
          notes: [],
          stepStart: 0,
        };
        calls.set(event.callId, created);
        const parent = event.parentCallId ? calls.get(event.parentCallId) : undefined;
        const toolItem = parent?.items.find((i) => i.kind === 'tool' && i.toolCallId === event.toolCallId);
        if (toolItem?.kind === 'tool') toolItem.child = created;
        else if (!event.parentCallId) tree.root = created;
        break;
      }
      case 'tool.call':
        call?.items.push({ kind: 'tool', toolCallId: event.toolCallId, toolName: event.toolName, input: event.input, startedAt: event.at, notes: [] });
        break;
      case 'tool.result': {
        const item = call?.items.find((i) => i.kind === 'tool' && i.toolCallId === event.toolCallId);
        if (item?.kind === 'tool') item.result = { output: event.output, isError: event.isError, durationMs: event.at - item.startedAt };
        break;
      }
      case 'log':
      case 'file.change': {
        const note: CallNote = event.type === 'log' ? { type: event.type, level: event.level, message: event.message } : { type: event.type, volume: event.volume, path: event.path, deleted: event.deleted };
        if (!call) tree.notes.push(note);
        else (runningTool(call)?.notes ?? call.notes).push(note);
        break;
      }
      case 'step.finish':
        if (!call) break;
        call.steps.push(event.step);
        if (event.step.text) call.items.splice(call.stepStart, 0, { kind: 'text', stepIndex: event.step.index, text: event.step.text, aborted: event.step.aborted });
        call.stepStart = call.items.length;
        break;
      case 'call.finish':
        if (!call) break;
        call.status = event.status;
        call.error = event.error;
        break;
    }
  }
  if (tree.root) fillTotals(tree.root);
  return tree;
}

/**
 * 呼び出しの中で実行中のツールコール。
 * ツールは呼び出しごとに呼ばれた順で1つずつ実行されるので、結果が届いていない最初のものが実行中のものになる。
 */
function runningTool(call: CallView) {
  const item = call.items.find((i) => i.kind === 'tool' && !i.result);
  return item?.kind === 'tool' ? item : undefined;
}

/** 呼び出しとその中のサブエージェントの totals を埋め、それらのステップをすべて返す */
function fillTotals(call: CallView): StepRecord[] {
  const steps = [...call.steps, ...call.items.flatMap((i) => (i.kind === 'tool' && i.child ? fillTotals(i.child) : []))];
  call.totals = totalsOf(steps);
  return steps;
}
