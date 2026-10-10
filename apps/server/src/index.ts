import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { logger } from 'hono/logger';
import { fileRoutes } from './routes/files.ts';
import { graphRoutes } from './routes/graphs.ts';
import { sessionRoutes } from './routes/sessions.ts';
import { turnRoutes } from './routes/turns.ts';
import { modelCatalog } from './openrouter/index.ts';
import { closeInterruptedTurns } from './run/index.ts';

closeInterruptedTurns();

const app = new Hono()
  .basePath('/api')
  .use(logger())
  .route('/graphs', graphRoutes)
  .route('/sessions', sessionRoutes)
  .route('/turns', turnRoutes)
  .route('/turns', fileRoutes)
  .get('/models', async (c) => c.json(await modelCatalog()));

const port = Number(process.env.PORT ?? 8787);

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`Server listening on http://localhost:${info.port}`);
});
