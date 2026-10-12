import { randomUUID } from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import { createDefaultGraph, graphDefinitionSchema, type GraphRecord, type SessionRecord } from 'protocol';
import { db, graphs, sessions, turns } from '../db/index.ts';
import { parseBody } from './parseBody.ts';

/** copyFrom を指定すると、そのグラフを複製する。無ければ既定の構成 */
const createSchema = z.object({ copyFrom: z.string().optional() });
const updateSchema = z
  .strictObject({
    name: z.string().min(1).optional(),
    definition: graphDefinitionSchema.optional(),
  })
  .refine((body) => Object.keys(body).length > 0, '更新する項目がありません');

/** グラフの一覧・作成・更新・削除と、グラフに属する会話の一覧・作成 */
export const graphRoutes = new Hono()
  .get('/', (c) => c.json<GraphRecord[]>(db.select().from(graphs).orderBy(desc(graphs.createdAt)).all()))
  .post('/', async (c) => {
    const body = await parseBody(c, createSchema);
    const source = body.copyFrom ? findGraph(body.copyFrom) : undefined;
    const record: GraphRecord = {
      id: randomUUID(),
      name: source ? `${source.name} のコピー` : new Date().toLocaleString('ja-JP'),
      definition: source?.definition ?? createDefaultGraph(),
      createdAt: Date.now(),
    };
    db.insert(graphs).values(record).run();
    return c.json(record, 201);
  })
  .put('/:id', async (c) => {
    const body = await parseBody(c, updateSchema);
    const record = db.update(graphs).set(body).where(eq(graphs.id, c.req.param('id'))).returning().get();
    return record ? c.json<GraphRecord>(record) : c.notFound();
  })
  /** グラフを会話ごと消す。実行中のターンがあれば、実行を残したまま消さないよう断る */
  .delete('/:id', (c) => {
    const id = c.req.param('id');
    const running = db
      .select({ id: turns.id })
      .from(turns)
      .innerJoin(sessions, eq(turns.sessionId, sessions.id))
      .where(and(eq(sessions.graphId, id), eq(turns.status, 'running')))
      .get();
    if (running) return c.json({ error: 'このグラフの会話に実行中のターンがあります' }, 409);
    // 会話以下は外部キーの cascade で消える
    db.delete(graphs).where(eq(graphs.id, id)).run();
    return c.body(null, 204);
  })
  .get('/:id/sessions', (c) => {
    const graph = findGraph(c.req.param('id'));
    return c.json<SessionRecord[]>(db.select().from(sessions).where(eq(sessions.graphId, graph.id)).orderBy(desc(sessions.createdAt)).all());
  })
  /** グラフに属する空の会話を作る */
  .post('/:id/sessions', (c) => {
    const graph = findGraph(c.req.param('id'));
    const record: SessionRecord = {
      id: randomUUID(),
      graphId: graph.id,
      title: new Date().toLocaleString('ja-JP'),
      activeTurnId: null,
      createdAt: Date.now(),
    };
    db.insert(sessions).values(record).run();
    return c.json(record, 201);
  });

function findGraph(id: string): GraphRecord {
  const graph = db.select().from(graphs).where(eq(graphs.id, id)).get();
  if (!graph) throw new HTTPException(404, { message: 'グラフがありません' });
  return graph;
}
