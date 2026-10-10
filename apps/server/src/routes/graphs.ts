import { randomUUID } from 'node:crypto';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { createDefaultGraph, graphDefinitionSchema, type GraphRecord } from 'protocol';
import { db, graphs, sessions, turns } from '../db/index.ts';
import { parseBody } from './parseBody.ts';

const createSchema = z.object({ name: z.string().min(1), definition: graphDefinitionSchema.optional() });
const updateSchema = z.object({ name: z.string().min(1).optional(), definition: graphDefinitionSchema.optional() });

/**
 * グラフの一覧・作成・更新・削除。
 * 削除では、そのグラフを参照しているセッションも会話ごと消す。ただし実行中のターンがあれば削除しない
 */
export const graphRoutes = new Hono()
  .get('/', (c) => c.json<GraphRecord[]>(db.select().from(graphs).orderBy(asc(graphs.name)).all()))
  .post('/', async (c) => {
    const body = await parseBody(c, createSchema);
    const record: GraphRecord = {
      id: randomUUID(),
      name: body.name,
      definition: body.definition ?? createDefaultGraph(),
      updatedAt: Date.now(),
    };
    db.insert(graphs).values(record).run();
    return c.json(record, 201);
  })
  .put('/:id', async (c) => {
    const body = await parseBody(c, updateSchema);
    const record = db
      .update(graphs)
      .set({ ...body, updatedAt: Date.now() })
      .where(eq(graphs.id, c.req.param('id')))
      .returning()
      .get();
    return record ? c.json<GraphRecord>(record) : c.notFound();
  })
  .delete('/:id', (c) => {
    const id = c.req.param('id');
    const sessionIds = db.select({ id: sessions.id }).from(sessions).where(eq(sessions.graphId, id)).all().map((s) => s.id);
    const running = db
      .select({ id: turns.id })
      .from(turns)
      .where(and(inArray(turns.sessionId, sessionIds), eq(turns.status, 'running')))
      .get();
    if (running) return c.json({ error: 'このグラフを参照しているセッションに実行中のターンがあります' }, 409);
    // ターン以下は外部キーの cascade で消える
    db.transaction((tx) => {
      tx.delete(sessions).where(eq(sessions.graphId, id)).run();
      tx.delete(graphs).where(eq(graphs.id, id)).run();
    });
    return c.body(null, 204);
  });
