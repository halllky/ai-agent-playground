import type { EdgeKind, GraphDefinition, GraphNode, InvocableNode, NodeKind } from './schema.ts';

/**
 * ノード種別ごとの、グラフ上での役割。接続できる組み合わせはすべてここから決まる。
 * usesTools はツールを使う側、isTool はツールとして使われる側、inFlow はフローに置けるか
 */
export const nodeRoles: Record<NodeKind, { usesTools: boolean; isTool: boolean; inFlow: boolean }> = {
  user: { usesTools: false, isTool: false, inFlow: true },
  agent: { usesTools: true, isTool: true, inFlow: true },
  files: { usesTools: false, isTool: true, inFlow: false },
  judge: { usesTools: false, isTool: true, inFlow: true },
  webSearch: { usesTools: false, isTool: true, inFlow: true },
};

/** source から target へ kind のエッジを張れるか */
export function canConnect(source: GraphNode, target: GraphNode, kind: EdgeKind): boolean {
  if (source.id === target.id) return false;
  if (kind === 'tool') return nodeRoles[source.kind].usesTools && nodeRoles[target.kind].isTool;
  return nodeRoles[source.kind].inFlow && nodeRoles[target.kind].inFlow;
}

/**
 * ユーザーから流れをたどって届くノードを、前段がすべて先に来る順に並べる（ユーザー自身は含めない）。
 * 循環していて順序が決まらなければ null。ユーザーノードが無ければ空
 */
export function flowOrder(graph: GraphDefinition): InvocableNode[] | null {
  const user = graph.nodes.find((n) => n.kind === 'user');
  if (!user) return [];
  const nodeById = new Map(graph.nodes.map((n) => [n.id, n]));
  const flows = graph.edges.filter((e) => {
    const source = nodeById.get(e.source);
    const target = nodeById.get(e.target);
    return e.kind === 'flow' && source && target && canConnect(source, target, 'flow') && target.kind !== 'user';
  });

  const reachable = new Set<string>();
  const visit = (id: string) => {
    for (const edge of flows.filter((e) => e.source === id)) {
      if (reachable.has(edge.target)) continue;
      reachable.add(edge.target);
      visit(edge.target);
    }
  };
  visit(user.id);

  const pending = new Map([...reachable].map((id) => [id, flows.filter((e) => e.target === id && reachable.has(e.source)).length]));
  const ordered: InvocableNode[] = [];
  let ready = [...pending].filter(([, count]) => count === 0).map(([id]) => id);
  while (ready.length > 0) {
    const next: string[] = [];
    for (const id of ready) {
      ordered.push(nodeById.get(id) as InvocableNode);
      for (const edge of flows.filter((e) => e.source === id && reachable.has(e.target))) {
        const count = pending.get(edge.target)! - 1;
        pending.set(edge.target, count);
        if (count === 0) next.push(edge.target);
      }
    }
    ready = next;
  }
  return ordered.length === reachable.size ? ordered : null;
}

/** nodeIds のノードと、それらにつながるエッジを取り除いたグラフ */
export function removeNodes(graph: GraphDefinition, nodeIds: Iterable<string>): GraphDefinition {
  const removed = new Set(nodeIds);
  return {
    ...graph,
    nodes: graph.nodes.filter((n) => !removed.has(n.id)),
    edges: graph.edges.filter((e) => !removed.has(e.source) && !removed.has(e.target)),
  };
}

/** edgeIds のエッジを取り除いたグラフ */
export function removeEdges(graph: GraphDefinition, edgeIds: Iterable<string>): GraphDefinition {
  const removed = new Set(edgeIds);
  return { ...graph, edges: graph.edges.filter((e) => !removed.has(e.id)) };
}
