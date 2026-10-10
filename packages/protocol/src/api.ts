import type { GraphDefinition } from './graph.ts';
import type { RunStatus } from './runEvent.ts';

/** 名前を付けて保存されたグラフ。セッションから参照され、編集すると以降のターンに反映される */
export type GraphRecord = {
  id: string;
  name: string;
  definition: GraphDefinition;
  updatedAt: number;
};

/** 1つの会話。ターンの分岐をすべて含む */
export type SessionRecord = {
  id: string;
  title: string;
  /** 次に実行するターンで使うグラフ */
  graphId: string;
  /** 表示中の分岐の末端ターン */
  activeTurnId: string | null;
  createdAt: number;
};

/** ユーザーの発言1回と、それに対する実行1回。ターンはツリー構造を持ち、parentTurnId が null のものが会話の先頭 */
export type TurnRecord = {
  id: string;
  sessionId: string;
  parentTurnId: string | null;
  userText: string;
  /** 実行時に使ったグラフ。後でグラフを編集しても変わらない */
  graph: GraphDefinition;
  status: RunStatus;
  createdAt: number;
};

/** セッションと、その全分岐のターン */
export type SessionDetail = SessionRecord & { turns: TurnRecord[] };

/** あるターン時点で存在するファイル1つ。中身は別に取得する */
export type FileEntry = {
  volume: string;
  path: string;
  /** 最後に書き込んだターン */
  turnId: string;
  at: number;
};
