import { edgeKindBetween, toolNamePattern, type GraphDefinition, type GraphNode } from './graph.ts';
import type { ModelInfo } from './model.ts';

export type GraphWarning = {
  target: { nodeId: string } | { edgeId: string } | { graph: true };
  message: string;
};

/**
 * 実行はできるが意図どおりに動かない可能性がある構成を列挙する。
 * 実行を止める判定には使わない（実験のため、警告付きでも実行できるようにしている）。
 */
export function diagnoseGraph(graph: GraphDefinition, models: ModelInfo[] | undefined): GraphWarning[] {
  const warnings: GraphWarning[] = [];
  const nodeById = new Map(graph.nodes.map((n) => [n.id, n]));
  const modelById = models && new Map(models.map((m) => [m.id, m]));

  const mainCount = graph.nodes.filter((n) => n.kind === 'mainAgent').length;
  if (mainCount !== 1) {
    warnings.push({ target: { graph: true }, message: `メインエージェントがちょうど1つ必要です（現在 ${mainCount}）` });
  }

  for (const node of graph.nodes) {
    const outgoing = graph.edges.filter((e) => e.source === node.id);
    const model = modelById?.get(node.config.model);
    if (modelById && !model) {
      warnings.push({ target: { nodeId: node.id }, message: `モデル ${node.config.model} が一覧にありません` });
    }
    if (model && !model.supportsTools && outgoing.length > 0) {
      warnings.push({ target: { nodeId: node.id }, message: 'ツールコール非対応のモデルからエッジが出ています' });
    }
    if (node.kind === 'subAgent' && !toolNamePattern.test(node.config.name)) {
      warnings.push({ target: { nodeId: node.id }, message: 'ツール名は半角英数字・_・- の64文字以内にしてください' });
    }
    warnings.push(...duplicateToolNameWarnings(node, outgoing, nodeById));
  }

  for (const edge of graph.edges) {
    const source = nodeById.get(edge.source);
    const target = nodeById.get(edge.target);
    if (!source || !target || edgeKindBetween(source, target) !== edge.kind) {
      warnings.push({ target: { edgeId: edge.id }, message: 'このノード同士は接続できません' });
    }
  }

  return warnings;
}

function duplicateToolNameWarnings(
  node: GraphNode,
  outgoing: GraphDefinition['edges'],
  nodeById: Map<string, GraphNode>,
): GraphWarning[] {
  const seen = new Set<string>();
  const warnings: GraphWarning[] = [];
  for (const edge of outgoing) {
    const target = nodeById.get(edge.target);
    if (target?.kind !== 'subAgent') continue;
    if (seen.has(target.config.name)) {
      warnings.push({ target: { nodeId: node.id }, message: `ツール名 ${target.config.name} が重複しています` });
    }
    seen.add(target.config.name);
  }
  return warnings;
}
