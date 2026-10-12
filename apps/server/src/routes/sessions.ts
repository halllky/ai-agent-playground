import { and, asc, eq, getTableColumns } from 'drizzle-orm';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import type { SessionDetail, SessionRecord, TurnRecord } from 'protocol';
import { db, graphs, sessions, turns } from '../db/index.ts';
import { startTurn } from '../run/index.ts';
import { parseBody } from './parseBody.ts';

const updateSchema = z.strictObject({ activeTurnId: z.string().nullable() });
const createTurnSchema = z.object({ parentTurnId: z.string().nullable(), userText: z.string().min(1) });

/** 会話の閲覧・表示中の分岐の切り替え・削除と、ターンの開始。会話の一覧・作成はグラフ側で扱う */
export const sessionRoutes = new Hono()
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
  /** 会話を消す。実行中のターンがあれば、実行を残したまま消さないよう断る */
  .delete('/:id', (c) => {
    const id = c.req.param('id');
    if (db.select({ id: turns.id }).from(turns).where(and(eq(turns.sessionId, id), eq(turns.status, 'running'))).get()) {
      return c.json({ error: 'このセッションには実行中のターンがあります' }, 409);
    }
    // ターン以下は外部キーの cascade で消える
    db.delete(sessions).where(eq(sessions.id, id)).run();
    return c.body(null, 204);
  })
  /** 会話が属するグラフの今の構成で新しいターンを実行し、表示中の分岐をそのターンに切り替える */
  .post('/:id/turns', async (c) => {
    const session = findSession(c.req.param('id'));
    const { parentTurnId, userText } = await parseBody(c, createTurnSchema);
    if (parentTurnId && !db.select({ id: turns.id }).from(turns).where(and(eq(turns.id, parentTurnId), eq(turns.sessionId, session.id))).get()) {
      throw new HTTPException(400, { message: '親ターンがこのセッションにありません' });
    }
    const graph = db.select({ definition: graphs.definition }).from(graphs).where(eq(graphs.id, session.graphId)).get()!;
    const turn = startTurn(session.id, graph.definition, parentTurnId, userText);
    db.update(sessions).set({ activeTurnId: turn.id }).where(eq(sessions.id, session.id)).run();
    return c.json(turn, 201);
  });

function findSession(id: string): SessionRecord {
  const session = db.select().from(sessions).where(eq(sessions.id, id)).get();
  if (!session) throw new HTTPException(404, { message: 'セッションがありません' });
  return session;
}
