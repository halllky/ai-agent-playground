import type { GraphDefinition } from './graph.ts';
import type { RunStatus } from './runEvent.ts';

export type GraphRecord = {
  id: string;
  name: string;
  definition: GraphDefinition;
  updatedAt: number;
};

export type SessionRecord = {
  id: string;
  title: string;
  graphId: string;
  /** 表示中の分岐の末端ターン */
  activeTurnId: string | null;
  createdAt: number;
};

/** ターンはツリー構造を持ち、parentTurnId が null のものが会話の先頭 */
export type TurnRecord = {
  id: string;
  sessionId: string;
  parentTurnId: string | null;
  userText: string;
  /** 実行時に使ったグラフ */
  graph: GraphDefinition;
  status: RunStatus;
  createdAt: number;
};

export type SessionDetail = SessionRecord & { turns: TurnRecord[] };
