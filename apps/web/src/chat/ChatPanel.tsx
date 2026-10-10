import { useEffect, useMemo, useRef, useState } from 'react';
import type { GraphDefinition, RunEvent, TurnRecord } from 'protocol';
import { nodeTitle } from '../graph/kinds.tsx';
import { Markdown } from '../markdown/Markdown.tsx';
import { abort, branchFrom, send, showBranch, showTurnGraph, siblingsOf, turnPath, useSession } from '../session/store.ts';
import { buildCallTree, type CallItem, type CallView } from './callTree.ts';

/**
 * 表示中の分岐の会話と、発言の入力欄。エージェントの発言は Markdown で表示し、サブエージェント呼び出しは入れ子で表示する。
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
    <div className="chat">
      <div className="messages">
        {path.map((turn) => (
          <TurnView key={turn.id} turn={turn} busy={runningTurn !== undefined} />
        ))}
        <div ref={bottomRef} />
      </div>
      <Composer running={runningTurn} />
    </div>
  );
}

function TurnView({ turn, busy }: { turn: TurnRecord; busy: boolean }) {
  const events = useSession((s) => s.events[turn.id]);
  const root = useMemo(() => buildCallTree(events ?? []), [events]);
  const turnError = finishErrorOf(events);
  const [editing, setEditing] = useState(false);
  return (
    <div className="turn">
      <BranchSwitcher turn={turn} />
      {editing ? (
        <UserTextEditor turn={turn} busy={busy} onClose={() => setEditing(false)} />
      ) : (
        <>
          <div className="message user">{turn.userText}</div>
          <div className="message-actions user">
            <CopyButton text={turn.userText} />
            <button type="button" disabled={busy} onClick={() => setEditing(true)}>
              編集
            </button>
            <button type="button" disabled={busy} onClick={() => void branchFrom(turn)}>
              再実行
            </button>
          </div>
        </>
      )}
      <div className="message assistant">
        {root ? <CallBody call={root} graph={turn.graph} /> : turn.status === 'running' && <span className="pending">…</span>}
        {turn.status === 'aborted' && <div className="status-note">中断しました</div>}
        {turnError && !root?.error && <div className="status-note error">{turnError}</div>}
      </div>
      <div className="message-actions">
        {root && root.status !== 'running' && responseText(root) && <CopyButton text={responseText(root)} />}
        <button type="button" onClick={() => showTurnGraph(turn.id)}>
          実行時のグラフ
        </button>
      </div>
    </div>
  );
}

/** 同じ親から分かれた発言が複数あるとき、どれを表示するかの切り替え */
function BranchSwitcher({ turn }: { turn: TurnRecord }) {
  const turns = useSession((s) => s.turns);
  const siblings = siblingsOf(turns, turn);
  if (siblings.length < 2) return null;
  const index = siblings.findIndex((t) => t.id === turn.id);
  return (
    <div className="branch-switcher">
      <button type="button" disabled={index === 0} onClick={() => void showBranch(siblings[index - 1].id)}>
        ‹
      </button>
      {index + 1} / {siblings.length}
      <button type="button" disabled={index === siblings.length - 1} onClick={() => void showBranch(siblings[index + 1].id)}>
        ›
      </button>
    </div>
  );
}

/** 発言を書き換えて、同じ親の下に新しい分岐として送り直す */
function UserTextEditor({ turn, busy, onClose }: { turn: TurnRecord; busy: boolean; onClose: () => void }) {
  const [text, setText] = useState(turn.userText);
  const submit = () => {
    if (!text.trim() || busy) return;
    void branchFrom(turn, text);
    onClose();
  };
  return (
    <form
      className="user-editor"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <textarea
        value={text}
        rows={3}
        autoFocus
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            submit();
          }
          if (e.key === 'Escape') onClose();
        }}
      />
      <div className="user-editor-actions">
        <button type="button" onClick={onClose}>
          キャンセル
        </button>
        <button type="submit" disabled={!text.trim() || busy}>
          再送信
        </button>
      </div>
    </form>
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
    <button type="button" onClick={copy}>
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
