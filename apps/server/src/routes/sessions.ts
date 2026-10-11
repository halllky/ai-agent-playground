import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, getTableColumns } from 'drizzle-orm';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import { createDefaultGraph, graphDefinitionSchema, type SessionDetail, type SessionRecord, type TurnRecord } from 'protocol';
import { db, sessions, turns } from '../db/index.ts';
import { startTurn } from '../run/index.ts';
import { parseBody } from './parseBody.ts';

/** copyFrom を指定すると、そのセッションのグラフを写して始める。無ければ既定のグラフ */
const createSchema = z.object({ copyFrom: z.string().optional() });
const updateSchema = z
  .strictObject({
    graph: graphDefinitionSchema.optional(),
    activeTurnId: z.string().nullable().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, '更新する項目がありません');
const createTurnSchema = z.object({ parentTurnId: z.string().nullable(), userText: z.string().min(1) });

/** セッションの一覧・作成・更新・削除と、ターンの開始 */
export const sessionRoutes = new Hono()
  .get('/', (c) => c.json<SessionRecord[]>(db.select().from(sessions).orderBy(desc(sessions.createdAt)).all()))
  .post('/', async (c) => {
    const body = await parseBody(c, createSchema);
    const record: SessionRecord = {
      id: randomUUID(),
      title: new Date().toLocaleString('ja-JP'),
      graph: body.copyFrom ? findSession(body.copyFrom).graph : createDefaultGraph(),
      activeTurnId: null,
      createdAt: Date.now(),
    };
    db.insert(sessions).values(record).run();
    return c.json(record, 201);
  })
  .get('/:id', (c) => {
    const session = findSession(c.req.param('id'));
    const { state: _, ...columns } = getTableColumns(turns);
    const turnRecords: TurnRecord[] = db.select(columns).from(turns).where(eq(turns.sessionId, session.id)).orderBy(asc(turns.createdAt)).all();
    return c.json<SessionDetail>({ ...session, turns: turnRecords });
  })
  .put('/:id', async (c) => {
    const body = await parseBody(c, updateSchema);
    const record = db.update(sessions).set(body).where(eq(sessions.id, c.req.param('id'))).returning().get();
    return record ? c.json<SessionRecord>(record) : c.notFound();
  })
  /** セッションを会話ごと消す。実行中のターンがあれば、実行を残したまま消さないよう断る */
  .delete('/:id', (c) => {
    const id = c.req.param('id');
    if (db.select({ id: turns.id }).from(turns).where(and(eq(turns.sessionId, id), eq(turns.status, 'running'))).get()) {
      return c.json({ error: 'このセッションには実行中のターンがあります' }, 409);
    }
    // ターン以下は外部キーの cascade で消える
    db.delete(sessions).where(eq(sessions.id, id)).run();
    return c.body(null, 204);
  })
  /** セッションの現在のグラフで新しいターンを実行し、表示中の分岐をそのターンに切り替える */
  .post('/:id/turns', async (c) => {
    const session = findSession(c.req.param('id'));
    const { parentTurnId, userText } = await parseBody(c, createTurnSchema);
    if (parentTurnId && !db.select({ id: turns.id }).from(turns).where(and(eq(turns.id, parentTurnId), eq(turns.sessionId, session.id))).get()) {
      throw new HTTPException(400, { message: '親ターンがこのセッションにありません' });
    }
    const turn = startTurn(session.id, session.graph, parentTurnId, userText);
    db.update(sessions).set({ activeTurnId: turn.id }).where(eq(sessions.id, session.id)).run();
    return c.json(turn, 201);
  });

function findSession(id: string): SessionRecord {
  const session = db.select().from(sessions).where(eq(sessions.id, id)).get();
  if (!session) throw new HTTPException(404, { message: 'セッションがありません' });
  return session;
}
