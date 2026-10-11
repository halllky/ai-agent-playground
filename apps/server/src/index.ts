import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { logger } from 'hono/logger';
import { modelRoutes } from './routes/models.ts';
import { sessionRoutes } from './routes/sessions.ts';
import { turnRoutes } from './routes/turns.ts';
import { closeInterruptedTurns } from './run/index.ts';

closeInterruptedTurns();

const app = new Hono()
  .basePath('/api')
  .use(logger())
  .route('/sessions', sessionRoutes)
  .route('/turns', turnRoutes)
  .route('/models', modelRoutes);

const port = Number(process.env.PORT ?? 8787);

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`Server listening on http://localhost:${info.port}`);
});
