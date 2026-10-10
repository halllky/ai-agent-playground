import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import type { FileEntry } from 'protocol';
import { db, turns } from '../db/index.ts';
import { fileContentAt, filesAt } from '../volume/index.ts';

/** ターン時点のファイルの閲覧。書き込みはエージェントのツールからだけ行う */
export const fileRoutes = new Hono()
  .get('/:id/files', (c) => {
    const id = c.req.param('id');
    if (!turnExists(id)) return c.notFound();
    return c.json<FileEntry[]>(filesAt(id));
  })
  .get('/:id/files/content', (c) => {
    const { volume, path } = c.req.query();
    if (!volume || !path) return c.json({ error: 'volume と path を指定してください' }, 400);
    const content = fileContentAt(c.req.param('id'), volume, path);
    return content === undefined ? c.notFound() : c.json({ content });
  });

function turnExists(id: string): boolean {
  return db.select({ id: turns.id }).from(turns).where(eq(turns.id, id)).get() !== undefined;
}
