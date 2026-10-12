import { tool, type Tool, type ToolSet } from 'ai';
import jsonPatch, { type Operation } from 'fast-json-patch';
import { z } from 'zod';
import {
  agentAccess,
  entryPath,
  fileOperationsFor,
  filePathError,
  fileToolName,
  isInScope,
  scopeLabel,
  type AccessPermission,
  type FileOperation,
  type GraphDefinition,
  type NodeOf,
  type WorkfolderAccess,
} from 'protocol';

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

/**
 * agent がアクセスエッジで与えられた範囲で、ワークフォルダを操作するツール。ツールは最も強い権限の分だけ渡し、パスごとの権限は実行時に検査する。
 * パスの権限は、そのパスを含む範囲への権限のうち最も強いもの。
 * 操作の失敗は例外として投げ、AI SDK がツールのエラーとしてエージェントに返す。
 */
export function workfolderTools(graph: GraphDefinition, agent: NodeOf<'agent'>, workfolder: Workfolder): ToolSet {
  const access = agentAccess(graph, agent);
  if (access.length === 0) return {};
  const scoped = new ScopedWorkfolder(access, workfolder);
  const permission: AccessPermission = access.some((a) => a.permission === 'write') ? 'write' : 'read';
  const guide = { summary: scopeSummaryOf(access), descriptions: descriptionsOf(graph.nodes.find((n) => n.kind === 'workfolder'), access) };
  const tools: ToolSet = {};
  for (const operation of fileOperationsFor(permission)) {
    tools[fileToolName(operation)] = operationTools[operation](scoped, guide);
  }
  return tools;
}

/** Workfolder のうち、権限のある範囲だけを操作できるもの。範囲外の操作は FileError を投げる */
class ScopedWorkfolder {
  constructor(
    private readonly access: WorkfolderAccess[],
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
    const allowed = this.access.filter((a) => needed === 'read' || a.permission === 'write').map((a) => scopeLabel(a.scope));
    throw new FileError(`${path} を${verb}する権限がありません。${verb}できる範囲: ${allowed.join(', ')}`);
  }

  private permissionFor(path: string): AccessPermission | null {
    const permissions = this.access.filter((a) => isInScope(path, a.scope)).map((a) => a.permission);
    return permissions.includes('write') ? 'write' : permissions.includes('read') ? 'read' : null;
  }
}

/** ツールの説明に載せるもの。summary はワークフォルダと権限の範囲の要約で、descriptions は list の説明にだけ載せる各範囲の説明 */
type ToolGuide = { summary: string; descriptions: string };

function scopeSummaryOf(access: WorkfolderAccess[]): string {
  const ranges = access.map((a) => `${scopeLabel(a.scope)}（${a.permission === 'write' ? '編集' : '参照'}）`);
  return `ワークフォルダ。権限のある範囲: ${ranges.join(', ')}`;
}

/** ワークフォルダ全体の説明と、権限のある範囲にある初期エントリの説明を、1行ずつ並べたもの */
function descriptionsOf(workfolder: NodeOf<'workfolder'> | undefined, access: WorkfolderAccess[]): string {
  if (!workfolder) return '';
  const { description, entries } = workfolder.config;
  const lines = description ? [`
- 全体: ${description}`] : [];
  for (const entry of entries) {
    const path = entryPath(entries, entry);
    if (!entry.description || !access.some((a) => isInScope(path, a.scope))) continue;
    lines.push(`
- ${scopeLabel({ path, isFolder: entry.type === 'folder' })}: ${entry.description}`);
  }
  return lines.join('');
}

type OperationTool = (folder: ScopedWorkfolder, guide: ToolGuide) => Tool;

const pathSchema = z.string().describe('ワークフォルダでの / 区切りの相対パス（例: notes/plan.md）');

const operationTools: Record<FileOperation, OperationTool> = {
  list: (folder, guide) =>
    tool({
      description: `${guide.summary}。権限のある範囲のファイルのパスの一覧を返す${guide.descriptions}`,
      inputSchema: z.object({}),
      execute: async () => folder.list(),
    }),
  read: (folder, guide) =>
    tool({
      description: `${guide.summary}。ファイルの中身を読む`,
      inputSchema: z.object({ path: pathSchema }),
      execute: async ({ path }) => folder.read(path),
    }),
  write: (folder, guide) =>
    tool({
      description: `${guide.summary}。Markdown（.md）か JSON（.json）のファイルを作る、または中身全体を書き換える`,
      inputSchema: z.object({ path: pathSchema, content: z.string() }),
      execute: async ({ path, content }) => {
        folder.write(path, content);
        return `${path} に書き込みました`;
      },
    }),
  delete: (folder, guide) =>
    tool({
      description: `${guide.summary}。ファイルを削除する`,
      inputSchema: z.object({ path: pathSchema }),
      execute: async ({ path }) => {
        folder.delete(path);
        return `${path} を削除しました`;
      },
    }),
  edit_markdown: (folder, guide) =>
    tool({
      description: `${guide.summary}。Markdown ファイルの一部を置き換える。oldString はファイル内にちょうど1回現れる文字列にする`,
      inputSchema: z.object({ path: pathSchema, oldString: z.string(), newString: z.string() }),
      execute: async ({ path, oldString, newString }) => {
        folder.editMarkdown(path, oldString, newString);
        return `${path} を編集しました`;
      },
    }),
  patch_json: (folder, guide) =>
    tool({
      description: `${guide.summary}。JSON ファイルの一部を JSON Patch（RFC 6902）で書き換える`,
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
