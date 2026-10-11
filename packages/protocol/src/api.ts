import type { GraphDefinition } from './graph/schema.ts';
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

/** ワークフォルダの中身。パスからファイルの中身へ */
export type WorkfolderFiles = Record<string, string>;

/** あるターンが終わった時点（実行中なら今）のワークフォルダ */
export type TurnFiles = {
  files: WorkfolderFiles;
  /** 親ターンの時点から追加・変更・削除されたパス */
  changed: string[];
};
