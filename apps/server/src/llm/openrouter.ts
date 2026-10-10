import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import type { ModelInfo } from 'protocol';
import type { ProviderClient } from './index.ts';

const provider = createOpenRouter({ apiKey: process.env.OPENROUTER_API_KEY, baseURL: process.env.OPENROUTER_BASE_URL || undefined });

/** OpenRouter。利用料金をレスポンスに含めるよう要求する */
export const openrouter: ProviderClient = {
  languageModel: (modelId) => provider.chat(modelId, { usage: { include: true } }),

  async fetchCatalog() {
    const res = await fetch('https://openrouter.ai/api/v1/models');
    if (!res.ok) throw new Error(`OpenRouter model list: ${res.status} ${res.statusText}`);
    const body = (await res.json()) as { data: OpenRouterModel[] };
    return body.data.map(
      (m): ModelInfo => ({
        id: m.id,
        name: m.name,
        contextLength: m.context_length,
        supportsTools: m.supported_parameters?.includes('tools') ?? false,
        pricing: { prompt: Number(m.pricing.prompt), completion: Number(m.pricing.completion) },
      }),
    );
  },

  reportedCost(step) {
    const usage = step.providerMetadata?.openrouter?.usage as { cost?: number } | undefined;
    return typeof usage?.cost === 'number' ? usage.cost : null;
  },
};

type OpenRouterModel = {
  id: string;
  name: string;
  context_length: number;
  supported_parameters?: string[];
  pricing: { prompt: string; completion: string };
};
