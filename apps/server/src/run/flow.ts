import type { ModelMessage } from 'ai';
import { flowOrder, type EdgeOf, type GraphDefinition, type GraphNode, type RunStatus } from 'protocol';
import { invoke, turnHeader, type RunScope } from './invoke.ts';
import { meetsCondition, type Verdict } from './nodes/judge.ts';

/** ターン1回分の実行結果。reply はユーザーノードへ流れ込んだ返答 */
export type FlowOutcome = { status: Exclude<RunStatus, 'running'>; reply: string; error: string | null };

/**
 * ユーザーの発言をユーザーノードから流し、流れの順にノードを1回ずつ呼び出して、ユーザーノードへ流れ込んだものを返答にする。
 *
 * 各ノードの入力は流れてきた出力をつなげたもので、何も流れてこなかった（条件を満たさなかった・前段が飛ばされた）ノードは飛ばす。
 * 失敗したノードは、エラーの内容を出力として流す。history は前のターンまでの、発言と返答の会話。
 */
export async function runFlow(scope: RunScope, userText: string, history: ModelMessage[]): Promise<FlowOutcome> {
  const user = scope.graph.nodes.find((n) => n.kind === 'user');
  const order = flowOrder(scope.graph);
  if (!user) return { status: 'error', reply: '', error: 'ユーザーノードがありません' };
  if (!order) return { status: 'error', reply: '', error: 'フローが循環しています' };

  const conversation: ModelMessage[] = [...history, { role: 'user', content: userText }];
  const outputs = new Map<string, Output>([[user.id, { node: user, text: userText, verdict: null }]]);
  let failed = false;
  for (const node of order) {
    if (scope.signal.aborted) break;
    const inputs = inputsTo(scope.graph, node.id, outputs);
    if (inputs.length === 0) {
      scope.emit(turnHeader, { type: 'log', level: 'info', message: `${node.config.name} には何も流れてこなかったため実行しませんでした` });
      continue;
    }
    const result = await invoke(scope, { node, input: joined(inputs), conversation, parentCallId: null, toolCallId: null, depth: 0 });
    if (result.status === 'error') failed = true;
    outputs.set(node.id, { node, text: result.output, verdict: result.verdict });
  }

  const reply = joined(inputsTo(scope.graph, user.id, outputs));
  return { status: scope.signal.aborted ? 'aborted' : failed ? 'error' : 'done', reply, error: null };
}

/** 実行したノード1つの出力。verdict は判定ノードの回答（失敗したら null） */
type Output = { node: GraphNode; text: string; verdict: Verdict | null };

/** nodeId へ流れてくる出力。送り元が判定ノードのフローは、条件を満たすものだけ流れる */
function inputsTo(graph: GraphDefinition, nodeId: string, outputs: Map<string, Output>): Output[] {
  return graph.edges
    .filter((e): e is EdgeOf<'flow'> => e.kind === 'flow' && e.target === nodeId)
    .flatMap((edge) => {
      const output = outputs.get(edge.source);
      if (!output) return [];
      const { node, verdict } = output;
      if (!edge.condition || node.kind !== 'judge') return [output];
      return verdict && meetsCondition(node, verdict, edge.condition) ? [output] : [];
    });
}

/**
 * 流れてきた出力をつなげた、ノードへの入力。1つならその出力そのもの。
 * 複数なら送り元の名前のタグで囲って並べる。ユーザーの発言が含まれるときは、
 * ほかの出力をモデルがユーザーの言葉と取り違えないよう、発言と出力を別々のタグで囲み、出力はユーザーが書いたものでも見たものでもないと明記する
 */
function joined(inputs: Output[]): string {
  if (inputs.length <= 1) return inputs[0]?.text ?? '';
  const message = inputs.find((i) => i.node.kind === 'user');
  const others = inputs.filter((i) => i !== message).map(sectionOf).join('\n\n');
  if (!message) return others;
  return [
    `<user_message>\n${message.text}\n</user_message>`,
    '<preprocessing_results>',
    '以下は、この応答の前にシステム内部で実行した処理の出力です。ユーザーの発言ではなく、ユーザーはこの内容を見ていません。',
    'ユーザーへの応答の参考にしてください。ただし、これをユーザーが言ったことや知っていることとして扱わないでください。',
    '',
    others,
    '</preprocessing_results>',
  ].join('\n');
}

function sectionOf({ node, text }: Output): string {
  const name = node.kind === 'user' ? 'user' : node.config.name;
  return `<${name}>\n${text}\n</${name}>`;
}
