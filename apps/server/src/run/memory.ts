import type { ModelMessage } from 'ai';
import { and, eq, inArray } from 'drizzle-orm';
import type { CallSettings } from 'protocol';
import { agentMemories, db, lineageOf } from '../db/index.ts';

/** ターン内でだけ持ち越す記憶。ターンの実行が終われば捨てる */
export type TurnMemory = Map<string, ModelMessage[]>;

type MemoryScope = { turnId: string; turnMemory: TurnMemory };

/**
 * memoryKey で識別されるサブエージェントの過去の会話。
 * セッション継続の記憶は、実行中ターンから会話の先頭に向かって最も近いターンで書かれたものを使うので、
 * 過去ターンからやり直した分岐では、分岐元の時点の記憶に戻る。
 */
export function recallMemory(scope: MemoryScope, memoryKey: string, mode: CallSettings['memory']): ModelMessage[] {
  switch (mode) {
    case 'fresh':
      return [];
    case 'turn':
      return scope.turnMemory.get(memoryKey) ?? [];
    case 'session': {
      const lineage = lineageOf(scope.turnId);
      const rows = db
        .select()
        .from(agentMemories)
        .where(and(eq(agentMemories.memoryKey, memoryKey), inArray(agentMemories.turnId, lineage)))
        .all();
      const nearest = lineage.map((turnId) => rows.find((r) => r.turnId === turnId)).find((r) => r !== undefined);
      return nearest?.messages ?? [];
    }
  }
}

/** memoryKey で識別されるサブエージェントの会話を、mode に応じた範囲で持ち越せるよう残す。fresh なら何もしない */
export function storeMemory(
  scope: MemoryScope,
  memoryKey: string,
  mode: CallSettings['memory'],
  messages: ModelMessage[],
): void {
  switch (mode) {
    case 'fresh':
      return;
    case 'turn':
      scope.turnMemory.set(memoryKey, messages);
      return;
    case 'session':
      db.insert(agentMemories)
        .values({ turnId: scope.turnId, memoryKey, messages })
        .onConflictDoUpdate({ target: [agentMemories.turnId, agentMemories.memoryKey], set: { messages } })
        .run();
      return;
  }
}
