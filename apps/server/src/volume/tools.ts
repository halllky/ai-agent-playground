import { tool, type Tool, type ToolSet } from 'ai';
import { z } from 'zod';
import { volumeOperationsFor, volumeToolName, type AccessPermission, type RunEventBody, type VolumeOperation, type VolumeSpec } from 'protocol';
import { Volume } from './index.ts';

/** ファイル群のツールを使うエージェント呼び出しのうち、ツールが必要とするもの */
export type VolumeToolContext = {
  turnId: string;
  emit(body: RunEventBody): void;
};

/**
 * spec のファイル群を permission の範囲で操作するツール。
 * 操作の失敗は例外として投げ、AI SDK がツールのエラーとしてエージェントに返す。
 */
export function volumeTools(spec: VolumeSpec, permission: AccessPermission, context: VolumeToolContext): ToolSet {
  const volume = new Volume(context.turnId, spec);
  const changed = (path: string, deleted: boolean) => context.emit({ type: 'file.change', volume: spec.volume, path, deleted });
  const tools: ToolSet = {};
  for (const operation of volumeOperationsFor(spec, permission)) {
    tools[volumeToolName(spec, operation)] = operationTools[operation](volume, changed, spec.description);
  }
  return tools;
}

type OperationTool = (volume: Volume, changed: (path: string, deleted: boolean) => void, description: string) => Tool;

const pathSchema = z.string().describe('/ 区切りの相対パス（例: notes/plan.md）');

const operationTools: Record<VolumeOperation, OperationTool> = {
  list: (volume, _, description) =>
    tool({
      description: `${description}。ファイルのパスの一覧を返す`,
      inputSchema: z.object({}),
      execute: async () => volume.list(),
    }),
  read: (volume, _, description) =>
    tool({
      description: `${description}。ファイルの中身を読む`,
      inputSchema: z.object({ path: pathSchema }),
      execute: async ({ path }) => volume.read(path),
    }),
  write: (volume, changed, description) =>
    tool({
      description: `${description}。ファイルを作る、または中身全体を書き換える`,
      inputSchema: z.object({ path: pathSchema, content: z.string() }),
      execute: async ({ path, content }) => {
        volume.write(path, content);
        changed(path, false);
        return `${path} に書き込みました`;
      },
    }),
  delete: (volume, changed, description) =>
    tool({
      description: `${description}。ファイルを削除する`,
      inputSchema: z.object({ path: pathSchema }),
      execute: async ({ path }) => {
        volume.delete(path);
        changed(path, true);
        return `${path} を削除しました`;
      },
    }),
  edit_markdown: (volume, changed, description) =>
    tool({
      description: `${description}。Markdown ファイルの一部を置き換える。oldString はファイル内にちょうど1回現れる文字列にする`,
      inputSchema: z.object({ path: pathSchema, oldString: z.string(), newString: z.string() }),
      execute: async ({ path, oldString, newString }) => {
        volume.editMarkdown(path, oldString, newString);
        changed(path, false);
        return `${path} を編集しました`;
      },
    }),
  patch_json: (volume, changed, description) =>
    tool({
      description: `${description}。JSON ファイルの一部を JSON Patch（RFC 6902）で書き換える`,
      inputSchema: z.object({
        path: pathSchema,
        operations: z.array(
          z.object({
            op: z.enum(['add', 'remove', 'replace', 'move', 'copy', 'test']),
            path: z.string().describe('JSON Pointer（例: /items/0/name）'),
            value: z.unknown().optional(),
            from: z.string().optional().describe('move / copy の元の JSON Pointer'),
          }),
        ),
      }),
      execute: async ({ path, operations }) => {
        volume.patchJson(path, operations as Parameters<Volume['patchJson']>[1]);
        changed(path, false);
        return `${path} を編集しました`;
      },
    }),
};
