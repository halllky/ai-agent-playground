import type { RunEvent, RunStatus } from 'protocol';

/** エージェント呼び出し1回分の表示内容 */
export type CallView = {
  callId: string;
  nodeId: string;
  task: string;
  status: RunStatus;
  error: string | null;
  items: CallItem[];
};

/** 呼び出しの中に時系列で並べる要素。テキストか、ツールコール（サブエージェント呼び出しを含む） */
export type CallItem =
  | { kind: 'text'; text: string; aborted: boolean }
  | {
      kind: 'tool';
      toolCallId: string;
      toolName: string;
      input: unknown;
      result?: { output: unknown; isError: boolean };
      /** このツールコールがサブエージェント呼び出しなら、その中身 */
      child?: CallView;
    };

/**
 * ターンのイベント列から、メインエージェントを根とする呼び出しの入れ子を組み立てる。
 * ステップのテキストは step.finish で届くが、表示上はそのステップのツールコールより前に置く。
 */
export function buildCallTree(events: RunEvent[]): CallView | undefined {
  const calls = new Map<string, CallView & { stepStart: number }>();
  let root: CallView | undefined;

  for (const event of events) {
    const call = calls.get(event.callId);
    switch (event.type) {
      case 'call.start': {
        const created = { callId: event.callId, nodeId: event.nodeId, task: event.task, status: 'running' as const, error: null, items: [], stepStart: 0 };
        calls.set(event.callId, created);
        const parent = event.parentCallId ? calls.get(event.parentCallId) : undefined;
        const toolItem = parent?.items.find((i) => i.kind === 'tool' && i.toolCallId === event.toolCallId);
        if (toolItem?.kind === 'tool') toolItem.child = created;
        else if (!event.parentCallId) root = created;
        break;
      }
      case 'tool.call':
        call?.items.push({ kind: 'tool', toolCallId: event.toolCallId, toolName: event.toolName, input: event.input });
        break;
      case 'tool.result': {
        const item = call?.items.find((i) => i.kind === 'tool' && i.toolCallId === event.toolCallId);
        if (item?.kind === 'tool') item.result = { output: event.output, isError: event.isError };
        break;
      }
      case 'step.finish':
        if (!call) break;
        if (event.step.text) call.items.splice(call.stepStart, 0, { kind: 'text', text: event.step.text, aborted: event.step.aborted });
        call.stepStart = call.items.length;
        break;
      case 'call.finish':
        if (!call) break;
        call.status = event.status;
        call.error = event.error;
        break;
    }
  }
  return root;
}
