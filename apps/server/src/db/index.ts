import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from './schema.ts';

export * from './schema.ts';

const databasePath = resolve(process.env.DATABASE_PATH || 'data/playground.db');
mkdirSync(dirname(databasePath), { recursive: true });

const sqlite = new Database(databasePath);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');

/** マイグレーション適用済みの DB 接続。モジュールの読み込み時に開く */
export const db = drizzle(sqlite, { schema, casing: 'snake_case' });

migrate(db, { migrationsFolder: fileURLToPath(new URL('../../drizzle', import.meta.url)) });

/** turnId 自身から会話の先頭まで、近い順に並べた祖先ターンの id */
export function lineageOf(turnId: string): string[] {
  const rows = sqlite
    .prepare(
      `WITH RECURSIVE lineage(id, parent_turn_id, depth) AS (
         SELECT id, parent_turn_id, 0 FROM turns WHERE id = ?
         UNION ALL
         SELECT t.id, t.parent_turn_id, l.depth + 1 FROM turns t JOIN lineage l ON t.id = l.parent_turn_id
       )
       SELECT id FROM lineage ORDER BY depth`,
    )
    .all(turnId) as { id: string }[];
  return rows.map((r) => r.id);
}

/**
 * ターンごとに版を残した行から、キーごとに lineage の中で最も近いターンの行を選ぶ。
 * lineage は lineageOf の結果で、lineage に含まれないターンの行は無視する。
 */
export function nearestVersions<T extends { turnId: string }, K>(lineage: string[], rows: T[], keyOf: (row: T) => K): Map<K, T> {
  const distance = new Map(lineage.map((turnId, i) => [turnId, i]));
  const nearest = new Map<K, T>();
  for (const row of rows) {
    const d = distance.get(row.turnId);
    if (d === undefined) continue;
    const key = keyOf(row);
    const current = nearest.get(key);
    if (!current || d < distance.get(current.turnId)!) nearest.set(key, row);
  }
  return nearest;
}
