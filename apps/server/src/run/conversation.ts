import type { ModelMessage } from 'ai';
import type { InvocableNode } from 'protocol';
import type { RunScope } from './invoke.ts';

/** 前のターン1回分の、ユーザーの発言と返答 */
export type PastTurn = { userText: string; reply: string };

/**
 * ノードの会話の設定で見せる、ユーザーとの会話。past は前のターンまでのうち見せる分、current は今回の発言（見せないなら null）。
 * Web検索は会話を見ない
 */
export function conversationOf(scope: RunScope, node: InvocableNode): Conversation {
  if (node.kind === 'webSearch' || node.config.conversation === 'none') return new Conversation([], null);
  const { pastTurns } = scope;
  const past = node.config.conversation === 'recent' ? pastTurns.slice(Math.max(0, pastTurns.length - node.config.conversationLength)) : pastTurns;
  return new Conversation(past, scope.userText);
}

/** ノードに見せる、ユーザーとの会話。会話の設定で絞ったものを、対話か記録の形にする。プロンプトのどこに置くかは扱わない */
export class Conversation {
  constructor(
    private readonly past: PastTurn[],
    readonly current: string | null,
  ) {}

  /** 前のターンを、ユーザーとの対話のメッセージとして並べたもの */
  dialogue(): ModelMessage[] {
    return this.past.flatMap((turn): ModelMessage[] => [
      { role: 'user', content: turn.userText },
      { role: 'assistant', content: replyOf(turn) },
    ]);
  }

  /** 会話の記録を <conversation> で囲んだもの。includeCurrent なら今回の発言も末尾に入れる。入れる発言が無ければ null */
  transcript(includeCurrent: boolean): string | null {
    const lines = this.past.flatMap((turn) => [`[user] ${turn.userText}`, `[assistant] ${replyOf(turn)}`]);
    if (includeCurrent && this.current !== null) lines.push(`[user] ${this.current}`);
    return lines.length > 0 ? `<conversation>\n${lines.join('\n')}\n</conversation>` : null;
  }
}

/** 返答が空のターン（中断など）は、空の発言を渡さないよう返答なしと書く */
function replyOf(turn: PastTurn): string {
  return turn.reply || '（返答なし）';
}
