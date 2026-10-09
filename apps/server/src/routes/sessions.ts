import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import type { SessionDetail, SessionRecord, TurnRecord } from 'protocol';
import { db, graphs, sessions, turns } from '../db/index.ts';
import { startTurn } from '../run/index.ts';
import { parseBody } from './parseBody.ts';

const createSchema = z.object({ graphId: z.string(), title: z.string().optional() });
const updateSchema = z.object({
  title: z.string().min(1).optional(),
  graphId: z.string().optional(),
  activeTurnId: z.string().nullable().optional(),
});
const createTurnSchema = z.object({ parentTurnId: z.string().nullable(), userText: z.string().min(1) });

export const sessionRoutes = new Hono()
  .get('/', (c) => c.json<SessionRecord[]>(db.select().from(sessions).orderBy(desc(sessions.createdAt)).all()))
  .post('/', async (c) => {
    const body = await parseBody(c, createSchema);
    assertGraphExists(body.graphId);
    const record: SessionRecord = {
      id: randomUUID(),
      title: body.title ?? new Date().toLocaleString('ja-JP'),
      graphId: body.graphId,
      activeTurnId: null,
      createdAt: Date.now(),
    };
    db.insert(sessions).values(record).run();
    return c.json(record, 201);
  })
  .get('/:id', (c) => {
    const session = findSession(c.req.param('id'));
    const turnRows = db.select().from(turns).where(eq(turns.sessionId, session.id)).orderBy(asc(turns.createdAt)).all();
    return c.json<SessionDetail>({ ...session, turns: turnRows.map(turnRecordOf) });
  })
  .put('/:id', async (c) => {
    const body = await parseBody(c, updateSchema);
    if (body.graphId) assertGraphExists(body.graphId);
    const record = db.update(sessions).set(body).where(eq(sessions.id, c.req.param('id'))).returning().get();
    return record ? c.json<SessionRecord>(record) : c.notFound();
  })
  .delete('/:id', (c) => {
    db.delete(sessions).where(eq(sessions.id, c.req.param('id'))).run();
    return c.body(null, 204);
  })
  .post('/:id/turns', async (c) => {
    const session = findSession(c.req.param('id'));
    const body = await parseBody(c, createTurnSchema);
    const turn = createTurn(session, body.parentTurnId, body.userText);
    startTurn(turn);
    return c.json(turnRecordOf(turn), 201);
  });

function findSession(id: string): SessionRecord {
  const session = db.select().from(sessions).where(eq(sessions.id, id)).get();
  if (!session) throw new HTTPException(404, { message: 'セッションがありません' });
  return session;
}

function assertGraphExists(graphId: string): void {
  if (!db.select({ id: graphs.id }).from(graphs).where(eq(graphs.id, graphId)).get()) {
    throw new HTTPException(400, { message: 'グラフがありません' });
  }
}

/**
 * 新しいターンを保存し、表示中の分岐をそのターンに切り替える。
 * 過去ターンからのやり直しでも、記録するグラフは常にその時点の現在のグラフ。
 */
function createTurn(session: SessionRecord, parentTurnId: string | null, userText: string) {
  if (parentTurnId) {
    const parent = db
      .select({ id: turns.id })
      .from(turns)
      .where(and(eq(turns.id, parentTurnId), eq(turns.sessionId, session.id)))
      .get();
    if (!parent) throw new HTTPException(400, { message: '親ターンがこのセッションにありません' });
  }
  const graph = db.select().from(graphs).where(eq(graphs.id, session.graphId)).get();
  if (!graph) throw new HTTPException(400, { message: 'セッションのグラフがありません' });

  const turn = {
    id: randomUUID(),
    sessionId: session.id,
    parentTurnId,
    userText,
    graph: graph.definition,
    status: 'running' as const,
    mainMessages: [],
    createdAt: Date.now(),
  };
  db.transaction((tx) => {
    tx.insert(turns).values(turn).run();
    tx.update(sessions).set({ activeTurnId: turn.id }).where(eq(sessions.id, session.id)).run();
  });
  return turn;
}

function turnRecordOf(row: typeof turns.$inferSelect): TurnRecord {
  const { mainMessages: _, ...record } = row;
  return record;
}
