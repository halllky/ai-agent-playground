import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { RunEvent } from 'protocol';
import { db, turns } from '../db/index.ts';
import { abortTurn, followTurn } from '../run/index.ts';

export const turnRoutes = new Hono()
  .get('/:id/events', (c) => {
    const id = c.req.param('id');
    if (!db.select({ id: turns.id }).from(turns).where(eq(turns.id, id)).get()) return c.notFound();

    return streamSSE(c, async (stream) => {
      const pending: RunEvent[] = [];
      let finished = false;
      let wake = () => {};
      const following = followTurn(id, (event) => {
        pending.push(event);
        if (event.type === 'turn.finish') finished = true;
        wake();
      });
      if (!following.live) finished = true;
      stream.onAbort(() => {
        finished = true;
        wake();
      });

      try {
        while (true) {
          while (pending.length > 0) await stream.writeSSE({ data: JSON.stringify(pending.shift()) });
          if (finished || stream.aborted) break;
          await new Promise<void>((resolve) => (wake = resolve));
        }
      } finally {
        following.stop();
      }
    });
  })
  .post('/:id/abort', (c) => (abortTurn(c.req.param('id')) ? c.body(null, 204) : c.json({ error: '実行中ではありません' }, 409)));
