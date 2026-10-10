import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import type { ModelMessage } from 'ai';
import type { GraphDefinition, RunEvent, RunStatus } from 'protocol';

/** 名前を付けて保存されたグラフ */
export const graphs = sqliteTable('graphs', {
  id: text().primaryKey(),
  name: text().notNull(),
  definition: text({ mode: 'json' }).$type<GraphDefinition>().notNull(),
  updatedAt: integer().notNull(),
});

/** 会話。表示中の分岐の末端ターンを持つ */
export const sessions = sqliteTable('sessions', {
  id: text().primaryKey(),
  title: text().notNull(),
  graphId: text()
    .notNull()
    .references(() => graphs.id),
  activeTurnId: text(),
  createdAt: integer().notNull(),
});

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
    /** 実行時点のグラフの写し。元のグラフを後で編集しても変わらない */
    graph: text({ mode: 'json' }).$type<GraphDefinition>().notNull(),
    status: text().$type<RunStatus>().notNull(),
    /** メインエージェントがこのターンで生成したメッセージ。次ターン以降の履歴になる */
    mainMessages: text({ mode: 'json' }).$type<ModelMessage[]>().notNull(),
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

/**
 * ターン時点のファイルを決めるための、ファイルの版。
 * あるターンでのファイルの中身は、そのターンから会話の先頭へ向かって最も近いターンの版で決まる。
 * 同じターン内で何度書いても1つの版にまとめる。
 */
export const fileRevisions = sqliteTable(
  'file_revisions',
  {
    turnId: text()
      .notNull()
      .references(() => turns.id, { onDelete: 'cascade' }),
    volume: text().notNull(),
    path: text().notNull(),
    /** null なら削除 */
    content: text(),
    at: integer().notNull(),
  },
  (t) => [primaryKey({ columns: [t.turnId, t.volume, t.path] })],
);

/**
 * セッションを通して継続するサブエージェントの記憶。
 * 上書きせず書いたターンごとに残すので、ターンの分岐ごとに異なる記憶を持てる。
 */
export const agentMemories = sqliteTable(
  'agent_memories',
  {
    turnId: text()
      .notNull()
      .references(() => turns.id, { onDelete: 'cascade' }),
    memoryKey: text().notNull(),
    messages: text({ mode: 'json' }).$type<ModelMessage[]>().notNull(),
  },
  (t) => [primaryKey({ columns: [t.turnId, t.memoryKey] })],
);
