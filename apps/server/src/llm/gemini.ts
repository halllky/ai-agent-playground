import { createGoogleGenerativeAI } from '@ai-sdk/google';
import type { ModelInfo } from 'protocol';
import type { ProviderClient } from './index.ts';

const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
const provider = createGoogleGenerativeAI({ apiKey });

/** Gemini API（Google AI Studio）。料金は API から得られないため、コストは常に不明とする */
export const gemini: ProviderClient = {
  languageModel: (modelId) => provider(modelId),

  async fetchCatalog() {
    if (!apiKey) throw new Error('GOOGLE_GENERATIVE_AI_API_KEY が設定されていません');
    const models: GeminiModel[] = [];
    let pageToken: string | undefined;
    do {
      const url = new URL('https://generativelanguage.googleapis.com/v1beta/models');
      url.searchParams.set('pageSize', '1000');
      if (pageToken) url.searchParams.set('pageToken', pageToken);
      const res = await fetch(url, { headers: { 'x-goog-api-key': apiKey } });
      if (!res.ok) throw new Error(`Gemini model list: ${res.status} ${res.statusText}`);
      const body = (await res.json()) as { models?: GeminiModel[]; nextPageToken?: string };
      models.push(...(body.models ?? []));
      pageToken = body.nextPageToken;
    } while (pageToken);

    return models
      .filter((m) => m.supportedGenerationMethods?.includes('generateContent'))
      .map(
        (m): ModelInfo => ({
          id: m.name.replace(/^models\//, ''),
          name: m.displayName ?? m.name,
          contextLength: m.inputTokenLimit ?? 0,
          // 一覧にはツールコール対応の有無が載らない。generateContent 対応のモデルは概ね対応している
          supportsTools: true,
          pricing: null,
        }),
      );
  },

  reportedCost: () => null,
};

type GeminiModel = {
  /** `models/gemini-2.5-flash` の形 */
  name: string;
  displayName?: string;
  inputTokenLimit?: number;
  supportedGenerationMethods?: string[];
};
