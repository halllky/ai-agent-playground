import { useMemo, useState } from 'react';
import type { RunEvent, RunEventOf, TurnRecord } from 'protocol';
import { siblingsOf } from '../branches.ts';
import { branchFrom, showBranch, showTurnGraph, useStore } from '../store.ts';
import { Markdown } from '../ui/Markdown.tsx';
import { CopyButton, ErrorNote } from '../ui/primitives.tsx';
import { CallTree } from './CallTree.tsx';
import { buildTurnTree, type TurnLog } from './turnTree.ts';

/**
 * ユーザーの発言と、それに対するノードの呼び出し・返答の1ターン分の表示。
 * 発言の編集・再実行による分岐の作成と、同じ親から分かれた分岐の切り替えもここで受け付ける
 */
export function TurnView({ turn, busy }: { turn: TurnRecord; busy: boolean }) {
  const events = useStore((s) => s.events[turn.id]);
  const { calls, totals, logs } = useMemo(() => buildTurnTree(events ?? []), [events]);
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
        <Logs logs={logs} />
        <CallTree calls={calls} totals={totals} running={turn.status === 'running'} graph={turn.graph} />
        {turn.reply ? <Markdown className="my-1" text={turn.reply} /> : turn.status === 'done' && <div className="text-sm text-muted">（返答はありません）</div>}
        {turn.status === 'aborted' && <div className="text-sm text-muted">中断しました</div>}
        {turnError && <ErrorNote>{turnError}</ErrorNote>}
      </div>
      <div className={messageActions}>
        {turn.reply && <CopyButton text={turn.reply} />}
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
  const turns = useStore((s) => s.turns);
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

/** ユーザー入力編集テキストエディタ。発言を書き換えて、同じ親の下に新しい分岐として送り直す */
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

/** ターン全体についての記録 */
function Logs({ logs }: { logs: TurnLog[] }) {
  return logs.map((log, i) => (
    <div key={i} className={`text-sm ${logColors[log.level]}`}>
      {log.message}
    </div>
  ));
}

const logColors: Record<RunEventOf<'log'>['level'], string> = {
  info: 'text-muted',
  warn: 'text-warn',
  error: 'text-danger',
};

function finishErrorOf(events: RunEvent[] | undefined): string | null {
  const finish = events?.find((e) => e.type === 'turn.finish');
  return finish?.type === 'turn.finish' ? finish.error : null;
}
