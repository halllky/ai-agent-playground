import { connectedFlows, flowOrder, type EdgeOf, type InvocableNode, type ReturnMode, type RunStatus } from 'protocol';
import { conversationOf } from './conversation.ts';
import { invoke, turnHeader, type RunScope } from './invoke.ts';
import { meetsCondition, type Verdict } from './nodes/judge.ts';

/** ターン1回分の実行結果。reply はユーザー出力ノードへ流れ込んだ返答 */
export type FlowOutcome = { status: Exclude<RunStatus, 'running'>; reply: string; error: string | null };

/**
 * ユーザー入力から流れの順にノードを1回ずつ呼び出し、ユーザー出力ノードへ流れ込んだものを返答にする。
 *
 * ノードは、入ってくるフローの送り元のどれかが終わっていれば動かす（ユーザー入力は最初から終わっている）。
 * 判定ノードからのフローは、回答が条件を満たすときだけ送り先を動かす。動かなかったノードは、後段も動かさない。
 * 各ノードの入力は、そのノードに見せる今回の発言と、送り元が流した出力をつなげたもの。ユーザーの発言そのものはフローに流れない。
 * エージェントは、フローエッジごとに選んだ形（最後の応答文か全ステップ）で流し、作業だけして終わったら何も流さない。
 * 失敗したノードは、エラーの内容を出力として流す。
 */
export async function runFlow(scope: RunScope): Promise<FlowOutcome> {
  const input = scope.graph.nodes.find((n) => n.kind === 'userInput');
  const order = flowOrder(scope.graph);
  if (!input) return { status: 'error', reply: '', error: 'ユーザー入力ノードがありません' };
  if (!order) return { status: 'error', reply: '', error: 'フローが循環しています' };

  const flows = connectedFlows(scope.graph);
  const finished = new Map<string, Finished>([[input.id, { node: null, outputs: null, verdict: null }]]);
  let failed = false;
  for (const node of order) {
    if (scope.signal.aborted) break;
    const active = activeFlowsTo(flows, node.id, finished);
    if (active.length === 0) {
      scope.emit(turnHeader, { type: 'log', level: 'info', message: `${node.config.name} を動かす前段が無かったため実行しませんでした` });
      continue;
    }
    const message = conversationOf(scope, node).current;
    const result = await invoke(scope, { node, input: joined(message, piecesOf(active)), toolEdge: null, parentCallId: null, toolCallId: null, depth: 0 });
    if (result.status === 'error') failed = true;
    // 出力が null なのは、作業だけして終わるエージェントが成功したときだけ
    const outputs = result.output === null ? null : { finalText: result.output, allSteps: result.stepsOutput ?? '' };
    finished.set(node.id, { node, outputs, verdict: result.verdict });
  }

  const output = scope.graph.nodes.find((n) => n.kind === 'userOutput');
  const reply = output ? joined(null, piecesOf(activeFlowsTo(flows, output.id, finished))) : '';
  return { status: scope.signal.aborted ? 'aborted' : failed ? 'error' : 'done', reply, error: null };
}

/**
 * 終わったノード1つが、後段へ流すもの。node はユーザー入力なら null。
 * outputs はフローエッジの returns ごとの中身（エージェント以外はどれも同じ）で、何も流さないなら null。verdict は判定ノードの回答（それ以外や失敗時は null）
 */
type Finished = { node: InvocableNode | null; outputs: Record<ReturnMode, string> | null; verdict: Verdict | null };

/** 送り先を動かすフロー1本と、その送り元 */
type ActiveFlow = { edge: EdgeOf<'flow'>; from: Finished };

/** 流れてきた中身1つと、それを出力したノードの名前 */
type Piece = { name: string; text: string };

/** nodeId へ入るフローのうち、送り元が終わっていて、判定ノードからなら条件を満たすもの */
function activeFlowsTo(flows: EdgeOf<'flow'>[], nodeId: string, finished: Map<string, Finished>): ActiveFlow[] {
  return flows.flatMap((edge) => {
    const from = edge.target === nodeId ? finished.get(edge.source) : undefined;
    if (!from) return [];
    const { node, verdict } = from;
    if (!edge.condition || node?.kind !== 'judge') return [{ edge, from }];
    return verdict && meetsCondition(node, verdict, edge.condition) ? [{ edge, from }] : [];
  });
}

function piecesOf(active: ActiveFlow[]): Piece[] {
  return active.flatMap(({ edge, from }) => (from.node && from.outputs ? [{ name: from.node.config.name, text: from.outputs[edge.returns] }] : []));
}

/**
 * 今回の発言（見せないなら null）と流れてきた中身をつなげた、ノードへの入力。どちらか1つだけならそのもの。
 * 中身が複数なら出所の名前のタグで囲って並べる。発言と中身の両方があるときは、
 * 中身をモデルがユーザーの言葉と取り違えないよう、発言と中身を別々のタグで囲み、中身はユーザーが書いたものでも見たものでもないと明記する
 */
function joined(message: string | null, pieces: Piece[]): string {
  if (pieces.length === 0) return message ?? '';
  if (message === null) return pieces.length === 1 ? pieces[0].text : pieces.map(sectionOf).join('\n\n');
  return [
    `<user_message>\n${message}\n</user_message>`,
    '<preprocessing_results>',
    '以下は、この応答の前にシステム内部で実行した処理の出力です。ユーザーの発言ではなく、ユーザーはこの内容を見ていません。',
    'ユーザーへの応答の参考にしてください。ただし、これをユーザーが言ったことや知っていることとして扱わないでください。',
    '',
    pieces.map(sectionOf).join('\n\n'),
    '</preprocessing_results>',
  ].join('\n');
}

function sectionOf({ name, text }: Piece): string {
  return `<${name}>\n${text}\n</${name}>`;
}
