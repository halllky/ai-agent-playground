import type { LanguageModel, StepResult, ToolSet } from 'ai';
import type { ModelInfo, ModelProvider } from 'protocol';
import { gemini } from './gemini.ts';
import { openrouter } from './openrouter.ts';

/** プロバイダ1つ分の実装。llm/ の中だけで使う */
export type ProviderClient = {
  languageModel(modelId: string): LanguageModel;
  /** 取得に失敗したら例外を投げる */
  fetchCatalog(): Promise<ModelInfo[]>;
  /** レスポンスに含まれていた利用料金。含まれていなければ null */
  reportedCost(step: StepResult<ToolSet>): number | null;
};

const clients: Record<ModelProvider, ProviderClient> = { openrouter, gemini };

/** provider のモデルを AI SDK から呼び出せる形にする。API キーやモデル ID の誤りは呼び出すまで分からない */
export function languageModel(provider: ModelProvider, modelId: string): LanguageModel {
  return clients[provider].languageModel(modelId);
}

const catalogTtlMs = 60 * 60 * 1000;
const catalogs = new Map<ModelProvider, { models: ModelInfo[]; fetchedAt: number }>();

/** プロバイダのモデル一覧。一定時間キャッシュする。取得に失敗したら例外を投げ、失敗はキャッシュしない */
export async function modelCatalog(provider: ModelProvider): Promise<ModelInfo[]> {
  const cached = catalogs.get(provider);
  if (cached && Date.now() - cached.fetchedAt < catalogTtlMs) return cached.models;
  const models = (await clients[provider].fetchCatalog()).sort((a, b) => a.id.localeCompare(b.id));
  catalogs.set(provider, { models, fetchedAt: Date.now() });
  return models;
}

/** ステップの利用料金（USD）。レスポンスに無ければモデル一覧の単価から見積もり、それも無ければ null */
export async function stepCost(provider: ModelProvider, step: StepResult<ToolSet>): Promise<number | null> {
  const reported = clients[provider].reportedCost(step);
  if (reported !== null) return reported;
  const model = await modelCatalog(provider).then(
    (models) => models.find((m) => m.id === step.model.modelId),
    () => undefined,
  );
  if (!model?.pricing) return null;
  return (step.usage.inputTokens ?? 0) * model.pricing.prompt + (step.usage.outputTokens ?? 0) * model.pricing.completion;
}
