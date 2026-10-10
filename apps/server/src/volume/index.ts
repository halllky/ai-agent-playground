import { and, eq, inArray } from 'drizzle-orm';
import jsonPatch, { type Operation } from 'fast-json-patch';
import { volumePathError, type FileEntry, type VolumeSpec } from 'protocol';
import { db, fileRevisions, lineageOf, nearestVersions } from '../db/index.ts';

/**
 * turnId の時点で存在するファイルの一覧。volume を省略すると全 volume。
 * ターン時点の中身はそのターンから会話の先頭へ向かって最も近い版で決まるので、
 * 過去ターンからやり直した分岐では、分岐元の時点のファイルに戻る。
 */
export function filesAt(turnId: string, volume?: string): FileEntry[] {
  return [...revisionsAt(turnId, volume).values()]
    .filter((r) => r.content !== null)
    .map((r) => ({ volume: r.volume, path: r.path, turnId: r.turnId, at: r.at }))
    .sort((a, b) => a.volume.localeCompare(b.volume) || a.path.localeCompare(b.path));
}

/** turnId の時点のファイルの中身。存在しなければ undefined */
export function fileContentAt(turnId: string, volume: string, path: string): string | undefined {
  const lineage = lineageOf(turnId);
  const rows = db
    .select()
    .from(fileRevisions)
    .where(and(eq(fileRevisions.volume, volume), eq(fileRevisions.path, path), inArray(fileRevisions.turnId, lineage)))
    .all();
  return nearestVersions(lineage, rows, (r) => r.path).get(path)?.content ?? undefined;
}

/** エージェントにそのまま見せられる理由を持つ、ファイル操作の失敗 */
export class VolumeError extends Error {}

/**
 * 実行中のターンから見た1つのファイル群。書き込みはそのターンの版になる。
 * 不正な操作は VolumeError を投げる。
 */
export class Volume {
  constructor(
    private readonly turnId: string,
    private readonly spec: VolumeSpec,
  ) {}

  /**
   * 会話のここまでで一度も書き込まれていなければ、files を初期の中身として書き込む。
   * 書き込めなかったファイルは、理由を返して飛ばす。
   */
  seed(files: { path: string; content: string }[]): string[] {
    const lineage = lineageOf(this.turnId);
    const written = db
      .select({ turnId: fileRevisions.turnId })
      .from(fileRevisions)
      .where(and(eq(fileRevisions.volume, this.spec.volume), inArray(fileRevisions.turnId, lineage)))
      .get();
    if (written) return [];
    const failures: string[] = [];
    for (const file of files) {
      try {
        this.write(file.path, file.content);
      } catch (e) {
        if (!(e instanceof VolumeError)) throw e;
        failures.push(`${file.path}: ${e.message}`);
      }
    }
    return failures;
  }

  list(): string[] {
    return filesAt(this.turnId, this.spec.volume).map((f) => f.path);
  }

  read(path: string): string {
    return this.existingContent(this.validPath(path));
  }

  write(path: string, content: string): void {
    const valid = this.validPath(path);
    if (valid.endsWith('.json')) parseJson(content);
    this.save(valid, content);
  }

  delete(path: string): void {
    const valid = this.validPath(path);
    this.existingContent(valid);
    this.save(valid, null);
  }

  /** oldString がちょうど1回現れるときだけ newString に置き換える */
  editMarkdown(path: string, oldString: string, newString: string): void {
    const valid = this.validPath(path);
    if (!valid.endsWith('.md')) throw new VolumeError('Markdown ファイル（.md）ではありません');
    if (!oldString) throw new VolumeError('置き換える文字列が空です');
    const content = this.existingContent(valid);
    const count = content.split(oldString).length - 1;
    if (count !== 1) {
      throw new VolumeError(
        count === 0 ? '置き換える文字列が見つかりません' : `置き換える文字列が ${count} 箇所にあります。1箇所に絞れるよう前後を含めてください`,
      );
    }
    this.save(valid, content.replace(oldString, () => newString));
  }

  patchJson(path: string, operations: Operation[]): void {
    const valid = this.validPath(path);
    if (!valid.endsWith('.json')) throw new VolumeError('JSON ファイル（.json）ではありません');
    const document = parseJson(this.existingContent(valid));
    let patched: unknown;
    try {
      patched = jsonPatch.applyPatch(document, operations, true, false).newDocument;
    } catch (e) {
      throw new VolumeError(`JSON Patch を適用できません: ${e instanceof Error ? e.message : String(e)}`);
    }
    this.save(valid, JSON.stringify(patched, null, 2));
  }

  private validPath(path: string): string {
    const error = volumePathError(this.spec, path);
    if (error) throw new VolumeError(error);
    return path;
  }

  private existingContent(path: string): string {
    const content = fileContentAt(this.turnId, this.spec.volume, path);
    if (content === undefined) throw new VolumeError(`ファイル ${path} はありません`);
    return content;
  }

  private save(path: string, content: string | null): void {
    const at = Date.now();
    db.insert(fileRevisions)
      .values({ turnId: this.turnId, volume: this.spec.volume, path, content, at })
      .onConflictDoUpdate({ target: [fileRevisions.turnId, fileRevisions.volume, fileRevisions.path], set: { content, at } })
      .run();
  }
}

function revisionsAt(turnId: string, volume: string | undefined) {
  const lineage = lineageOf(turnId);
  const inLineage = inArray(fileRevisions.turnId, lineage);
  const rows = db
    .select()
    .from(fileRevisions)
    .where(volume === undefined ? inLineage : and(inLineage, eq(fileRevisions.volume, volume)))
    .all();
  return nearestVersions(lineage, rows, (r) => `${r.volume}\n${r.path}`);
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new VolumeError(`JSON として読めません: ${e instanceof Error ? e.message : String(e)}`);
  }
}
