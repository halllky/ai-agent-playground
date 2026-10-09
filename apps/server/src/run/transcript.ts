import type { ModelMessage } from 'ai';

/**
 * 会話履歴を、別のエージェントに読ませるためのテキストにする。
 * メッセージのまま渡すと、相手が持たないツールのコール・結果が混ざってプロバイダに拒否されることがあるため、テキストにしている。
 */
export function transcriptOf(messages: ModelMessage[]): string {
  return messages.flatMap(linesOf).join('\n');
}

function linesOf(message: ModelMessage): string[] {
  if (typeof message.content === 'string') return [`[${message.role}] ${message.content}`];
  return message.content.flatMap((part): string[] => {
    switch (part.type) {
      case 'text':
        return [`[${message.role}] ${part.text}`];
      case 'tool-call':
        return [`[tool call] ${part.toolName} ${JSON.stringify(part.input)}`];
      case 'tool-result':
        return [`[tool result] ${part.toolName} ${JSON.stringify(part.output)}`];
      default:
        return [];
    }
  });
}
