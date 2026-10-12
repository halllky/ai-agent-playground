import { flowOrder, type EdgeOf, type GraphDefinition, type InvocableNode, type NodeOf, type ReturnMode, type RunStatus } from 'protocol';
import { invoke, turnHeader, type RunScope } from './invoke.ts';
import { meetsCondition, type Verdict } from './nodes/judge.ts';

/** ターン1回分の実行結果。reply はユーザー出力ノードへ流れ込んだ返答 */
export type FlowOutcome = { status: Exclude<RunStatus, 'running'>; reply: string; error: string | null };

/**
 * ユーザーの発言をユーザー入力ノードから流し、流れの順にノードを1回ずつ呼び出して、ユーザー出力ノードへ流れ込んだものを返答にする。
 *
 * 各ノードの入力は流れてきた出力をつなげたもので、何も流れてこなかった（条件を満たさなかった・前段が飛ばされた）ノードは飛ばす。
 * エージェントからは、フローエッジごとに選んだ形（最後の応答文か全ステップ）で流す。
 * 作業だけして終わるエージェントは、受け取った入力をそのまま後段へ流す（前処理として直列に挟める）。
 * 同じ出所の出力が複数の経路から届いたら1つにまとめる。失敗したノードは、エラーの内容を出力として流す。
 * 返答には、ユーザー自身の発言は含めない。
 */
export async function runFlow(scope: RunScope, userText: string): Promise<FlowOutcome> {
  const input = scope.graph.nodes.find((n) => n.kind === 'userInput');
  const order = flowOrder(scope.graph);
  if (!input) return { status: 'error', reply: '', error: 'ユーザー入力ノードがありません' };
  if (!order) return { status: 'error', reply: '', error: 'フローが循環しています' };

  const userPieces = [{ origin: input, text: userText }];
  const outputs = new Map<string, Output>([[input.id, { node: input, pieces: { finalText: userPieces, allSteps: userPieces }, verdict: null }]]);
  let failed = false;
  for (const node of order) {
    if (scope.signal.aborted) break;
    const pieces = piecesTo(scope.graph, node.id, outputs);
    if (pieces.length === 0) {
      scope.emit(turnHeader, { type: 'log', level: 'info', message: `${node.config.name} には何も流れてこなかったため実行しませんでした` });
      continue;
    }
    const result = await invoke(scope, { node, input: joined(pieces), toolEdge: null, parentCallId: null, toolCallId: null, depth: 0 });
    if (result.status === 'error') failed = true;
    const passesThrough = node.kind === 'agent' && node.config.workOnly && result.status === 'done';
    const outputPieces = passesThrough
      ? { finalText: pieces, allSteps: pieces }
      : { finalText: [{ origin: node, text: result.output ?? '' }], allSteps: [{ origin: node, text: result.stepsOutput ?? '' }] };
    outputs.set(node.id, { node, pieces: outputPieces, verdict: result.verdict });
  }

  const output = scope.graph.nodes.find((n) => n.kind === 'userOutput');
  const reply = output ? joined(piecesTo(scope.graph, output.id, outputs).filter((p) => p.origin.kind !== 'userInput')) : '';
  return { status: scope.signal.aborted ? 'aborted' : failed ? 'error' : 'done', reply, error: null };
}

/** 流れる中身の1つと、それを出力したノード。作業だけして終わるエージェントを通っても出所は変わらない */
type Piece = { origin: NodeOf<'userInput'> | InvocableNode; text: string };

/** 実行したノード1つの出力。pieces はフローエッジの returns ごとに流す中身（エージェント以外はどれも同じ）。verdict は判定ノードの回答（それ以外や失敗時は null） */
type Output = { node: NodeOf<'userInput'> | InvocableNode; pieces: Record<ReturnMode, Piece[]>; verdict: Verdict | null };

/** nodeId へ流れてくる中身。送り元が判定ノードのフローは、条件を満たすものだけ流れる。同じ出所のものは最初の1つだけ残す */
function piecesTo(graph: GraphDefinition, nodeId: string, outputs: Map<string, Output>): Piece[] {
  const pieces = graph.edges
    .filter((e): e is EdgeOf<'flow'> => e.kind === 'flow' && e.target === nodeId)
    .flatMap((edge) => {
      const output = outputs.get(edge.source);
      if (!output) return [];
      const { node, verdict } = output;
      const pieces = output.pieces[edge.returns];
      if (!edge.condition || node.kind !== 'judge') return pieces;
      return verdict && meetsCondition(node, verdict, edge.condition) ? pieces : [];
    });
  return pieces.filter((p, i) => pieces.findIndex((q) => q.origin.id === p.origin.id) === i);
}

/**
 * 流れてきた中身をつなげた、ノードへの入力。中身が1つならそのもの。
 * 複数なら出所の名前のタグで囲って並べる。ユーザーの発言が含まれるときは、
 * ほかの出力をモデルがユーザーの言葉と取り違えないよう、発言と出力を別々のタグで囲み、出力はユーザーが書いたものでも見たものでもないと明記する
 */
function joined(pieces: Piece[]): string {
  if (pieces.length <= 1) return pieces[0]?.text ?? '';
  const message = pieces.find((p) => p.origin.kind === 'userInput');
  const others = pieces.filter((p) => p !== message).map(sectionOf).join('\n\n');
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

function sectionOf({ origin, text }: Piece): string {
  const name = origin.kind === 'userInput' ? 'user' : origin.config.name;
  return `<${name}>\n${text}\n</${name}>`;
}
