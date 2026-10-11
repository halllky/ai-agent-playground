import { tool, type Tool, type ToolSet } from 'ai';
import jsonPatch, { type Operation } from 'fast-json-patch';
import { z } from 'zod';
import { fileOperationsFor, filePathError, fileToolName, folderLabel, isInFolder, type AccessPermission, type FileOperation } from 'protocol';

/** エージェントにそのまま見せられる理由を持つ、ファイル操作の失敗 */
export class FileError extends Error {}

/**
 * 実行中のターンから見たワークフォルダ。権限は扱わず、置けるパスかどうかだけを検査する。
 * files（パスから中身へ）を直接書き換え、書き換えるたびに onChange を呼ぶ。不正な操作は FileError を投げる
 */
export class Workfolder {
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

  has(path: string): boolean {
    return Object.hasOwn(this.files, path);
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
    if (!this.has(path)) throw new FileError(`ファイル ${path} はありません`);
    return this.files[path];
  }

  private save(path: string, content: string): void {
    this.files[path] = content;
    this.onChange();
  }
}

/** エージェントに与えた、ワークフォルダの中のフォルダ1つへの権限。folder が空ならワークフォルダ全体 */
export type FolderAccess = { folder: string; permission: AccessPermission; description: string };

/**
 * ワークフォルダを access の範囲で操作するツール。ツールは最も強い権限の分だけ渡し、パスごとの権限は実行時に検査する。
 * パスの権限は、そのパスを含むフォルダへの権限のうち最も強いもの。
 * 操作の失敗は例外として投げ、AI SDK がツールのエラーとしてエージェントに返す。
 */
export function workfolderTools(access: FolderAccess[], workfolder: Workfolder): ToolSet {
  if (access.length === 0) return {};
  const scoped = new ScopedWorkfolder(access, workfolder);
  const permission: AccessPermission = access.some((a) => a.permission === 'write') ? 'write' : 'read';
  const tools: ToolSet = {};
  for (const operation of fileOperationsFor(permission)) {
    tools[fileToolName(operation)] = operationTools[operation](scoped, scopeSummaryOf(access));
  }
  return tools;
}

/** Workfolder のうち、権限のある範囲だけを操作できるもの。範囲外の操作は FileError を投げる */
class ScopedWorkfolder {
  constructor(
    readonly access: FolderAccess[],
    private readonly workfolder: Workfolder,
  ) {}

  list(): string[] {
    return this.workfolder.list().filter((path) => this.permissionFor(path) !== null);
  }

  read(path: string): string {
    this.require(path, 'read');
    return this.workfolder.read(path);
  }

  write(path: string, content: string): void {
    this.require(path, 'write');
    this.workfolder.write(path, content);
  }

  delete(path: string): void {
    this.require(path, 'write');
    this.workfolder.delete(path);
  }

  editMarkdown(path: string, oldString: string, newString: string): void {
    this.require(path, 'write');
    this.workfolder.editMarkdown(path, oldString, newString);
  }

  patchJson(path: string, operations: Operation[]): void {
    this.require(path, 'write');
    this.workfolder.patchJson(path, operations);
  }

  private require(path: string, needed: AccessPermission): void {
    const permission = this.permissionFor(path);
    if (permission === 'write' || permission === needed) return;
    const verb = needed === 'write' ? '編集' : '参照';
    const allowed = this.access.filter((a) => needed === 'read' || a.permission === 'write').map((a) => folderLabel(a.folder));
    throw new FileError(`${path} を${verb}する権限がありません。${verb}できる範囲: ${allowed.join(', ')}`);
  }

  private permissionFor(path: string): AccessPermission | null {
    const permissions = this.access.filter((a) => isInFolder(path, a.folder)).map((a) => a.permission);
    return permissions.includes('write') ? 'write' : permissions.includes('read') ? 'read' : null;
  }
}

/** ツールの説明の頭に付ける、ワークフォルダと権限の範囲の要約 */
function scopeSummaryOf(access: FolderAccess[]): string {
  const ranges = access.map((a) => `${folderLabel(a.folder)}（${a.permission === 'write' ? '編集' : '参照'}）`);
  return `ワークフォルダ。権限のある範囲: ${ranges.join(', ')}`;
}

/** list の説明には、フォルダごとの説明も載せる */
function folderDescriptionsOf(access: FolderAccess[]): string {
  return access
    .filter((a) => a.description)
    .map((a) => `\n- ${folderLabel(a.folder)}: ${a.description}`)
    .join('');
}

type OperationTool = (folder: ScopedWorkfolder, summary: string) => Tool;

const pathSchema = z.string().describe('ワークフォルダでの / 区切りの相対パス（例: notes/plan.md）');

const operationTools: Record<FileOperation, OperationTool> = {
  list: (folder, summary) =>
    tool({
      description: `${summary}。権限のある範囲のファイルのパスの一覧を返す${folderDescriptionsOf(folder.access)}`,
      inputSchema: z.object({}),
      execute: async () => folder.list(),
    }),
  read: (folder, summary) =>
    tool({
      description: `${summary}。ファイルの中身を読む`,
      inputSchema: z.object({ path: pathSchema }),
      execute: async ({ path }) => folder.read(path),
    }),
  write: (folder, summary) =>
    tool({
      description: `${summary}。Markdown（.md）か JSON（.json）のファイルを作る、または中身全体を書き換える`,
      inputSchema: z.object({ path: pathSchema, content: z.string() }),
      execute: async ({ path, content }) => {
        folder.write(path, content);
        return `${path} に書き込みました`;
      },
    }),
  delete: (folder, summary) =>
    tool({
      description: `${summary}。ファイルを削除する`,
      inputSchema: z.object({ path: pathSchema }),
      execute: async ({ path }) => {
        folder.delete(path);
        return `${path} を削除しました`;
      },
    }),
  edit_markdown: (folder, summary) =>
    tool({
      description: `${summary}。Markdown ファイルの一部を置き換える。oldString はファイル内にちょうど1回現れる文字列にする`,
      inputSchema: z.object({ path: pathSchema, oldString: z.string(), newString: z.string() }),
      execute: async ({ path, oldString, newString }) => {
        folder.editMarkdown(path, oldString, newString);
        return `${path} を編集しました`;
      },
    }),
  patch_json: (folder, summary) =>
    tool({
      description: `${summary}。JSON ファイルの一部を JSON Patch（RFC 6902）で書き換える`,
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
        folder.patchJson(path, operations as Operation[]);
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
