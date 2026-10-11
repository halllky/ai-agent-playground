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
