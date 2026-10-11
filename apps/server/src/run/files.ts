import { tool, type Tool, type ToolSet } from 'ai';
import jsonPatch, { type Operation } from 'fast-json-patch';
import { z } from 'zod';
import { fileOperationsFor, filePathError, fileToolName, type AccessPermission, type FileOperation, type NodeOf } from 'protocol';

/** エージェントにそのまま見せられる理由を持つ、ファイル操作の失敗 */
export class FileError extends Error {}

/**
 * files ノード1つ分の、実行中のターンから見たファイル群。
 * files（パスから中身へ）を直接書き換え、書き換えるたびに onChange を呼ぶ。不正な操作は FileError を投げる
 */
export class FileGroup {
  constructor(
    private readonly files: Record<string, string>,
    private readonly onChange: () => void,
  ) {}

  list(): string[] {
    return Object.keys(this.files).sort();
  }

  read(path: string): string {
    return this.existingContent(validPath(path));
  }

  write(path: string, content: string): void {
    const valid = validPath(path);
    if (valid.endsWith('.json')) parseJson(content);
    this.save(valid, content);
  }

  delete(path: string): void {
    const valid = validPath(path);
    this.existingContent(valid);
    delete this.files[valid];
    this.onChange();
  }

  /** oldString がちょうど1回現れるときだけ newString に置き換える */
  editMarkdown(path: string, oldString: string, newString: string): void {
    const valid = validPath(path);
    if (!valid.endsWith('.md')) throw new FileError('Markdown ファイル（.md）ではありません');
    if (!oldString) throw new FileError('置き換える文字列が空です');
    const content = this.existingContent(valid);
    const count = content.split(oldString).length - 1;
    if (count !== 1) {
      throw new FileError(
        count === 0 ? '置き換える文字列が見つかりません' : `置き換える文字列が ${count} 箇所にあります。1箇所に絞れるよう前後を含めてください`,
      );
    }
    this.save(valid, content.replace(oldString, () => newString));
  }

  patchJson(path: string, operations: Operation[]): void {
    const valid = validPath(path);
    if (!valid.endsWith('.json')) throw new FileError('JSON ファイル（.json）ではありません');
    const document = parseJson(this.existingContent(valid));
    let patched: unknown;
    try {
      patched = jsonPatch.applyPatch(document, operations, true, false).newDocument;
    } catch (e) {
      throw new FileError(`JSON Patch を適用できません: ${e instanceof Error ? e.message : String(e)}`);
    }
    this.save(valid, JSON.stringify(patched, null, 2));
  }

  private existingContent(path: string): string {
    if (!Object.hasOwn(this.files, path)) throw new FileError(`ファイル ${path} はありません`);
    return this.files[path];
  }

  private save(path: string, content: string): void {
    this.files[path] = content;
    this.onChange();
  }
}

/**
 * files ノードのファイル群を permission の範囲で操作するツール。changed は書き込み・削除のたびに呼ぶ。
 * 操作の失敗は例外として投げ、AI SDK がツールのエラーとしてエージェントに返す。
 */
export function fileTools(
  node: NodeOf<'files'>,
  permission: AccessPermission,
  group: FileGroup,
  changed: (path: string, deleted: boolean) => void,
): ToolSet {
  const description = node.config.description || `ファイル群 ${node.config.name}`;
  const tools: ToolSet = {};
  for (const operation of fileOperationsFor(permission)) {
    tools[fileToolName(node, operation)] = operationTools[operation](group, changed, description);
  }
  return tools;
}

type OperationTool = (group: FileGroup, changed: (path: string, deleted: boolean) => void, description: string) => Tool;

const pathSchema = z.string().describe('/ 区切りの相対パス（例: notes/plan.md）');

const operationTools: Record<FileOperation, OperationTool> = {
  list: (group, _, description) =>
    tool({
      description: `${description}。ファイルのパスの一覧を返す`,
      inputSchema: z.object({}),
      execute: async () => group.list(),
    }),
  read: (group, _, description) =>
    tool({
      description: `${description}。ファイルの中身を読む`,
      inputSchema: z.object({ path: pathSchema }),
      execute: async ({ path }) => group.read(path),
    }),
  write: (group, changed, description) =>
    tool({
      description: `${description}。Markdown（.md）か JSON（.json）のファイルを作る、または中身全体を書き換える`,
      inputSchema: z.object({ path: pathSchema, content: z.string() }),
      execute: async ({ path, content }) => {
        group.write(path, content);
        changed(path, false);
        return `${path} に書き込みました`;
      },
    }),
  delete: (group, changed, description) =>
    tool({
      description: `${description}。ファイルを削除する`,
      inputSchema: z.object({ path: pathSchema }),
      execute: async ({ path }) => {
        group.delete(path);
        changed(path, true);
        return `${path} を削除しました`;
      },
    }),
  edit_markdown: (group, changed, description) =>
    tool({
      description: `${description}。Markdown ファイルの一部を置き換える。oldString はファイル内にちょうど1回現れる文字列にする`,
      inputSchema: z.object({ path: pathSchema, oldString: z.string(), newString: z.string() }),
      execute: async ({ path, oldString, newString }) => {
        group.editMarkdown(path, oldString, newString);
        changed(path, false);
        return `${path} を編集しました`;
      },
    }),
  patch_json: (group, changed, description) =>
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
        group.patchJson(path, operations as Operation[]);
        changed(path, false);
        return `${path} を編集しました`;
      },
    }),
};

function validPath(path: string): string {
  const error = filePathError(path);
  if (error) throw new FileError(error);
  return path;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new FileError(`JSON として読めません: ${e instanceof Error ? e.message : String(e)}`);
  }
}
