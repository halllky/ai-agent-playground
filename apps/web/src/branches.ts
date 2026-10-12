import type { TurnRecord } from 'protocol';

/** 会話の先頭から activeTurnId までのターン */
export function turnPath(turns: TurnRecord[], activeTurnId: string | null): TurnRecord[] {
  const byId = new Map(turns.map((t) => [t.id, t]));
  const path: TurnRecord[] = [];
  for (let turn = activeTurnId ? byId.get(activeTurnId) : undefined; turn; turn = turn.parentTurnId ? byId.get(turn.parentTurnId) : undefined) {
    path.unshift(turn);
  }
  return path;
}

/** turn と同じ親を持つターン（turn 自身を含む）を作成順に */
export function siblingsOf(turns: TurnRecord[], turn: TurnRecord): TurnRecord[] {
  return turns.filter((t) => t.parentTurnId === turn.parentTurnId).sort((a, b) => a.createdAt - b.createdAt);
}

/** turnId から、それぞれ最も新しい子をたどった末端のターンの id */
export function latestLeafOf(turns: TurnRecord[], turnId: string): string {
  let leaf = turnId;
  for (;;) {
    const children = turns.filter((t) => t.parentTurnId === leaf);
    if (children.length === 0) return leaf;
    leaf = children.reduce((a, b) => (b.createdAt > a.createdAt ? b : a)).id;
  }
}
