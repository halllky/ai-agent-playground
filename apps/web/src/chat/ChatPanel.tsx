import { useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { GraphDefinition, RunEvent, TurnRecord } from 'protocol';
import { nodeTitle } from '../graph/kinds.tsx';
import { abort, send, turnPath, useSession } from '../session/store.ts';
import { buildCallTree, type CallItem, type CallView } from './callTree.ts';

/** 表示中の分岐の会話と、発言の入力欄。エージェントの発言は Markdown で表示し、サブエージェント呼び出しは入れ子で表示する */
export function ChatPanel() {
  const turns = useSession((s) => s.turns);
  const activeTurnId = useSession((s) => s.activeTurnId);
  const path = useMemo(() => turnPath(turns, activeTurnId), [turns, activeTurnId]);
  const runningTurn = path.find((t) => t.status === 'running');
  const bottomRef = useRef<HTMLDivElement>(null);
  const eventCount = useSession((s) => (activeTurnId ? (s.events[activeTurnId]?.length ?? 0) : 0));

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [path.length, eventCount]);

  return (
    <div className="chat">
      <div className="messages">
        {path.map((turn) => (
          <TurnView key={turn.id} turn={turn} />
        ))}
        <div ref={bottomRef} />
      </div>
      <Composer running={runningTurn} />
    </div>
  );
}

function TurnView({ turn }: { turn: TurnRecord }) {
  const events = useSession((s) => s.events[turn.id]);
  const root = useMemo(() => buildCallTree(events ?? []), [events]);
  const turnError = finishErrorOf(events);
  return (
    <div className="turn">
      <div className="message user">{turn.userText}</div>
      <MessageActions className="user" text={turn.userText} />
      <div className="message assistant">
        {root ? <CallBody call={root} graph={turn.graph} /> : turn.status === 'running' && <span className="pending">…</span>}
        {turn.status === 'aborted' && <div className="status-note">中断しました</div>}
        {turnError && !root?.error && <div className="status-note error">{turnError}</div>}
      </div>
      {root && root.status !== 'running' && <MessageActions text={responseText(root)} />}
    </div>
  );
}

function CallBody({ call, graph }: { call: CallView; graph: GraphDefinition }) {
  const liveText = useSession((s) => s.liveText[call.callId]);
  return (
    <>
      {call.items.map((item, i) => (
        <Item key={i} item={item} graph={graph} />
      ))}
      {liveText && <Markdown className="text live" text={liveText} />}
      {call.status === 'running' && !liveText && <span className="pending">…</span>}
      {call.error && <div className="status-note error">{call.error}</div>}
    </>
  );
}

function Item({ item, graph }: { item: CallItem; graph: GraphDefinition }) {
  if (item.kind === 'text') return <Markdown className={`text${item.aborted ? ' aborted' : ''}`} text={item.text} />;
  if (item.child) {
    return (
      <details className="call">
        <summary>
          <span className={`status-dot ${item.child.status}`} />
          🤖 {nodeTitle(graph, item.child.nodeId)}: <span className="task">{item.child.task}</span>
        </summary>
        <div className="call-body">
          <CallBody call={item.child} graph={graph} />
        </div>
      </details>
    );
  }
  return (
    <details className="call">
      <summary>
        <span className={`status-dot ${item.result ? (item.result.isError ? 'error' : 'done') : 'running'}`} />
        🔧 {item.toolName}
      </summary>
      <pre className="json">{JSON.stringify(item.input, null, 2)}</pre>
      {item.result && <pre className="json">{typeof item.result.output === 'string' ? item.result.output : JSON.stringify(item.result.output, null, 2)}</pre>}
    </details>
  );
}

function Markdown({ text, className }: { text: string; className: string }) {
  return (
    <div className={`markdown ${className}`}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
        {text}
      </ReactMarkdown>
    </div>
  );
}

const markdownComponents: Components = {
  // 会話を見失わないよう、リンクは別タブで開く
  a: ({ node: _, ...props }) => <a {...props} target="_blank" rel="noreferrer" />,
};

/** 発言の下に並べる操作。text が空なら何も出さない */
function MessageActions({ text, className }: { text: string; className?: string }) {
  if (!text) return null;
  return (
    <div className={`message-actions ${className ?? ''}`}>
      <CopyButton text={text} />
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [result, setResult] = useState<'copied' | 'failed' | null>(null);
  const copy = () => {
    const showResult = (r: 'copied' | 'failed') => {
      setResult(r);
      setTimeout(() => setResult(null), 1500);
    };
    navigator.clipboard.writeText(text).then(
      () => showResult('copied'),
      () => showResult('failed'),
    );
  };
  return (
    <button type="button" className="copy-button" onClick={copy}>
      {result === 'copied' ? 'コピーしました' : result === 'failed' ? 'コピーできません' : 'コピー'}
    </button>
  );
}

function Composer({ running }: { running: TurnRecord | undefined }) {
  const [input, setInput] = useState('');
  const submit = () => {
    if (!input.trim() || running) return;
    void send(input);
    setInput('');
  };
  return (
    <form
      className="composer"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <textarea
        value={input}
        rows={3}
        placeholder="メッセージ（Ctrl+Enter で送信）"
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            submit();
          }
        }}
      />
      {running ? (
        <button type="button" className="danger" onClick={() => void abort(running.id)}>
          中断
        </button>
      ) : (
        <button type="submit" disabled={!input.trim()}>
          送信
        </button>
      )}
    </form>
  );
}

/** 呼び出しの応答として見せたテキスト。ツールコールやサブエージェントの中身は含めない */
function responseText(call: CallView): string {
  return call.items.flatMap((item) => (item.kind === 'text' ? [item.text] : [])).join('\n\n');
}

function finishErrorOf(events: RunEvent[] | undefined): string | null {
  const finish = events?.find((e) => e.type === 'turn.finish');
  return finish?.type === 'turn.finish' ? finish.error : null;
}
