import { useMemo, useState } from 'react';
import type { GraphDefinition, RunEvent, RunStatus, TurnRecord } from 'protocol';
import { nodeTitle } from '../graph/kinds.tsx';
import { Markdown } from '../markdown/Markdown.tsx';
import { branchFrom, showBranch, showTurnGraph, siblingsOf, useSession } from '../session/store.ts';
import { CodeBlock, ErrorNote, Pending } from '../ui/primitives.tsx';
import { buildCallTree, type CallItem, type CallView } from './callTree.ts';

/** ユーザーが入力した内容とそれに対するAIの応答の1ターン分の表示 */
export function TurnView({ turn, busy }: { turn: TurnRecord; busy: boolean }) {
  const events = useSession((s) => s.events[turn.id]);
  const root = useMemo(() => buildCallTree(events ?? []), [events]);
  const turnError = finishErrorOf(events);
  const [editing, setEditing] = useState(false);
  return (
    <div className="group mb-4">
      <BranchSwitcher turn={turn} />
      {editing ? (
        <UserTextEditor turn={turn} busy={busy} onClose={() => setEditing(false)} />
      ) : (
        <>
          <div className="ml-[15%] rounded-lg bg-highlight px-2.5 py-2 wrap-break-word whitespace-pre-wrap">{turn.userText}</div>
          <div className={`${messageActions} justify-end`}>
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
      <div className="wrap-break-word">
        {root ? <CallBody call={root} graph={turn.graph} /> : turn.status === 'running' && <Pending />}
        {turn.status === 'aborted' && <div className="text-sm text-muted">中断しました</div>}
        {turnError && !root?.error && <ErrorNote>{turnError}</ErrorNote>}
      </div>
      <div className={messageActions}>
        {root && root.status !== 'running' && responseText(root) && <CopyButton text={responseText(root)} />}
        <button type="button" onClick={() => showTurnGraph(turn.id)}>
          実行時のグラフ
        </button>
      </div>
    </div>
  );
}

/** 発言の下に並ぶ操作。ターンにカーソルを載せたときだけ見せる */
const messageActions = 'mt-0.5 mb-2 flex gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 *:px-1.5 *:py-px *:text-xs *:text-muted';

/** 同じ親から分かれた発言が複数あるとき、どれを表示するかの切り替え */
function BranchSwitcher({ turn }: { turn: TurnRecord }) {
  const turns = useSession((s) => s.turns);
  const siblings = siblingsOf(turns, turn);
  if (siblings.length < 2) return null;
  const index = siblings.findIndex((t) => t.id === turn.id);
  return (
    <div className="mb-0.5 flex items-center justify-end gap-1 text-xs text-muted *:px-1.5 *:py-0 *:text-xs">
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
      className="mb-2 ml-[15%] flex flex-col gap-1"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <textarea
        className="resize-y"
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
      <div className="flex justify-end gap-1">
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

/** AI側の応答欄。ツール呼び出しも含む */
function CallBody({ call, graph }: { call: CallView; graph: GraphDefinition }) {
  const liveText = useSession((s) => s.liveText[call.callId]);
  return (
    <>
      {call.items.map((item, i) => (
        <Item key={i} item={item} graph={graph} />
      ))}
      {liveText && <Markdown className="my-1 text-muted" text={liveText} />}
      {call.status === 'running' && !liveText && <Pending />}
      {call.error && <ErrorNote>{call.error}</ErrorNote>}
    </>
  );
}

/**
 * ツール呼び出し結果欄。
 * ツールがサブエージェントであることもあるので、AI応答欄とは循環参照の関係にある。
 */
function Item({ item, graph }: { item: CallItem; graph: GraphDefinition }) {
  if (item.kind === 'text') {
    const abortedMark = "after:text-muted after:content-['_…(中断)']";
    return <Markdown className={`my-1 ${item.aborted ? abortedMark : ''}`} text={item.text} />;
  }
  if (item.child) {
    return (
      <details className={callDetails}>
        <summary className={callSummary}>
          <StatusDot status={item.child.status} />
          🤖 {nodeTitle(graph, item.child.nodeId)}: <span className="text-ink">{item.child.task}</span>
        </summary>
        <div className="pl-1">
          <CallBody call={item.child} graph={graph} />
        </div>
      </details>
    );
  }
  return (
    <details className={callDetails}>
      <summary className={callSummary}>
        <StatusDot status={item.result ? (item.result.isError ? 'error' : 'done') : 'running'} />
        🔧 {item.toolName}
      </summary>
      <CodeBlock text={JSON.stringify(item.input, null, 2)} />
      {item.result && <CodeBlock text={typeof item.result.output === 'string' ? item.result.output : JSON.stringify(item.result.output, null, 2)} />}
    </details>
  );
}

const callDetails = 'my-1 border-l-2 px-2 py-0.5';
const callSummary = 'cursor-pointer text-muted';

function StatusDot({ status }: { status: RunStatus }) {
  return <span className={`mr-1.5 inline-block size-[7px] rounded-full ${statusDotColors[status]}`} />;
}

const statusDotColors: Record<RunStatus, string> = {
  running: 'bg-accent',
  done: 'bg-muted',
  error: 'bg-danger',
  aborted: 'bg-warn',
};

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

/** 呼び出しの応答として見せたテキスト。ツールコールやサブエージェントの中身は含めない */
function responseText(call: CallView): string {
  return call.items.flatMap((item) => (item.kind === 'text' ? [item.text] : [])).join('\n\n');
}

function finishErrorOf(events: RunEvent[] | undefined): string | null {
  const finish = events?.find((e) => e.type === 'turn.finish');
  return finish?.type === 'turn.finish' ? finish.error : null;
}
