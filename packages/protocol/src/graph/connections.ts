import {
  isInvocable,
  type CallMemoryMode,
  type EdgeKind,
  type GraphDefinition,
  type GraphEdge,
  type GraphNode,
  type InvocableNode,
  type NodeKind,
} from './schema.ts';

/**
 * ノード種別ごとの、グラフ上での役割。接続できる組み合わせはすべてここから決まる。
 * usesTools はツールとワークフォルダを使う側、isTool はツールとして使われる側、isWorkfolder はワークフォルダ、
 * receivesFlow / sendsFlow はフローを受け取れるか / 送り出せるか
 */
export const nodeRoles: Record<NodeKind, { usesTools: boolean; isTool: boolean; isWorkfolder: boolean; receivesFlow: boolean; sendsFlow: boolean }> = {
  userInput: { usesTools: false, isTool: false, isWorkfolder: false, receivesFlow: false, sendsFlow: true },
  userOutput: { usesTools: false, isTool: false, isWorkfolder: false, receivesFlow: true, sendsFlow: false },
  agent: { usesTools: true, isTool: true, isWorkfolder: false, receivesFlow: true, sendsFlow: true },
  workfolder: { usesTools: false, isTool: false, isWorkfolder: true, receivesFlow: false, sendsFlow: false },
  judge: { usesTools: false, isTool: true, isWorkfolder: false, receivesFlow: true, sendsFlow: true },
  webSearch: { usesTools: false, isTool: true, isWorkfolder: false, receivesFlow: true, sendsFlow: true },
};

/** source から target へ kind のエッジを張れるか */
export function canConnect(source: GraphNode, target: GraphNode, kind: EdgeKind): boolean {
  if (source.id === target.id) return false;
  switch (kind) {
    case 'tool':
      return nodeRoles[source.kind].usesTools && nodeRoles[target.kind].isTool;
    case 'access':
      return nodeRoles[source.kind].usesTools && nodeRoles[target.kind].isWorkfolder;
    case 'flow':
      return nodeRoles[source.kind].sendsFlow && nodeRoles[target.kind].receivesFlow;
  }
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

/**
 * フローから nodeId のノードを呼ぶときの、依頼と応答の記憶。入ってくるフローエッジのどれかが session なら session。
 * フローではノードは1ターンに1回しか呼ばれないので、turn は記憶なしと同じに扱う
 */
export function flowMemoryOf(graph: GraphDefinition, nodeId: string): Exclude<CallMemoryMode, 'turn'> {
  return graph.edges.some((e) => e.kind === 'flow' && e.target === nodeId && e.memory === 'session') ? 'session' : 'none';
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

/** node と同じ id のノードを node に差し替えたグラフ。ワークフォルダのもう無いエントリへのアクセスエッジは取り除く */
export function replaceNode(graph: GraphDefinition, node: GraphNode): GraphDefinition {
  const entryIds = node.kind === 'workfolder' ? new Set(node.config.entries.map((e) => e.id)) : undefined;
  return {
    ...graph,
    nodes: graph.nodes.map((n) => (n.id === node.id ? node : n)),
    edges: graph.edges.filter((e) => !entryIds || e.kind !== 'access' || e.target !== node.id || e.entryId === null || entryIds.has(e.entryId)),
  };
}

/** edge と同じ id のエッジを edge に差し替えたグラフ */
export function replaceEdge(graph: GraphDefinition, edge: GraphEdge): GraphDefinition {
  return { ...graph, edges: graph.edges.map((e) => (e.id === edge.id ? edge : e)) };
}

/** edgeIds のエッジを取り除いたグラフ */
export function removeEdges(graph: GraphDefinition, edgeIds: Iterable<string>): GraphDefinition {
  const removed = new Set(edgeIds);
  return { ...graph, edges: graph.edges.filter((e) => !removed.has(e.id)) };
}
