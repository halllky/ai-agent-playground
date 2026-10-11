import type { AccessPermission, GraphEdge, GraphNode, NodeOf } from './graph.ts';

/** files ノードのファイル群に対する操作。1つの操作が1つのツールになる */
export type FileOperation = 'list' | 'read' | 'write' | 'delete' | 'edit_markdown' | 'patch_json';

/** files ノードに置けるファイルの拡張子 */
const fileExtensions = ['.md', '.json'] as const;

/** 権限で許される操作 */
export function fileOperationsFor(permission: AccessPermission): FileOperation[] {
  return permission === 'write' ? ['list', 'read', 'write', 'delete', 'edit_markdown', 'patch_json'] : ['list', 'read'];
}

/** files ノードに operation を行うツールの名前 */
export function fileToolName(node: NodeOf<'files'>, operation: FileOperation): string {
  return `${node.config.name}_${operation}`;
}

/** path を files ノードに置けない理由。置けるなら null。区切りは / で、先頭の / や . / .. は使えない */
export function filePathError(path: string): string | null {
  const segments = path.split('/');
  if (path.includes('\\') || segments.some((s) => s === '' || s === '.' || s === '..')) {
    return `パス ${path} は使えません。/ 区切りの相対パスにしてください（例: notes/plan.md）`;
  }
  if (!fileExtensions.some((ext) => path.endsWith(ext))) {
    return `置けるファイルの拡張子は ${fileExtensions.join(' / ')} です`;
  }
  return null;
}

/** ツールエッジ1本が送り元のエージェントに与えるツールの名前。ツールにならない組み合わせなら空 */
export function toolNamesOf(edge: GraphEdge, target: GraphNode): string[] {
  if (edge.kind !== 'tool') return [];
  switch (target.kind) {
    case 'files':
      return fileOperationsFor(edge.permission).map((op) => fileToolName(target, op));
    case 'agent':
    case 'judge':
    case 'webSearch':
      return [target.config.name];
    case 'user':
      return [];
  }
}
