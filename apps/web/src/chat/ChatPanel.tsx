import { useEffect, useMemo, useRef, useState } from 'react';
import type { TurnRecord } from 'protocol';
import { abort, createSession, openSession, send, turnPath, useSession } from '../session/store';
import { formatTotals, totalsOf } from './totals';
import { TurnView } from './TurnView';

/**
 * セッションの切り替えと、表示中の分岐の会話と、発言の入力欄。エージェントの発言は Markdown で表示し、サブエージェント呼び出しは入れ子で表示する。
 * 過去の発言からは、編集して再送信・再実行で分岐を作り、分岐を切り替えて閲覧できる。
 * 実行は1セッションに1つまでとし、実行中は送信・分岐の作成をできなくする。
 */
export function ChatPanel() {
  const turns = useSession((s) => s.turns);
  const activeTurnId = useSession((s) => s.activeTurnId);
  const path = useMemo(() => turnPath(turns, activeTurnId), [turns, activeTurnId]);
  const runningTurn = turns.find((t) => t.status === 'running');
  const bottomRef = useRef<HTMLDivElement>(null);
  const eventCount = useSession((s) => (activeTurnId ? (s.events[activeTurnId]?.length ?? 0) : 0));

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [path.length, eventCount]);

  return (
    <div className="flex h-full flex-col">
      <SessionBar />
      <BranchTotals path={path} />
      <div className="flex-1 overflow-y-auto p-3">
        {path.map((turn) => (
          <TurnView key={turn.id} turn={turn} busy={runningTurn !== undefined} />
        ))}
        <div ref={bottomRef} />
      </div>
      <Composer running={runningTurn} />
    </div>
  );
}

/** 表示するセッションの切り替えと作成 */
function SessionBar() {
  const sessions = useSession((s) => s.sessions);
  const sessionId = useSession((s) => s.sessionId);
  return (
    <div className="flex items-center gap-1.5 border-b px-2 py-1.5">
      <select className="min-w-0 flex-1" value={sessionId ?? ''} onChange={(e) => void openSession(e.target.value || null)}>
        <option value="">（新しい会話）</option>
        {sessions.map((s) => (
          <option key={s.id} value={s.id}>
            {s.title}
          </option>
        ))}
      </select>
      <button onClick={() => void createSession()}>新規</button>
    </div>
  );
}

/** 表示中の分岐の全ターンを通したステップの集計 */
function BranchTotals({ path }: { path: TurnRecord[] }) {
  const events = useSession((s) => s.events);
  const totals = useMemo(() => totalsOf(path.flatMap((t) => (events[t.id] ?? []).flatMap((e) => (e.type === 'step.finish' ? [e.step] : [])))), [path, events]);
  if (totals.steps === 0) return null;
  return (
    <div className="flex gap-2 border-b px-2 py-0.5 text-xs text-muted select-none">
      <span>合計:</span>
      {formatTotals(totals)}
    </div>
  )
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
      className="flex gap-2 border-t p-2"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <textarea
        className="flex-1 resize-none"
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
        <button type="button" className="border-danger text-danger" onClick={() => void abort(running.id)}>
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
