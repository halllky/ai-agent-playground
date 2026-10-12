import { randomUUID } from 'node:crypto';
import type { ModelMessage, Tool, ToolSet } from 'ai';
import {
  isInvocable,
  type EdgeOf,
  type GraphDefinition,
  type InvocableNode,
  type NodeOf,
  type RunEventBody,
  type RunEventHeader,
  type RunStatus,
} from 'protocol';
import type { TurnState } from '../db/index.ts';
import { conversationOf, type PastTurn } from './conversation.ts';
import { agentTool, invokeAgent } from './nodes/agent.ts';
import { Workfolder, workfolderTools } from './nodes/files.ts';
import { judge, judgeTool, type Verdict } from './nodes/judge.ts';
import { search, webSearchTool } from './nodes/webSearch.ts';

/** 実行中のターン1回分のうち、ノードの呼び出しが必要とするもの */
export type RunScope = {
  graph: GraphDefinition;
  signal: AbortSignal;
  /** 会話に残る状態。書き換えたら saveState を呼ぶ */
  state: TurnState;
  saveState(): void;
  /** ユーザーとの会話のうち、前のターンまでの発言と返答 */
  pastTurns: PastTurn[];
  /** 今回のユーザーの発言 */
  userText: string;
  /** ターン内でだけ持ち越す、ツールエッジごとの呼び出しの依頼と応答 */
  turnMemory: Map<string, ModelMessage[]>;
  emit(header: CallHeader, body: RunEventBody): void;
};

/** イベントのヘッダのうち、どの呼び出しで発生したかを表す部分 */
export type CallHeader = Pick<RunEventHeader, 'callId' | 'parentCallId' | 'nodeId'>;

/** どの呼び出しにも属さない、ターン全体についてのイベントのヘッダ */
export const turnHeader: CallHeader = { callId: null, parentCallId: null, nodeId: null };

/** ノードの呼び出し1回分の指定。ツールコールからでもフローからでも同じ形で呼ぶ */
export type Invocation = {
  node: InvocableNode;
  /** 呼び出し元からの入力（エージェントへの依頼・判定の state・検索語句） */
  input: string;
  /** ツールとして呼ぶときの、呼び出し元からのツールエッジ。フローから呼ぶときは null */
  toolEdge: EdgeOf<'tool'> | null;
  parentCallId: string | null;
  toolCallId: string | null;
  /** ツールとしての呼び出しのネストの深さ。フローから呼ぶときは 0 */
  depth: number;
};

/**
 * ノードの呼び出し1回分の結果。失敗したら output も stepsOutput もその理由。作業だけして終わるエージェントが成功したらどちらも null。
 * output はエージェントなら最後の応答文で、stepsOutput は全ステップの JSON（エージェント以外は output と同じ）
 */
export type InvocationResult = {
  status: Exclude<RunStatus, 'running'>;
  output: string | null;
  stepsOutput: string | null;
  /** 判定ノードの回答。それ以外や失敗時は null */
  verdict: Verdict | null;
};

/** ノードをツールとして呼び出す関数。input は呼び出し元のモデルが書いた入力。失敗したら例外を投げる */
export type ToolCall = (input: string, options: { toolCallId: string }) => Promise<string | null>;

/**
 * ノードを1回呼び出し、call.start から call.finish までのイベントを残す。call.finish の出力は、ツールエッジで選んだ形（フローなら最後の応答文）。
 * エージェントはツールを持てるので、その中でさらに呼び出しが入れ子になる。失敗や Abort は例外にせず結果の status で返す
 */
export async function invoke(scope: RunScope, inv: Invocation): Promise<InvocationResult> {
  const header: CallHeader = { callId: randomUUID(), parentCallId: inv.parentCallId, nodeId: inv.node.id };
  const emit = (body: RunEventBody) => scope.emit(header, body);
  emit({ type: 'call.start', toolCallId: inv.toolCallId, input: inv.input });

  let result: InvocationResult & { error: string | null };
  try {
    result = await dispatch(scope, inv, header);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    result = { status: scope.signal.aborted ? 'aborted' : 'error', output: message, stepsOutput: message, verdict: null, error: message };
  }
  const { error, ...outcome } = result;
  emit({ type: 'call.finish', status: outcome.status, output: outputFor(inv.toolEdge, outcome) ?? '', error });
  return outcome;
}

/** 呼び出しの結果のうち、toolEdge の呼び出し元へ返す形。フローからの呼び出し（null）なら最後の応答文 */
function outputFor(toolEdge: EdgeOf<'tool'> | null, result: InvocationResult): string | null {
  return toolEdge?.returns === 'allSteps' ? result.stepsOutput : result.output;
}

/** ノード種別ごとの実行。失敗は例外で投げてよい */
async function dispatch(scope: RunScope, inv: Invocation, header: CallHeader): Promise<InvocationResult & { error: string | null }> {
  const { node } = inv;
  if (inv.depth > scope.graph.settings.maxCallDepth) {
    throw new Error(`呼び出しの深さが上限（${scope.graph.settings.maxCallDepth}）に達したため ${node.config.name} を呼び出しませんでした`);
  }
  switch (node.kind) {
    case 'agent': {
      const tools = toolsFor(scope, node, header.callId, inv.depth);
      const memory = inv.toolEdge && { mode: inv.toolEdge.memory, key: inv.toolEdge.id };
      const outcome = await invokeAgent(scope, node, inv.input, memory, tools, (body) => scope.emit(header, body));
      return { ...outcome, verdict: null };
    }
    case 'judge': {
      const verdict = await judge(node, judgeStateOf(scope, inv, node), scope.signal);
      const output = JSON.stringify(verdict.answers, null, 2);
      return { status: 'done', output, stepsOutput: output, verdict, error: null };
    }
    case 'webSearch': {
      const output = JSON.stringify(await search(node, inv.input), null, 2);
      return { status: 'done', output, stepsOutput: output, verdict: null, error: null };
    }
  }
}

/**
 * 判定に渡す state。見せる会話があれば、その記録を入力の前に置く。
 * フローからなら今回の発言は入力に入っているので、記録には前のターンまでだけを入れる
 */
function judgeStateOf(scope: RunScope, inv: Invocation, node: NodeOf<'judge'>): string {
  const transcript = conversationOf(scope, node).transcript(inv.toolEdge !== null);
  return transcript ? `${transcript}\n\n<state>\n${inv.input}\n</state>` : inv.input;
}

/**
 * エージェントから出るツールエッジを、そのエージェントが使えるツールに変換する。ツールは呼び出しごとに逐次実行される。
 * アクセスエッジは、それらの権限をまとめた1組のワークフォルダのツールになる
 */
function toolsFor(scope: RunScope, agent: NodeOf<'agent'>, callId: string | null, depth: number): ToolSet {
  const tools: ToolSet = {};
  for (const edge of scope.graph.edges) {
    if (edge.kind !== 'tool' || edge.source !== agent.id) continue;
    const target = scope.graph.nodes.find((n) => n.id === edge.target);
    if (target && isInvocable(target)) tools[target.config.name] = nodeTool(scope, target, edge, callId, depth + 1);
  }
  Object.assign(tools, workfolderTools(scope.graph, agent, new Workfolder(scope.state.files, () => scope.saveState())));
  return serialized(tools);
}

/** toolEdge の送り先のノードを呼び出すツール。説明と返す形は toolEdge で決まる。失敗はツールのエラーとして呼び出し元に返す */
function nodeTool(scope: RunScope, node: InvocableNode, toolEdge: EdgeOf<'tool'>, parentCallId: string | null, depth: number): Tool {
  const call: ToolCall = async (input, { toolCallId }) => {
    const result = await invoke(scope, { node, input, toolEdge, parentCallId, toolCallId, depth });
    if (result.status === 'error') throw new Error(result.output ?? '');
    return outputFor(toolEdge, result);
  };
  switch (node.kind) {
    case 'agent':
      return agentTool(toolEdge.description, call);
    case 'judge':
      return judgeTool(node, toolEdge.description, call);
    case 'webSearch':
      return webSearchTool(toolEdge.description, call);
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
