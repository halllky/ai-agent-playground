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
