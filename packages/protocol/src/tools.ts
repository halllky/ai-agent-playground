import type { AccessPermission, GraphEdge, GraphNode, NodeOf } from './graph.ts';

/**
 * ターンごとに版管理されるファイル群1つ分の、ツールとしての見え方。
 * volume はファイルの保存先の識別子、toolPrefix はツール名の接頭辞。
 */
export type VolumeSpec = {
  volume: string;
  toolPrefix: string;
  /** エージェントに見せる、このファイル群の説明 */
  description: string;
  /** 置けるファイルの拡張子 */
  extensions: readonly string[];
};

/** ファイル群に対する操作。1つの操作が1つのツールになる */
export type VolumeOperation = 'list' | 'read' | 'write' | 'delete' | 'edit_markdown' | 'patch_json';

/** ワークフォルダ。セッションに1つだけ持つ */
export const workfolderSpec: VolumeSpec = {
  volume: 'work',
  toolPrefix: 'workfolder',
  description: 'この会話の作業用フォルダ。Markdown（.md）と JSON（.json）のファイルを置ける',
  extensions: ['.md', '.json'],
};

/** リソースノードのファイル群。ノードごとに別の保存先を持つ */
export function resourceSpecOf(node: NodeOf<'resource'>): VolumeSpec {
  return {
    volume: `resource:${node.id}`,
    toolPrefix: node.config.name,
    description: node.config.description || `リソース ${node.config.name}`,
    extensions: ['.json'],
  };
}

/** 権限で許される操作のうち、置けるファイルの種類に意味があるもの */
export function volumeOperationsFor(spec: VolumeSpec, permission: AccessPermission): VolumeOperation[] {
  const operations: VolumeOperation[] = ['list', 'read'];
  if (permission === 'write') {
    operations.push('write', 'delete');
    if (spec.extensions.includes('.md')) operations.push('edit_markdown');
    if (spec.extensions.includes('.json')) operations.push('patch_json');
  }
  return operations;
}

/** spec のファイル群に operation を行うツールの名前 */
export function volumeToolName(spec: VolumeSpec, operation: VolumeOperation): string {
  return `${spec.toolPrefix}_${operation}`;
}

/** path を spec のファイル群に置けない理由。置けるなら null。区切りは / で、先頭の / や . / .. は使えない */
export function volumePathError(spec: VolumeSpec, path: string): string | null {
  const segments = path.split('/');
  if (path.includes('\\') || segments.some((s) => s === '' || s === '.' || s === '..')) {
    return `パス ${path} は使えません。/ 区切りの相対パスにしてください（例: notes/plan.md）`;
  }
  if (!spec.extensions.some((ext) => path.endsWith(ext))) {
    return `置けるファイルの拡張子は ${spec.extensions.join(' / ')} です`;
  }
  return null;
}

/** エッジ1本が送り元のエージェントに与えるツールの名前。接続できない組み合わせなら空 */
export function toolNamesOf(edge: GraphEdge, target: GraphNode): string[] {
  if (edge.kind === 'call' && target.kind === 'subAgent') return [target.config.name];
  if (edge.kind === 'access' && (target.kind === 'workfolder' || target.kind === 'resource')) {
    const spec = target.kind === 'workfolder' ? workfolderSpec : resourceSpecOf(target);
    return volumeOperationsFor(spec, edge.permission).map((op) => volumeToolName(spec, op));
  }
  if (edge.kind === 'use' && (target.kind === 'webSearch' || target.kind === 'judge')) return [target.config.name];
  return [];
}
