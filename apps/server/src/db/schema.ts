import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import type { ModelMessage } from 'ai';
import type { GraphDefinition, RunEvent, RunStatus } from 'protocol';

export const graphs = sqliteTable('graphs', {
  id: text().primaryKey(),
  name: text().notNull(),
  definition: text({ mode: 'json' }).$type<GraphDefinition>().notNull(),
  updatedAt: integer().notNull(),
});

export const sessions = sqliteTable('sessions', {
  id: text().primaryKey(),
  title: text().notNull(),
  graphId: text()
    .notNull()
    .references(() => graphs.id),
  activeTurnId: text(),
  createdAt: integer().notNull(),
});

export const turns = sqliteTable(
  'turns',
  {
    id: text().primaryKey(),
    sessionId: text()
      .notNull()
      .references(() => sessions.id, { onDelete: 'cascade' }),
    parentTurnId: text(),
    userText: text().notNull(),
    graph: text({ mode: 'json' }).$type<GraphDefinition>().notNull(),
    status: text().$type<RunStatus>().notNull(),
    /** メインエージェントがこのターンで生成したメッセージ。次ターン以降の履歴になる */
    mainMessages: text({ mode: 'json' }).$type<ModelMessage[]>().notNull(),
    createdAt: integer().notNull(),
  },
  (t) => [index('turns_session_idx').on(t.sessionId)],
);

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
 * セッションを通して継続するサブエージェントの記憶。
 * 書いたターンに紐づけて残し、読むときは祖先ターンのうち最も近いものを使う。
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
