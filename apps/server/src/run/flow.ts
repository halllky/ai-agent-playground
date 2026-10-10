import { randomUUID } from 'node:crypto';
import type { ModelMessage } from 'ai';
import { flowStages, type EdgeOf, type GraphDefinition, type NodeOf, type StageNode } from 'protocol';
import { judge, meetsCondition, type Verdict } from '../judge/index.ts';
import { search } from '../webSearch/index.ts';
import { callSubAgent, type CallHeader, type RunScope } from './agentCall.ts';

/** ターンの会話。history は前のターンまでの、メインエージェントから見た履歴 */
export type Conversation = { history: ModelMessage[]; userText: string };

/**
 * フローの段をメインエージェントより前に実行し、メインエージェントに渡す今回の発言を作る。
 *
 * 段は前段がすべて終わってから1つずつ実行し、その入出力はターン全体（header）のツールコールとしてイベントに残す。
 * 前段を持たない段は今回の発言を、それ以外は流れてきた前段の出力を入力にする。
 * 前段を持つのに何も流れてこなかった（条件を満たさなかった・前段が飛ばされた）段は飛ばす。
 * 失敗した段は、エラーの内容を出力として流す。
 *
 * メインエージェントへの発言は、今回の発言と、流れてきた出力を区別できるように囲んだもの。
 * 流れてきた出力が無ければ今回の発言そのもの。
 */
export async function runFlow(scope: RunScope, header: CallHeader, main: NodeOf<'mainAgent'>, conversation: Conversation): Promise<string> {
  const stages = flowStages(scope.graph);
  if (!stages) {
    scope.emit(header, { type: 'log', level: 'warn', message: 'フローが循環しているため、フローの段を実行しませんでした' });
    return conversation.userText;
  }

  const stageIds = new Set(stages.map((s) => s.id));
  const results = new Map<string, StageResult>();
  for (const stage of stages) {
    if (scope.signal.aborted) break;
    const isEntry = !incomingFlows(scope.graph, stage.id).some((e) => stageIds.has(e.source));
    const inputs = inputsTo(scope.graph, stage.id, results);
    if (!isEntry && inputs.length === 0) {
      scope.emit(header, { type: 'log', level: 'info', message: `${stage.config.name} には前段から何も流れてこなかったため実行しませんでした` });
      continue;
    }
    const input = isEntry ? conversation.userText : joined(inputs);
    results.set(stage.id, await runStage(scope, header, stage, input, conversation));
  }

  return mainPromptOf(conversation.userText, inputsTo(scope.graph, main.id, results));
}

/** 実行した段1つの結果。text は後段へ流す文章、verdict は判定ノードの回答（失敗したら null） */
type StageResult = { stage: StageNode; text: string; verdict: Verdict | null };

/** 段1つを実行し、その入出力をツールコールとしてイベントに残す */
async function runStage(scope: RunScope, header: CallHeader, stage: StageNode, input: string, conversation: Conversation): Promise<StageResult> {
  const toolCallId = randomUUID();
  const toolName = stage.config.name;
  scope.emit(header, { type: 'tool.call', toolCallId, toolName, input });
  try {
    const { output, text, verdict } = await executeStage(scope, header, toolCallId, stage, input, conversation);
    scope.emit(header, { type: 'tool.result', toolCallId, toolName, output, isError: false });
    return { stage, text, verdict };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    scope.emit(header, { type: 'tool.result', toolCallId, toolName, output: message, isError: true });
    return { stage, text: message, verdict: null };
  }
}

/**
 * 段の種類ごとの実行。
 * サブエージェントはノードの呼び出しの既定値で呼び、「呼び出し元の会話」として今回の発言までの会話を渡す
 */
async function executeStage(
  scope: RunScope,
  header: CallHeader,
  toolCallId: string,
  stage: StageNode,
  input: string,
  conversation: Conversation,
): Promise<{ output: unknown; text: string; verdict: Verdict | null }> {
  switch (stage.kind) {
    case 'subAgent': {
      const text = await callSubAgent(scope, {
        node: stage,
        settings: stage.config.callDefaults,
        memoryKey: `flow:${stage.id}`,
        task: input,
        callerMessages: [...conversation.history, { role: 'user', content: conversation.userText }],
        caller: header,
        toolCallId,
        depth: 0,
      });
      return { output: text, text, verdict: null };
    }
    case 'judge': {
      const verdict = await judge(stage, input, scope.signal);
      return { output: verdict, text: JSON.stringify(verdict.answers, null, 2), verdict };
    }
    case 'webSearch': {
      const results = await search(stage, input);
      return { output: results, text: JSON.stringify(results, null, 2), verdict: null };
    }
  }
}

function incomingFlows(graph: GraphDefinition, nodeId: string): EdgeOf<'flow'>[] {
  return graph.edges.filter((e): e is EdgeOf<'flow'> => e.kind === 'flow' && e.target === nodeId);
}

/** nodeId へ流れてくる、実行済みの段の結果。送り元が判定ノードのフローは、条件を満たすものだけ流れる */
function inputsTo(graph: GraphDefinition, nodeId: string, results: Map<string, StageResult>): StageResult[] {
  return incomingFlows(graph, nodeId).flatMap((edge) => {
    const result = results.get(edge.source);
    if (!result) return [];
    const { stage, verdict } = result;
    if (!edge.condition || stage.kind !== 'judge') return [result];
    return verdict && meetsCondition(stage, verdict, edge.condition) ? [result] : [];
  });
}

/**
 * メインエージェントに渡す今回の発言。
 * 流れてきた出力を発言と並べるだけだと、モデルがそれをユーザーの言葉と取り違えて応答することがあるため、
 * 発言と出力を別々のタグで囲み、出力はユーザーが書いたものでも見たものでもないと明記する
 */
function mainPromptOf(userText: string, inputs: StageResult[]): string {
  if (inputs.length === 0) return userText;
  return [
    `<user_message>\n${userText}\n</user_message>`,
    '<preprocessing_results>',
    '以下は、この応答の前にシステム内部で実行した処理の出力です。ユーザーの発言ではなく、ユーザーはこの内容を見ていません。',
    'ユーザーへの応答の参考にしてください。ただし、これをユーザーが言ったことや知っていることとして扱わないでください。',
    '',
    inputs.map(sectionOf).join('\n\n'),
    '</preprocessing_results>',
  ].join('\n');
}

/** 段への入力。前段が1つならその出力そのもの、複数なら送り元の名前のタグで囲って並べる */
function joined(inputs: StageResult[]): string {
  return inputs.length === 1 ? inputs[0].text : inputs.map(sectionOf).join('\n\n');
}

function sectionOf({ stage, text }: StageResult): string {
  return `<${stage.config.name}>\n${text}\n</${stage.config.name}>`;
}
