import type { RunEvent, RunEventOf, RunStatus, StepRecord } from 'protocol';
import { totalsOf, type Totals } from './totals.tsx';

/** 1ターン分の表示内容 */
export type TurnTree = {
  /** フローから呼ばれた、ターンの最上位の呼び出しを実行順に */
  calls: CallView[];
  /** ターン全体のステップの集計 */
  totals: Totals;
  /** ターン全体についての記録（フローで飛ばしたノードなど） */
  logs: TurnLog[];
};

/** ノードの呼び出し1回分の表示内容 */
export type CallView = {
  callId: string;
  nodeId: string;
  input: string;
  status: RunStatus;
  /** 呼び出し元へ返した出力。終わるまでは null */
  output: string | null;
  error: string | null;
  /** LLM へのリクエストを行った順。エージェント以外では空 */
  steps: StepView[];
  /** 入れ子の呼び出しのステップも含めた集計 */
  totals: Totals;
};

/** LLM への1リクエストと、その応答で行ったツールコール */
export type StepView = {
  index: number;
  /** ステップの結果。ツールの実行も終わってから届くので、それまでは undefined */
  record?: StepRecord;
  tools: ToolCallView[];
};

/** ツールコール1回分 */
export type ToolCallView = {
  toolCallId: string;
  toolName: string;
  input: unknown;
  startedAt: number;
  result?: { output: unknown; isError: boolean; durationMs: number };
  /** このツールコールがノードの呼び出しなら、その中身 */
  child?: CallView;
};

/** ターン全体についての記録1件 */
export type TurnLog = Pick<RunEventOf<'log'>, 'level' | 'message'>;

/** ターンのイベント列から、呼び出しの入れ子を組み立てる */
export function buildTurnTree(events: RunEvent[]): TurnTree {
  const calls = new Map<string, CallView>();
  const tree: TurnTree = { calls: [], totals: totalsOf([]), logs: [] };
  /** 呼び出しで行ったツールコール */
  const toolsOf = (call: CallView) => call.steps.flatMap((step) => step.tools);

  for (const event of events) {
    const call = event.callId ? calls.get(event.callId) : undefined;
    switch (event.type) {
      case 'call.start': {
        const created: CallView = {
          callId: event.callId!,
          nodeId: event.nodeId!,
          input: event.input,
          status: 'running',
          output: null,
          error: null,
          steps: [],
          totals: totalsOf([]),
        };
        calls.set(created.callId, created);
        const parent = event.parentCallId ? calls.get(event.parentCallId) : undefined;
        const tool = parent && toolsOf(parent).find((t) => t.toolCallId === event.toolCallId);
        if (tool) tool.child = created;
        else tree.calls.push(created);
        break;
      }
      case 'step.start':
        call?.steps.push({ index: event.index, tools: [] });
        break;
      case 'tool.call':
        call?.steps.at(-1)?.tools.push({ toolCallId: event.toolCallId, toolName: event.toolName, input: event.input, startedAt: event.at });
        break;
      case 'tool.result': {
        const tool = call && toolsOf(call).find((t) => t.toolCallId === event.toolCallId);
        if (tool) tool.result = { output: event.output, isError: event.isError, durationMs: event.at - tool.startedAt };
        break;
      }
      case 'log':
        tree.logs.push({ level: event.level, message: event.message });
        break;
      case 'step.finish': {
        const step = call?.steps.at(-1);
        if (step) step.record = event.step;
        break;
      }
      case 'call.finish':
        if (!call) break;
        call.status = event.status;
        call.output = event.output;
        call.error = event.error;
        break;
    }
  }
  tree.totals = totalsOf(tree.calls.flatMap(fillTotals));
  return tree;
}

/** 呼び出しとその中の呼び出しの totals を埋め、それらのステップの結果をすべて返す */
function fillTotals(call: CallView): StepRecord[] {
  const records = call.steps.flatMap((step) => [...(step.record ? [step.record] : []), ...step.tools.flatMap((t) => (t.child ? fillTotals(t.child) : []))]);
  call.totals = totalsOf(records);
  return records;
}
