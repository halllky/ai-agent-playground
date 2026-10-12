/**
 * ターン実行中にサーバーから SSE で配信されるイベント。
 *
 * ノード（エージェント・判定・Web検索）の呼び出し1回を call と呼び、callId / parentCallId で呼び出しの親子関係を表す。
 * フローから呼ばれた call は parentCallId が null、ツールとして呼ばれた call は呼び出し元の callId と toolCallId を持つ。
 * `text.delta` 以外は永続化され、過去ターンの表示はこれを再生して組み立てる。
 */
export type RunEvent = RunEventHeader & RunEventBody;

/** 全イベント共通の項目。どの呼び出しにも属さないターン全体のイベントでは、callId と nodeId が null */
export type RunEventHeader = {
  turnId: string;
  /** ターン内で単調増加。永続化されない `text.delta` には付かない */
  seq: number | null;
  at: number;
  callId: string | null;
  parentCallId: string | null;
  nodeId: string | null;
};

/** イベント種別ごとの項目 */
export type RunEventBody =
  | {
      type: 'call.start';
      /** 呼び出し元のツールコール。フローから呼ばれたら null */
      toolCallId: string | null;
      /** 呼び出し元から渡された入力。会話だけを渡すエージェントでは空 */
      input: string;
    }
  /** LLM への1リクエストの開始。そのステップのテキスト・ツールコールはこの後、step.finish までに届く */
  | { type: 'step.start'; index: number }
  | { type: 'text.delta'; text: string }
  /** ステップの終了。ツールの実行も終わった後に届く */
  | { type: 'step.finish'; step: StepRecord }
  | { type: 'tool.call'; toolCallId: string; toolName: string; input: unknown }
  | { type: 'tool.result'; toolCallId: string; toolName: string; output: unknown; isError: boolean }
  /** ターン全体についての記録（フローで飛ばしたノードなど）。どの呼び出しにも属さない */
  | { type: 'log'; level: 'info' | 'warn' | 'error'; message: string }
  /** output は呼び出し元へ返す、またはフローで後段へ流すテキスト */
  | { type: 'call.finish'; status: RunStatus; output: string; error: string | null }
  /** reply はユーザー出力ノードへ流れ込んだ返答 */
  | { type: 'turn.finish'; status: RunStatus; reply: string; error: string | null };

export type RunEventType = RunEventBody['type'];
/** 種別 T のイベント */
export type RunEventOf<T extends RunEventType> = RunEventHeader & Extract<RunEventBody, { type: T }>;

/** ターンやノード呼び出しの実行状態 */
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
  /** LLM に要求してから応答を受け取り終えるまで。ツールの実行時間は含まない */
  durationMs: number;
  /** プロバイダへ送ったリクエスト本文（システムプロンプト・履歴・ツール定義を含む） */
  request: unknown;
  /** 生成結果（テキスト・ツールコール・メタデータ） */
  response: unknown;
  /** Abort により途中で打ち切られたステップ */
  aborted: boolean;
};
