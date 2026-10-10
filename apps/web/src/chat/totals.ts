import type { StepRecord } from 'protocol';

/** ステップの集計値。cost はコストが判明したステップだけの合計で、1つも判明しなければ null */
export type Totals = { steps: number; inputTokens: number; outputTokens: number; cost: number | null; durationMs: number };

/** ステップの並びを集計する */
export function totalsOf(steps: StepRecord[]): Totals {
  return steps.reduce<Totals>(
    (acc, step) => ({
      steps: acc.steps + 1,
      inputTokens: acc.inputTokens + step.usage.inputTokens,
      outputTokens: acc.outputTokens + step.usage.outputTokens,
      cost: acc.cost === null && step.cost === null ? null : (acc.cost ?? 0) + (step.cost ?? 0),
      durationMs: acc.durationMs + step.durationMs,
    }),
    { steps: 0, inputTokens: 0, outputTokens: 0, cost: null, durationMs: 0 },
  );
}

/** 集計値を1行の表示用の文字列にする */
export function formatTotals(totals: Totals): string {
  return `${totals.steps}ステップ・${formatTokens(totals.inputTokens, totals.outputTokens)}・${formatCost(totals.cost)}・${formatDuration(totals.durationMs)}`;
}

/** 入力・出力トークン数の表示 */
export function formatTokens(inputTokens: number, outputTokens: number): string {
  return `入力 ${inputTokens.toLocaleString()} / 出力 ${outputTokens.toLocaleString()} トークン`;
}

/** USD のコストの表示。不明なら「$?」 */
export function formatCost(cost: number | null): string {
  return cost === null ? '$?' : `$${cost.toFixed(6)}`;
}

/** ミリ秒の所要時間を秒で表示する */
export function formatDuration(ms: number): string {
  return `${(ms / 1000).toFixed(1)}秒`;
}
