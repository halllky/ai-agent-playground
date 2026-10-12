import { isInvocable, type FilePermission, type GraphDefinition, type NodeOf } from './schema.ts';
import { agentAccess } from './workfolder.ts';

/** ツール名として各プロバイダが受け付ける文字種 */
export const toolNamePattern = /^[A-Za-z0-9_-]{1,64}$/;

/** ワークフォルダに対する操作。1つの操作が1つのツールになる */
export type FileOperation = 'list' | 'read' | 'write' | 'delete' | 'edit_markdown' | 'patch_json';

/** 作業だけして終わるエージェントが持つ、作業を終えるためのツールの名前 */
export const finishToolName = 'finish';

/** 権限で許される操作 */
export function fileOperationsFor(permission: FilePermission): FileOperation[] {
  return permission === 'write' ? ['list', 'read', 'write', 'delete', 'edit_markdown', 'patch_json'] : ['list', 'read'];
}

/** ワークフォルダに operation を行うツールの名前。ワークフォルダはセッションに1つなので、どの範囲への権限でも同じ名前になる */
export function fileToolName(operation: FileOperation): string {
  return `workfolder_${operation}`;
}

/**
 * エージェントが持つツールの名前。ツールエッジの送り先ごとの名前に加え、
 * ファイルを操作できるアクセスエッジがあれば最も強い権限のワークフォルダのツール、作業だけして終わるなら終了用のツール。
 * 同じ名前が複数あればそのまま重複して並ぶ（ワークフォルダのツールは1組にまとめる）
 */
export function agentToolNames(graph: GraphDefinition, agent: NodeOf<'agent'>): string[] {
  const names: string[] = [];
  for (const edge of graph.edges) {
    if (edge.kind !== 'tool' || edge.source !== agent.id) continue;
    const target = graph.nodes.find((n) => n.id === edge.target);
    if (target && isInvocable(target)) names.push(target.config.name);
  }
  const permissions = agentAccess(graph, agent).map((a) => a.permission);
  if (permissions.length > 0) names.push(...fileOperationsFor(permissions.includes('write') ? 'write' : 'read').map(fileToolName));
  if (agent.config.workOnly) names.push(finishToolName);
  return names;
}
