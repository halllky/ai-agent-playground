import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import type { ModelMessage } from 'ai';
import type { GraphDefinition, RunEvent, RunStatus, WorkfolderFiles } from 'protocol';

/** 会話。次のターンで使うグラフと、表示中の分岐の末端ターンを持つ */
export const sessions = sqliteTable('sessions', {
  id: text().primaryKey(),
  title: text().notNull(),
  graph: text({ mode: 'json' }).$type<GraphDefinition>().notNull(),
  activeTurnId: text(),
  createdAt: integer().notNull(),
});

/**
 * ターンが終わった時点で会話に残っている状態の写し。次のターンは親ターンの写しから始める。
 * files はワークフォルダの中身、seededFolders は初期ファイルを写し終えた files ノードの id、
 * memories はセッションで継続する記憶を持つエージェントノードの id ごとの会話
 */
export type TurnState = { files: WorkfolderFiles; seededFolders: string[]; memories: Record<string, ModelMessage[]> };

/** ユーザーの発言1回と、それに対する実行1回。parentTurnId でツリーを成す */
export const turns = sqliteTable(
  'turns',
  {
    id: text().primaryKey(),
    sessionId: text()
      .notNull()
      .references(() => sessions.id, { onDelete: 'cascade' }),
    parentTurnId: text(),
    userText: text().notNull(),
    /** 実行時点のグラフの写し。セッションのグラフを後で編集しても変わらない */
    graph: text({ mode: 'json' }).$type<GraphDefinition>().notNull(),
    status: text().$type<RunStatus>().notNull(),
    reply: text().notNull(),
    /** 実行中はその時点までの状態 */
    state: text({ mode: 'json' }).$type<TurnState>().notNull(),
    createdAt: integer().notNull(),
  },
  (t) => [index('turns_session_idx').on(t.sessionId)],
);

/** ターン実行中に発生したイベント。永続化対象外の種別は含まない */
export const runEvents = sqliteTable(
  'run_events',
  {
    turnId: text()
      .notNull()
      .references(() => turns.id, { onDelete: 'cascade' }),
    seq: integer().notNull(),
    event: text({ mode: 'json' }).$type<RunEvent>().notNull(),
  },
  (t) => [primaryKey({ columns: [t.turnId, t.seq] })],
);
