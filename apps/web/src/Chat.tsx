import { useState } from 'react';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';

const transport = new DefaultChatTransport({ api: '/api/chat' });

export function Chat() {
  const { messages, sendMessage, status, error } = useChat({ transport });
  const [input, setInput] = useState('');

  const busy = status === 'submitted' || status === 'streaming';

  return (
    <div className="chat">
      <div className="messages">
        {messages.map((m) => (
          <div key={m.id} className="message">
            <div className="role">{m.role}</div>
            {m.parts.map((part, i) => {
              if (part.type === 'text') return <div key={i}>{part.text}</div>;
              if (part.type.startsWith('tool-')) return <div key={i} className="tool">🔧 {part.type.slice(5)}</div>;
              return null;
            })}
          </div>
        ))}
        {error && <div className="message tool">Error: {error.message}</div>}
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!input.trim()) return;
          sendMessage({ text: input });
          setInput('');
        }}
      >
        <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Message..." disabled={busy} />
        <button type="submit" disabled={busy}>
          Send
        </button>
      </form>
    </div>
  );
}
