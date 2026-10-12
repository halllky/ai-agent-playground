import type { ReactNode } from 'react';
import type { EdgeKind, EdgeOf, GraphDefinition, GraphEdge, GraphNode, NodeKind, NodeOf } from 'protocol';
import { agentView } from './agent.tsx';
import { accessEdgeView, flowEdgeView, toolEdgeView } from './edges.tsx';
import { judgeView } from './judge.tsx';
import { userInputView, userOutputView } from './user.tsx';
import { webSearchView } from './webSearch.tsx';
import { workfolderView } from './workfolder.tsx';

/**
 * ノード種別ごとの画面上の振る舞い。接続口はノードの役割で決まるので、ここでは持たない。
 * ノード種別を増やしたときは、その種別のファイルを作って nodeKindViews に1件足せばキャンバス・パレット・インスペクタに反映される。
 */
export type NodeKindView<K extends NodeKind> = {
  /** パレットやノード見出しに出す種別名 */
  label: string;
  /** グラフに1つだけ置き、削除できないノードか。無いときだけパレットから追加できる */
  fixed?: boolean;
  /** ノード本体の、名前の下に出す要約 */
  summary?(node: NodeOf<K>): string;
  /** ノード本体の中身を、種別名・名前・要約の代わりに自前で描くもの */
  Contents?(props: { node: NodeOf<K> }): ReactNode;
  /** graph は node を含む、表示中のグラフ */
  Inspector(props: { node: NodeOf<K>; graph: GraphDefinition; onChange: (node: NodeOf<K>) => void }): ReactNode;
};

/** エッジの両端のノード。見つからなければ undefined */
export type EdgeEnds = { source: GraphNode | undefined; target: GraphNode | undefined };

/** エッジ種別ごとの画面上の振る舞い */
export type EdgeKindView<K extends EdgeKind> = {
  /** キャンバス上のエッジに添える説明。空文字なら何も出さない */
  label(edge: EdgeOf<K>, ends: EdgeEnds): string;
  /** onGraphChange は、エッジの設定に連動する両端のノードやほかのエッジも書き換えるときに使う */
  Inspector(
    props: EdgeEnds & {
      edge: EdgeOf<K>;
      onChange: (edge: EdgeOf<K>) => void;
      onGraphChange: (update: (graph: GraphDefinition) => GraphDefinition) => void;
    },
  ): ReactNode;
};

/** 全ノード種別の画面上の振る舞い。並びはパレットのボタンの並び */
export const nodeKindViews: { [K in NodeKind]: NodeKindView<K> } = {
  userInput: userInputView,
  userOutput: userOutputView,
  agent: agentView,
  workfolder: workfolderView,
  webSearch: webSearchView,
  judge: judgeView,
};

/** graph にパレットから追加できるノード種別。固定のノードは無いときだけ */
export function addableNodeKinds(graph: GraphDefinition): NodeKind[] {
  return (Object.keys(nodeKindViews) as NodeKind[]).filter((kind) => !nodeKindViews[kind].fixed || !graph.nodes.some((n) => n.kind === kind));
}

/** node の種別の振る舞い */
export function nodeKindView(node: GraphNode): NodeKindView<NodeKind> {
  return nodeKindViews[node.kind] as NodeKindView<NodeKind>;
}

/** ノードの表示名 */
export function nodeName(node: GraphNode): string {
  switch (node.kind) {
    case 'userInput':
    case 'userOutput':
      return 'ユーザー';
    case 'workfolder':
      return 'ワークフォルダ';
    default:
      return node.config.name;
  }
}

/** グラフ上のノードの表示名。ノードが見つからなければ id をそのまま返す */
export function nodeTitle(graph: GraphDefinition, nodeId: string): string {
  const node = graph.nodes.find((n) => n.id === nodeId);
  return node ? nodeName(node) : nodeId;
}

/** edge の種別の振る舞い */
export function edgeKindView(edge: GraphEdge): EdgeKindView<EdgeKind> {
  return edgeKindViews[edge.kind] as EdgeKindView<EdgeKind>;
}

const edgeKindViews: { [K in EdgeKind]: EdgeKindView<K> } = { tool: toolEdgeView, access: accessEdgeView, flow: flowEdgeView };
