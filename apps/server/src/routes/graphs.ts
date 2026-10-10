import { randomUUID } from 'node:crypto';
import { asc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { createDefaultGraph, graphDefinitionSchema, type GraphRecord } from 'protocol';
import { db, graphs, sessions } from '../db/index.ts';
import { parseBody } from './parseBody.ts';

const createSchema = z.object({ name: z.string().min(1), definition: graphDefinitionSchema.optional() });
const updateSchema = z.object({ name: z.string().min(1).optional(), definition: graphDefinitionSchema.optional() });

/** グラフの一覧・作成・更新・削除。セッションから参照されているグラフは削除できない */
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
    if (db.select({ id: sessions.id }).from(sessions).where(eq(sessions.graphId, id)).get()) {
      return c.json({ error: 'このグラフを参照しているセッションがあります' }, 409);
    }
    db.delete(graphs).where(eq(graphs.id, id)).run();
    return c.body(null, 204);
  });
