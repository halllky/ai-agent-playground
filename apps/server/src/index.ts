import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { logger } from 'hono/logger';
import { anthropic } from '@ai-sdk/anthropic';
import { convertToModelMessages, stepCountIs, streamText, tool, type UIMessage } from 'ai';
import { z } from 'zod';

const app = new Hono().basePath('/api');

app.use(logger());

app.get('/health', (c) => c.json({ ok: true }));

app.post('/chat', async (c) => {
  const { messages } = await c.req.json<{ messages: UIMessage[] }>();

  const result = streamText({
    model: anthropic('claude-sonnet-5-5'),
    system: 'You are a helpful assistant running inside an AI agent playground.',
    messages: await convertToModelMessages(messages),
    tools: {
      getCurrentTime: tool({
        description: 'Get the current date and time on the server',
        inputSchema: z.object({}),
        execute: async () => ({ now: new Date().toISOString() }),
      }),
    },
    stopWhen: stepCountIs(5),
  });

  return result.toUIMessageStreamResponse();
});

const port = Number(process.env.PORT ?? 8787);

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`Server listening on http://localhost:${info.port}`);
});
