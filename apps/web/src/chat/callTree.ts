import type { RunEvent, RunEventOf, RunStatus, StepRecord } from 'protocol';
import { totalsOf, type Totals } from './totals';

/** 1ターン分の表示内容 */
export type CallTree = {
  /** メインエージェントより前に実行したフローの段。段の実行はターン全体のツールコールとして記録される */
  stages: ToolCallView[];
  /** メインエージェントの呼び出し。まだ始まっていなければ undefined */
  root: CallView | undefined;
  /** フローの段とメインエージェントを合わせた、ターン全体のステップの集計 */
  totals: Totals;
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
  /** LLM へのリクエストを行った順 */
  steps: StepView[];
  /** サブエージェントのステップも含めた集計 */
  totals: Totals;
  /** どのツールコールにも対応付けられなかった記録 */
  notes: CallNote[];
};

/** LLM への1リクエストと、その応答で行ったツールコール */
export type StepView = {
  index: number;
  /** ステップの結果。ツールの実行も終わってから届くので、それまでは undefined */
  record?: StepRecord;
  tools: ToolCallView[];
};

/** ツールコール1回分。サブエージェント呼び出しやフローの段を含む */
export type ToolCallView = {
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

/** ターンのイベント列から、フローの段とメインエージェントを根とする呼び出しの入れ子を組み立てる */
export function buildCallTree(events: RunEvent[]): CallTree {
  const calls = new Map<string, CallView>();
  const tree: CallTree = { stages: [], root: undefined, totals: totalsOf([]), notes: [] };
  /**
   * callId の呼び出しで行ったツールコール。どの呼び出しでもない（ターン全体の）ものならフローの段。
   * ツールは呼び出しごとに呼ばれた順で1つずつ実行されるので、結果が届いていない最初のものが実行中のものになる。
   */
  const toolsOf = (callId: string) => calls.get(callId)?.steps.flatMap((step) => step.tools) ?? tree.stages;

  for (const event of events) {
    const call = calls.get(event.callId);
    switch (event.type) {
      case 'call.start': {
        const created: CallView = { callId: event.callId, nodeId: event.nodeId, task: event.task, status: 'running', error: null, steps: [], totals: totalsOf([]), notes: [] };
        calls.set(event.callId, created);
        const tool = event.parentCallId ? toolsOf(event.parentCallId).find((t) => t.toolCallId === event.toolCallId) : undefined;
        if (tool) tool.child = created;
        else if (!event.parentCallId) tree.root = created;
        break;
      }
      case 'step.start':
        call?.steps.push({ index: event.index, tools: [] });
        break;
      case 'tool.call': {
        const tool: ToolCallView = { toolCallId: event.toolCallId, toolName: event.toolName, input: event.input, startedAt: event.at, notes: [] };
        if (call) openStep(call).tools.push(tool);
        else tree.stages.push(tool);
        break;
      }
      case 'tool.result': {
        const tool = toolsOf(event.callId).find((t) => t.toolCallId === event.toolCallId);
        if (tool) tool.result = { output: event.output, isError: event.isError, durationMs: event.at - tool.startedAt };
        break;
      }
      case 'log':
      case 'file.change': {
        const note: CallNote = event.type === 'log' ? { type: event.type, level: event.level, message: event.message } : { type: event.type, volume: event.volume, path: event.path, deleted: event.deleted };
        (toolsOf(event.callId).find((t) => !t.result)?.notes ?? call?.notes ?? tree.notes).push(note);
        break;
      }
      case 'step.finish':
        if (!call) break;
        openStep(call).record = event.step;
        break;
      case 'call.finish':
        if (!call) break;
        call.status = event.status;
        call.error = event.error;
        break;
    }
  }
  const stageRecords = tree.stages.flatMap((stage) => (stage.child ? fillTotals(stage.child) : []));
  tree.totals = totalsOf([...stageRecords, ...(tree.root ? fillTotals(tree.root) : [])]);
  return tree;
}

/**
 * 結果が届いていないステップ。なければ作る。
 * step.start を記録していなかった頃のイベント列では、ステップの区切りを step.finish だけで判断する。
 */
function openStep(call: CallView): StepView {
  const last = call.steps.at(-1);
  if (last && !last.record) return last;
  const created: StepView = { index: call.steps.length, tools: [] };
  call.steps.push(created);
  return created;
}

/** 呼び出しとその中のサブエージェントの totals を埋め、それらのステップの結果をすべて返す */
function fillTotals(call: CallView): StepRecord[] {
  const records = call.steps.flatMap((step) => [...(step.record ? [step.record] : []), ...step.tools.flatMap((t) => (t.child ? fillTotals(t.child) : []))]);
  call.totals = totalsOf(records);
  return records;
}
