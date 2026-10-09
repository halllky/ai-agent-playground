/** OpenRouter で選べるモデル1つ分 */
export type ModelInfo = {
  id: string;
  name: string;
  contextLength: number;
  supportsTools: boolean;
  /** 1トークンあたりの USD */
  pricing: { prompt: number; completion: number };
};
