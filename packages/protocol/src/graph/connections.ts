import { isInvocable, type EdgeKind, type GraphDefinition, type GraphNode, type InvocableNode, type NodeKind } from './schema.ts';

/**
 * ノード種別ごとの、グラフ上での役割。接続できる組み合わせはすべてここから決まる。
 * usesTools はツールを使う側、isTool はツールとして使われる側、receivesFlow / sendsFlow はフローを受け取れるか / 送り出せるか
 */
export const nodeRoles: Record<NodeKind, { usesTools: boolean; isTool: boolean; receivesFlow: boolean; sendsFlow: boolean }> = {
  userInput: { usesTools: false, isTool: false, receivesFlow: false, sendsFlow: true },
  userOutput: { usesTools: false, isTool: false, receivesFlow: true, sendsFlow: false },
  agent: { usesTools: true, isTool: true, receivesFlow: true, sendsFlow: true },
  files: { usesTools: false, isTool: true, receivesFlow: false, sendsFlow: false },
  judge: { usesTools: false, isTool: true, receivesFlow: true, sendsFlow: true },
  webSearch: { usesTools: false, isTool: true, receivesFlow: true, sendsFlow: true },
};

/** source から target へ kind のエッジを張れるか */
export function canConnect(source: GraphNode, target: GraphNode, kind: EdgeKind): boolean {
  if (source.id === target.id) return false;
  if (kind === 'tool') return nodeRoles[source.kind].usesTools && nodeRoles[target.kind].isTool;
  return nodeRoles[source.kind].sendsFlow && nodeRoles[target.kind].receivesFlow;
}

/**
 * ユーザー入力から流れをたどって届く呼び出せるノードを、前段がすべて先に来る順に並べる。
 * 循環していて順序が決まらなければ null。ユーザー入力ノードが無ければ空
 */
export function flowOrder(graph: GraphDefinition): InvocableNode[] | null {
  const input = graph.nodes.find((n) => n.kind === 'userInput');
  if (!input) return [];
  const nodeById = new Map(graph.nodes.map((n) => [n.id, n]));
  const flows = graph.edges.filter((e) => {
    const source = nodeById.get(e.source);
    const target = nodeById.get(e.target);
    return e.kind === 'flow' && source && target && canConnect(source, target, 'flow') && isInvocable(target);
  });

  const reachable = new Set<string>();
  const visit = (id: string) => {
    for (const edge of flows.filter((e) => e.source === id)) {
      if (reachable.has(edge.target)) continue;
      reachable.add(edge.target);
      visit(edge.target);
    }
  };
  visit(input.id);

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
