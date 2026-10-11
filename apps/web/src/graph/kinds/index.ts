import type { ReactNode } from 'react';
import type { EdgeKind, EdgeOf, GraphDefinition, GraphEdge, GraphNode, NodeKind, NodeOf } from 'protocol';
import { agentView } from './agent.tsx';
import { flowEdgeView, toolEdgeView } from './edges.tsx';
import { filesView } from './files.tsx';
import { judgeView } from './judge.tsx';
import { userView } from './user.tsx';
import { webSearchView } from './webSearch.tsx';

/**
 * ノード種別ごとの画面上の振る舞い。接続口はノードの役割で決まるので、ここでは持たない。
 * ノード種別を増やしたときは、その種別のファイルを作って nodeKindViews に1件足せばキャンバス・パレット・インスペクタに反映される。
 */
export type NodeKindView<K extends NodeKind> = {
  /** パレットやノード見出しに出す種別名 */
  label: string;
  /** ノード本体に出す要約 */
  summary(node: NodeOf<K>): string;
  Inspector(props: { node: NodeOf<K>; onChange: (node: NodeOf<K>) => void }): ReactNode;
};

/** エッジ種別ごとの画面上の振る舞い */
export type EdgeKindView<K extends EdgeKind> = {
  /** キャンバス上のエッジに添える説明。空文字なら何も出さない */
  label(edge: EdgeOf<K>, target: GraphNode | undefined): string;
  Inspector(props: { edge: EdgeOf<K>; source: GraphNode | undefined; target: GraphNode | undefined; onChange: (edge: EdgeOf<K>) => void }): ReactNode;
};

/** 全ノード種別の画面上の振る舞い。並びはパレットのボタンの並び */
export const nodeKindViews: { [K in NodeKind]: NodeKindView<K> } = {
  user: userView,
  agent: agentView,
  files: filesView,
  webSearch: webSearchView,
  judge: judgeView,
};

/** graph にパレットから追加できるノード種別。ユーザーノードは無いときだけ */
export function addableNodeKinds(graph: GraphDefinition): NodeKind[] {
  return (Object.keys(nodeKindViews) as NodeKind[]).filter((kind) => kind !== 'user' || !graph.nodes.some((n) => n.kind === 'user'));
}

/** node の種別の振る舞い */
export function nodeKindView(node: GraphNode): NodeKindView<NodeKind> {
  return nodeKindViews[node.kind] as NodeKindView<NodeKind>;
}

/** ノードの表示名 */
export function nodeName(node: GraphNode): string {
  return node.kind === 'user' ? 'ユーザー' : node.config.name;
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

const edgeKindViews: { [K in EdgeKind]: EdgeKindView<K> } = { tool: toolEdgeView, flow: flowEdgeView };
