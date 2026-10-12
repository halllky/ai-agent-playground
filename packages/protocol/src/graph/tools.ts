import { isInvocable, type AccessPermission, type GraphDefinition, type NodeOf } from './schema.ts';

/** ツール名として各プロバイダが受け付ける文字種 */
export const toolNamePattern = /^[A-Za-z0-9_-]{1,64}$/;

/** ワークフォルダに対する操作。1つの操作が1つのツールになる */
export type FileOperation = 'list' | 'read' | 'write' | 'delete' | 'edit_markdown' | 'patch_json';

/** 返すものが「なし」のエージェントが持つ、作業を終えるためのツールの名前 */
export const finishToolName = 'finish';

/** ワークフォルダに置けるファイルの拡張子 */
const fileExtensions = ['.md', '.json'] as const;

/** 権限で許される操作 */
export function fileOperationsFor(permission: AccessPermission): FileOperation[] {
  return permission === 'write' ? ['list', 'read', 'write', 'delete', 'edit_markdown', 'patch_json'] : ['list', 'read'];
}

/** ワークフォルダに operation を行うツールの名前。ワークフォルダはセッションに1つなので、どのフォルダへの権限でも同じ名前になる */
export function fileToolName(operation: FileOperation): string {
  return `workfolder_${operation}`;
}

/** path をワークフォルダのファイルのパスにできない理由。できるなら null。区切りは / で、先頭の / や . / .. は使えない */
export function filePathError(path: string): string | null {
  if (!isRelativePath(path)) return `パス ${path} は使えません。/ 区切りの相対パスにしてください（例: notes/plan.md）`;
  if (!fileExtensions.some((ext) => path.endsWith(ext))) return `置けるファイルの拡張子は ${fileExtensions.join(' / ')} です`;
  return null;
}

/** path をフォルダのパスにできない理由。できるなら null。空ならワークフォルダ全体 */
export function folderPathError(path: string): string | null {
  return path === '' || isRelativePath(path) ? null : `フォルダのパス ${path} は使えません。/ 区切りの相対パスにするか、全体なら空にしてください（例: notes）`;
}

/** フォルダ folder の中の相対パス path の、ワークフォルダでのパス */
export function pathInFolder(folder: string, path: string): string {
  return folder ? `${folder}/${path}` : path;
}

/** path がフォルダ folder の中にあるか */
export function isInFolder(path: string, folder: string): boolean {
  return folder === '' || path.startsWith(`${folder}/`);
}

/** フォルダの表示名。ワークフォルダ全体なら「全体」 */
export function folderLabel(folder: string): string {
  return folder ? `${folder}/` : '全体';
}

/**
 * エージェントが持つツールの名前。ツールエッジの送り先ごとの名前に加え、
 * フォルダへのエッジがあれば最も強い権限のワークフォルダのツール、返すものが「なし」なら終了用のツール。
 * 同じ名前が複数あればそのまま重複して並ぶ（ワークフォルダのツールは1組にまとめる）
 */
export function agentToolNames(graph: GraphDefinition, agent: NodeOf<'agent'>): string[] {
  const names: string[] = [];
  let folderPermission: AccessPermission | null = null;
  for (const edge of graph.edges) {
    if (edge.kind !== 'tool' || edge.source !== agent.id) continue;
    const target = graph.nodes.find((n) => n.id === edge.target);
    if (target?.kind === 'files') {
      if (folderPermission !== 'write') folderPermission = edge.permission;
    } else if (target && isInvocable(target)) {
      names.push(target.config.name);
    }
  }
  if (folderPermission) names.push(...fileOperationsFor(folderPermission).map(fileToolName));
  if (agent.config.returns === 'none') names.push(finishToolName);
  return names;
}

function isRelativePath(path: string): boolean {
  return !path.includes('\\') && path.split('/').every((s) => s !== '' && s !== '.' && s !== '..');
}
