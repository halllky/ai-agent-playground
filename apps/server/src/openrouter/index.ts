import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import type { LanguageModel } from 'ai';
import type { ModelInfo } from 'protocol';

const provider = createOpenRouter({ apiKey: process.env.OPENROUTER_API_KEY, baseURL: process.env.OPENROUTER_BASE_URL || undefined });

/** 利用料金をレスポンスに含めるよう要求したモデル */
export function languageModel(modelId: string): LanguageModel {
  return provider.chat(modelId, { usage: { include: true } });
}

const catalogTtlMs = 60 * 60 * 1000;
let catalog: { models: ModelInfo[]; fetchedAt: number } | undefined;

/** OpenRouter のモデル一覧。一定時間キャッシュする */
export async function modelCatalog(): Promise<ModelInfo[]> {
  if (catalog && Date.now() - catalog.fetchedAt < catalogTtlMs) return catalog.models;
  const res = await fetch('https://openrouter.ai/api/v1/models');
  if (!res.ok) throw new Error(`OpenRouter model list: ${res.status} ${res.statusText}`);
  const body = (await res.json()) as { data: OpenRouterModel[] };
  const models = body.data
    .map(
      (m): ModelInfo => ({
        id: m.id,
        name: m.name,
        contextLength: m.context_length,
        supportsTools: m.supported_parameters?.includes('tools') ?? false,
        pricing: { prompt: Number(m.pricing.prompt), completion: Number(m.pricing.completion) },
      }),
    )
    .sort((a, b) => a.id.localeCompare(b.id));
  catalog = { models, fetchedAt: Date.now() };
  return models;
}

type OpenRouterModel = {
  id: string;
  name: string;
  context_length: number;
  supported_parameters?: string[];
  pricing: { prompt: string; completion: string };
};
