import type { GraphDefinition } from './graph.ts';
import type { RunStatus } from './runEvent.ts';

/** 1つの会話。ターンの分岐をすべて含み、次に実行するターンで使うグラフを持つ */
export type SessionRecord = {
  id: string;
  title: string;
  graph: GraphDefinition;
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
  /** 実行時に使ったグラフ。後でセッションのグラフを編集しても変わらない */
  graph: GraphDefinition;
  status: RunStatus;
  /** ユーザーノードへ流れ込んだ返答。実行中は空 */
  reply: string;
  createdAt: number;
};

/** セッションと、その全分岐のターン */
export type SessionDetail = SessionRecord & { turns: TurnRecord[] };

/** あるターンが終わった時点の、files ノードの id ごとの、パスからファイルの中身へ */
export type TurnFiles = Record<string, Record<string, string>>;
