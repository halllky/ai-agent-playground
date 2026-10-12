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

/** マイグレーション適用済みの DB 接続。モジュールの読み込み時に開く */
export const db = drizzle(sqlite, { schema, casing: 'snake_case' });

// テーブルの作り直しで、参照元の行が cascade で消えないよう外部キーを止めて適用する。
// マイグレーションはトランザクションの中で走り、その中では foreign_keys を切り替えられないので外側で切り替える
sqlite.pragma('foreign_keys = OFF');
migrate(db, { migrationsFolder: fileURLToPath(new URL('../../drizzle', import.meta.url)) });
const violations = sqlite.pragma('foreign_key_check') as unknown[];
if (violations.length > 0) throw new Error(`マイグレーション後に外部キーの違反があります: ${JSON.stringify(violations)}`);
sqlite.pragma('foreign_keys = ON');
