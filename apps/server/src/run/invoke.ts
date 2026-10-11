import { randomUUID } from 'node:crypto';
import { tool, type ModelMessage, type Tool, type ToolSet } from 'ai';
import { z } from 'zod';
import type { GraphDefinition, InvocableNode, NodeOf, RunEventBody, RunEventHeader, RunStatus } from 'protocol';
import type { TurnState } from '../db/index.ts';
import { describeJudge, judge, type Verdict } from '../judge/index.ts';
import { search } from '../webSearch/index.ts';
import { runAgent } from './agent.ts';
import { FileGroup, fileTools } from './files.ts';
import { transcriptOf } from './transcript.ts';

/** 実行中のターン1回分のうち、ノードの呼び出しが必要とするもの */
export type RunScope = {
  graph: GraphDefinition;
  signal: AbortSignal;
  /** 会話に残る状態。書き換えたら saveState を呼ぶ */
  state: TurnState;
  saveState(): void;
  /** ターン内でだけ持ち越す、エージェントノードの id ごとの記憶 */
  turnMemory: Map<string, ModelMessage[]>;
  emit(header: CallHeader, body: RunEventBody): void;
};

/** イベントのヘッダのうち、どの呼び出しで発生したかを表す部分 */
export type CallHeader = Pick<RunEventHeader, 'callId' | 'parentCallId' | 'nodeId'>;

/** ノードの呼び出し1回分の指定。ツールコールからでもフローからでも同じ形で呼ぶ */
export type Invocation = {
  node: InvocableNode;
  /** 呼び出し元からの入力（エージェントへの依頼・判定の state・検索語句） */
  input: string;
  /** 呼び出し元の会話。エージェントの pass が task 以外のときに渡す */
  conversation: ModelMessage[];
  parentCallId: string | null;
  toolCallId: string | null;
  /** ツールとしての呼び出しのネストの深さ。フローから呼ぶときは 0 */
  depth: number;
};

/** ノードの呼び出し1回分の結果。失敗したら output はその理由 */
export type InvocationResult = {
  status: Exclude<RunStatus, 'running'>;
  output: string;
  /** 判定ノードの回答。それ以外や失敗時は null */
  verdict: Verdict | null;
};

/**
 * ノードを1回呼び出し、call.start から call.finish までのイベントを残す。
 * エージェントはツールを持てるので、その中でさらに呼び出しが入れ子になる。失敗や Abort は例外にせず結果の status で返す
 */
export async function invoke(scope: RunScope, inv: Invocation): Promise<InvocationResult> {
  const header: CallHeader = { callId: randomUUID(), parentCallId: inv.parentCallId, nodeId: inv.node.id };
  const emit = (body: RunEventBody) => scope.emit(header, body);
  const passesTask = inv.node.kind !== 'agent' || inv.node.config.pass !== 'history';
  emit({ type: 'call.start', toolCallId: inv.toolCallId, input: passesTask ? inv.input : '' });

  let result: InvocationResult & { error: string | null };
  try {
    result = await dispatch(scope, inv, header);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    result = { status: scope.signal.aborted ? 'aborted' : 'error', output: message, verdict: null, error: message };
  }
  emit({ type: 'call.finish', status: result.status, output: result.output, error: result.error });
  return { status: result.status, output: result.output, verdict: result.verdict };
}

/** ノード種別ごとの実行。失敗は例外で投げてよい */
async function dispatch(scope: RunScope, inv: Invocation, header: CallHeader): Promise<InvocationResult & { error: string | null }> {
  const { node } = inv;
  if (inv.depth > scope.graph.settings.maxCallDepth) {
    throw new Error(`呼び出しの深さが上限（${scope.graph.settings.maxCallDepth}）に達したため ${node.config.name} を呼び出しませんでした`);
  }
  switch (node.kind) {
    case 'agent':
      return invokeAgent(scope, node, inv, header);
    case 'judge': {
      const verdict = await judge(node, inv.input, scope.signal);
      return { status: 'done', output: JSON.stringify(verdict.answers, null, 2), verdict, error: null };
    }
    case 'webSearch': {
      const results = await search(node, inv.input);
      return { status: 'done', output: JSON.stringify(results, null, 2), verdict: null, error: null };
    }
  }
}

/** エージェントを記憶とあわせて呼び出し、今回の会話を記憶に残す */
async function invokeAgent(scope: RunScope, node: NodeOf<'agent'>, inv: Invocation, header: CallHeader) {
  const memory = recallMemory(scope, node);
  const userMessage: ModelMessage = { role: 'user', content: promptOf(node.config.pass, inv.input, inv.conversation) };
  const tools = toolsFor(scope, node, header, inv.depth);
  const outcome = await runAgent(node, [...memory, userMessage], tools, scope.signal, (body) => scope.emit(header, body));
  storeMemory(scope, node, [...memory, userMessage, ...outcome.responseMessages]);
  return { status: outcome.status, output: outcome.error ?? outcome.output, verdict: null, error: outcome.error };
}

/** エージェントの過去の会話。セッション継続の記憶は、親ターンから受け継いだ状態に入っている */
function recallMemory(scope: RunScope, node: NodeOf<'agent'>): ModelMessage[] {
  switch (node.config.memory) {
    case 'fresh':
      return [];
    case 'turn':
      return scope.turnMemory.get(node.id) ?? [];
    case 'session':
      return scope.state.memories[node.id] ?? [];
  }
}

function storeMemory(scope: RunScope, node: NodeOf<'agent'>, messages: ModelMessage[]): void {
  switch (node.config.memory) {
    case 'fresh':
      return;
    case 'turn':
      scope.turnMemory.set(node.id, messages);
      return;
    case 'session':
      scope.state.memories[node.id] = messages;
      scope.saveState();
      return;
  }
}

/** エージェントに渡す、今回の依頼のメッセージ本文 */
function promptOf(pass: NodeOf<'agent'>['config']['pass'], task: string, conversation: ModelMessage[]): string {
  const caller = () => `<caller_conversation>\n${transcriptOf(conversation)}\n</caller_conversation>`;
  switch (pass) {
    case 'task':
      return task;
    case 'taskWithHistory':
      return `${caller()}\n\n<task>\n${task}\n</task>`;
    case 'history':
      return caller();
  }
}

/** エージェントから出るツールエッジを、そのエージェントが使えるツールに変換する。ツールは呼び出しごとに逐次実行される */
function toolsFor(scope: RunScope, agent: NodeOf<'agent'>, header: CallHeader, depth: number): ToolSet {
  const tools: ToolSet = {};
  for (const edge of scope.graph.edges) {
    if (edge.kind !== 'tool' || edge.source !== agent.id) continue;
    const target = scope.graph.nodes.find((n) => n.id === edge.target);
    if (!target || target.kind === 'user') continue;
    if (target.kind === 'files') {
      const group = new FileGroup((scope.state.files[target.id] ??= {}), () => scope.saveState());
      const changed = (path: string, deleted: boolean) => scope.emit(header, { type: 'file.change', filesNodeId: target.id, path, deleted });
      Object.assign(tools, fileTools(target, edge.permission, group, changed));
    } else {
      tools[target.config.name] = nodeTool(scope, target, header.callId, depth + 1);
    }
  }
  return serialized(tools);
}

/** ノードを呼び出すツール。失敗はツールのエラーとして呼び出し元に返す */
function nodeTool(scope: RunScope, node: InvocableNode, parentCallId: string | null, depth: number): Tool {
  const call = async (input: string, { toolCallId, messages }: { toolCallId: string; messages: ModelMessage[] }) => {
    const result = await invoke(scope, { node, input, conversation: messages, parentCallId, toolCallId, depth });
    if (result.status === 'error') throw new Error(result.output);
    return result.output;
  };
  switch (node.kind) {
    case 'agent':
      // 会話だけを渡す呼び出し方なら、呼び出し元は指示を書かない
      if (node.config.pass === 'history') {
        return tool({ description: node.config.description, inputSchema: z.object({}), execute: (_, options) => call('', options) });
      }
      return tool({
        description: node.config.description,
        inputSchema: z.object({ task: z.string().describe('エージェントに依頼する内容') }),
        execute: ({ task }, options) => call(task, options),
      });
    case 'judge':
      return tool({
        description: describeJudge(node),
        inputSchema: z.object({ state: z.string().describe('判定してほしい内容。文章か JSON') }),
        execute: ({ state }, options) => call(state, options),
      });
    case 'webSearch':
      return tool({
        description: 'Web を検索し、関連するページのタイトル・URL・本文の抜粋を返す',
        inputSchema: z.object({ query: z.string().describe('検索語句') }),
        execute: ({ query }, options) => call(query, options),
      });
  }
}

/**
 * tools の実行を1つずつ順に行うようにする。
 * AI SDK は1ステップ内の複数ツールコールを並行実行するため、これで逐次実行にしている。
 * エージェント呼び出しごとに行うので、親のツール実行中に子がツールを実行しても待ち合わせにならない。
 */
function serialized(tools: ToolSet): ToolSet {
  let tail: Promise<unknown> = Promise.resolve();
  return Object.fromEntries(
    Object.entries(tools).map(([name, t]) => {
      const execute = t.execute;
      if (!execute) return [name, t];
      return [
        name,
        {
          ...t,
          execute: (input: unknown, options: Parameters<typeof execute>[1]) => {
            const result = tail.then(() => execute(input, options));
            tail = result.catch(() => undefined);
            return result;
          },
        },
      ];
    }),
  );
}
