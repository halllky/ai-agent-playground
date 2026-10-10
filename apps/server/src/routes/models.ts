import { Hono } from 'hono';
import { modelProviders, type ModelInfo, type ModelProvider } from 'protocol';
import { modelCatalog } from '../llm/index.ts';

/** プロバイダごとのモデル一覧。プロバイダからの取得に失敗したら 502 で理由を返す */
export const modelRoutes = new Hono().get('/:provider', async (c) => {
  const provider = c.req.param('provider');
  if (!isModelProvider(provider)) return c.notFound();
  try {
    return c.json<ModelInfo[]>(await modelCatalog(provider));
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 502);
  }
});

function isModelProvider(value: string): value is ModelProvider {
  return (modelProviders as readonly string[]).includes(value);
}
