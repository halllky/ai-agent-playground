import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import type { ModelMessage } from 'ai';
import type { GraphDefinition, RunEvent, RunStatus, WorkfolderFiles } from 'protocol';

/** エージェントの構成。編集すると、属する会話の次のターンから効く */
export const graphs = sqliteTable('graphs', {
  id: text().primaryKey(),
  name: text().notNull(),
  definition: text({ mode: 'json' }).$type<GraphDefinition>().notNull(),
  createdAt: integer().notNull(),
});

/** グラフに属する会話。表示中の分岐の末端ターンを持つ */
export const sessions = sqliteTable(
  'sessions',
  {
    id: text().primaryKey(),
    graphId: text()
      .notNull()
      .references(() => graphs.id, { onDelete: 'cascade' }),
    title: text().notNull(),
    activeTurnId: text(),
    createdAt: integer().notNull(),
  },
  (t) => [index('sessions_graph_idx').on(t.graphId)],
);

/**
 * ターンが終わった時点で会話に残っている状態の写し。次のターンは親ターンの写しから始める。
 * files はワークフォルダの中身、memories はセッションで継続する記憶を持つエージェントノードの id ごとの会話
 */
export type TurnState = { files: WorkfolderFiles; memories: Record<string, ModelMessage[]> };

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
    /** 実行時点のグラフの写し。閲覧専用のログで、グラフを後で編集しても変わらない */
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
