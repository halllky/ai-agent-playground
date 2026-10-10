import type { CallSettings } from './graph.ts';

/**
 * ターン実行中にサーバーから SSE で配信されるイベント。
 *
 * エージェント呼び出し1回を call と呼び、callId / parentCallId で呼び出しの親子関係を表す。
 * `text.delta` 以外は永続化され、過去ターンの表示やログはこれを再生して組み立てる。
 */
export type RunEvent = RunEventHeader & RunEventBody;

/**
 * 全イベント共通の項目。
 * どの呼び出しにも属さない `turn.finish` では、callId は turnId と同じ値、nodeId は空文字になる。
 */
export type RunEventHeader = {
  turnId: string;
  /** ターン内で単調増加。永続化されない `text.delta` には付かない */
  seq: number | null;
  at: number;
  callId: string;
  parentCallId: string | null;
  nodeId: string;
};

/** イベント種別ごとの項目 */
export type RunEventBody =
  | {
      type: 'call.start';
      depth: number;
      /** 呼び出し元のツールコール。メインエージェントでは null */
      toolCallId: string | null;
      /** サブエージェント呼び出しの設定。メインエージェントでは null */
      settings: CallSettings | null;
      task: string;
    }
  | { type: 'text.delta'; text: string }
  | { type: 'step.finish'; step: StepRecord }
  | { type: 'tool.call'; toolCallId: string; toolName: string; input: unknown }
  | { type: 'tool.result'; toolCallId: string; toolName: string; output: unknown; isError: boolean }
  | { type: 'log'; level: 'info' | 'warn' | 'error'; message: string }
  | { type: 'call.finish'; status: RunStatus; output: string; error: string | null }
  | { type: 'turn.finish'; status: RunStatus; error: string | null };

export type RunEventType = RunEventBody['type'];
/** 種別 T のイベント */
export type RunEventOf<T extends RunEventType> = RunEventHeader & Extract<RunEventBody, { type: T }>;

/** ターンやエージェント呼び出しの実行状態 */
export type RunStatus = 'running' | 'done' | 'aborted' | 'error';

/** LLM への1リクエスト分 */
export type StepRecord = {
  index: number;
  model: string;
  text: string;
  reasoning: string | null;
  finishReason: string;
  usage: { inputTokens: number; outputTokens: number };
  /** USD。プロバイダから得られず料金表にもないときは null */
  cost: number | null;
  durationMs: number;
  /** プロバイダへ送ったリクエスト本文（システムプロンプト・履歴・ツール定義を含む） */
  request: unknown;
  /** 生成結果（テキスト・ツールコール・メタデータ） */
  response: unknown;
  /** Abort により途中で打ち切られたステップ */
  aborted: boolean;
};
