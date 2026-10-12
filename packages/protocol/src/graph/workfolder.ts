import type { WorkfolderFiles } from '../api.ts';
import type { AccessPermission, GraphDefinition, NodeOf, WorkfolderEntry } from './schema.ts';

/** ワークフォルダの中の、権限を与える範囲。path が空ならワークフォルダ全体。フォルダならその中のすべてを含む */
export type WorkfolderScope = { path: string; isFolder: boolean };

/** エージェントに与えた、ワークフォルダの中の範囲1つへの権限 */
export type WorkfolderAccess = { scope: WorkfolderScope; permission: AccessPermission };

/** エージェントから出るアクセスエッジが与える権限。送り先がワークフォルダでないエッジや、もう無いエントリへのエッジは除く */
export function agentAccess(graph: GraphDefinition, agent: NodeOf<'agent'>): WorkfolderAccess[] {
  return graph.edges.flatMap((edge) => {
    if (edge.kind !== 'access' || edge.source !== agent.id) return [];
    const target = graph.nodes.find((n) => n.id === edge.target);
    const scope = target?.kind === 'workfolder' ? scopeOf(target, edge.entryId) : null;
    return scope ? [{ scope, permission: edge.permission }] : [];
  });
}

/** ワークフォルダノードの中の entryId のエントリ以下の範囲。null ならワークフォルダ全体。エントリが無ければ null */
export function scopeOf(workfolder: NodeOf<'workfolder'>, entryId: string | null): WorkfolderScope | null {
  if (entryId === null) return { path: '', isFolder: true };
  const entry = workfolder.config.entries.find((e) => e.id === entryId);
  return entry ? { path: entryPath(workfolder.config.entries, entry), isFolder: entry.type === 'folder' } : null;
}

/** path が範囲 scope に含まれるか */
export function isInScope(path: string, scope: WorkfolderScope): boolean {
  return scope.path === '' || path === scope.path || (scope.isFolder && path.startsWith(`${scope.path}/`));
}

/** 範囲の表示名。ワークフォルダ全体なら「全体」 */
export function scopeLabel(scope: WorkfolderScope): string {
  if (scope.path === '') return '全体';
  return scope.isFolder ? `${scope.path}/` : scope.path;
}

/** エントリのワークフォルダでのパス。親が見つからなければそこを直下とみなす */
export function entryPath(entries: WorkfolderEntry[], entry: WorkfolderEntry): string {
  const names = [entry.name];
  const visited = new Set([entry.id]);
  for (let parent = parentOf(entries, entry); parent && !visited.has(parent.id); parent = parentOf(entries, parent)) {
    visited.add(parent.id);
    names.unshift(parent.name);
  }
  return names.join('/');
}

/** 会話の先頭でワークフォルダに写す、初期エントリのファイル。パスや JSON の誤りはここでは検査しない */
export function initialFiles(workfolder: NodeOf<'workfolder'>): WorkfolderFiles {
  const { entries } = workfolder.config;
  return Object.fromEntries(entries.flatMap((e) => (e.type === 'file' ? [[entryPath(entries, e), e.content]] : [])));
}

/** name をエントリの名前にできない理由。できるなら null */
export function entryNameError(name: string): string | null {
  if (name === '') return '名前が空です';
  if (name.includes('/') || name.includes('\\') || name === '.' || name === '..') return `名前 ${name} は使えません。/ や \\ を含まない名前にしてください`;
  return null;
}

/** path をワークフォルダのファイルのパスにできない理由。できるなら null。区切りは / で、先頭の / や . / .. は使えない */
export function filePathError(path: string): string | null {
  if (!isRelativePath(path)) return `パス ${path} は使えません。/ 区切りの相対パスにしてください（例: notes/plan.md）`;
  if (!fileExtensions.some((ext) => path.endsWith(ext))) return `置けるファイルの拡張子は ${fileExtensions.join(' / ')} です`;
  return null;
}

/** ワークフォルダに置けるファイルの拡張子 */
const fileExtensions = ['.md', '.json'] as const;

function parentOf(entries: WorkfolderEntry[], entry: WorkfolderEntry): WorkfolderEntry | undefined {
  return entry.parentId === null ? undefined : entries.find((e) => e.id === entry.parentId);
}

function isRelativePath(path: string): boolean {
  return !path.includes('\\') && path.split('/').every((s) => s !== '' && s !== '.' && s !== '..');
}
