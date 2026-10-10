/** 選べるプロバイダの一覧 */
export const modelProviders = ['openrouter', 'gemini'] as const;
/** エージェントの LLM を呼び出す先。モデル ID の体系はプロバイダごとに別物 */
export type ModelProvider = (typeof modelProviders)[number];

/** プロバイダの表示名 */
export const modelProviderLabels: Record<ModelProvider, string> = { openrouter: 'OpenRouter', gemini: 'Gemini' };

/** 新しいノードやプロバイダを切り替えたノードに入れるモデル */
export const defaultModelOf: Record<ModelProvider, string> = {
  openrouter: 'google/gemma-4-31b-it:free',
  gemini: 'gemini-2.5-flash',
};

/** プロバイダで選べるモデル1つ分 */
export type ModelInfo = {
  id: string;
  name: string;
  contextLength: number;
  supportsTools: boolean;
  /** 1トークンあたりの USD。プロバイダが公開していなければ null */
  pricing: { prompt: number; completion: number } | null;
};
