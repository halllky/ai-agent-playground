import { useMemo, useState, type ReactNode } from 'react';
import type { GraphDefinition, RunEvent, RunEventOf, RunStatus, TurnRecord } from 'protocol';
import { nodeTitle } from '../graph/kinds';
import { Markdown } from '../markdown/Markdown';
import { branchFrom, showBranch, showTurnGraph, siblingsOf, useSession } from '../session/store';
import { CodeBlock, Disclosure, ErrorNote, Pending } from '../ui/primitives';
import { buildCallTree, type CallNote, type CallView, type StepView, type ToolCallView } from './callTree';
import { formatCost, formatDuration, formatTokens, formatTotals } from './totals';

/** ユーザーが入力した内容とそれに対するAIの応答の1ターン分の表示 */
export function TurnView({ turn, busy }: { turn: TurnRecord; busy: boolean }) {
  const events = useSession((s) => s.events[turn.id]);
  const { root, notes } = useMemo(() => buildCallTree(events ?? []), [events]);
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
        <Notes notes={notes} />
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

/** AI側の応答欄。LLM へのリクエストとツール呼び出しを時系列に並べる */
function CallBody({ call, graph }: { call: CallView; graph: GraphDefinition }) {
  const liveText = useSession((s) => s.liveText[call.callId]);
  return (
    <>
      {call.totals.steps > 1 && (
        <div className="flex gap-2 my-1 text-xs text-muted select-none">
          <span>合計:</span>
          {formatTotals(call.totals)}
        </div>
      )}
      {call.steps.map((step) => (
        <Step key={step.index} step={step} liveText={step.record ? undefined : liveText} graph={graph} />
      ))}
      {call.status === 'running' && call.steps.length === 0 && <Pending />}
      <Notes notes={call.notes} />
      {call.error && <ErrorNote>{call.error}</ErrorNote>}
    </>
  );
}

/** LLM への1リクエスト分。内訳の行、応答のテキスト、その応答で行ったツールコールの順に並べる */
function Step({ step, liveText, graph }: { step: StepView; liveText: string | undefined; graph: GraphDefinition }) {
  const { record } = step;
  const abortedMark = "after:text-muted after:content-['_…(中断)']";
  return (
    <>
      <StepEntry step={step} />
      {record?.text && <Markdown className={`my-1 ${record.aborted ? abortedMark : ''}`} text={record.text} />}
      {!record && liveText && <Markdown className="my-1 text-muted" text={liveText} />}
      {step.tools.map((tool) => (
        <ToolCall key={tool.toolCallId} tool={tool} graph={graph} />
      ))}
    </>
  );
}

/** LLM への1リクエスト分のうちステップの内訳の行。開くと思考と生のリクエスト・レスポンスを見せる */
function StepEntry({ step }: { step: StepView }) {
  const { record } = step;
  if (!record) {
    return (
      <Entry status="running" label="応答中" metrics={[]}>
        {() => <Pending />}
      </Entry>
    );
  }
  const json = (value: unknown) => () => <CodeBlock text={JSON.stringify(value, null, 2)} />;
  const metrics = [formatTokens(record.usage.inputTokens, record.usage.outputTokens), formatDuration(record.durationMs), formatCost(record.cost)];
  return (
    <Entry status={record.aborted ? 'aborted' : 'done'} label={`${record.model} ${record.finishReason}`} metrics={metrics}>
      {() => (
        <>
          {record.reasoning && <Disclosure summary="思考">{() => <CodeBlock text={record.reasoning ?? ''} />}</Disclosure>}
          {record.request !== null && <Disclosure summary="リクエスト">{json(record.request)}</Disclosure>}
          {record.response !== null && <Disclosure summary="レスポンス">{json(record.response)}</Disclosure>}
        </>
      )}
    </Entry>
  );
}

/** LLM への1リクエスト分のうちツール呼び出し内容の表示 */
function ToolCall({ tool, graph }: { tool: ToolCallView; graph: GraphDefinition }) {
  const { child, result } = tool;
  const metrics = result ? [formatDuration(result.durationMs)] : [];
  if (child) {
    const label = (
      <>
        {nodeTitle(graph, child.nodeId)}: <span className="text-ink">{child.task}</span>
      </>
    );
    return (
      <Entry status={child.status} label={label} metrics={metrics}>
        {() => (
          <>
            <Notes notes={tool.notes} />
            <CallBody call={child} graph={graph} />
          </>
        )}
      </Entry>
    );
  }
  return (
    <Entry status={result ? (result.isError ? 'error' : 'done') : 'running'} label={tool.toolName} metrics={metrics}>
      {() => (
        <>
          <CodeBlock text={JSON.stringify(tool.input, null, 2)} />
          {result && <CodeBlock text={typeof result.output === 'string' ? result.output : JSON.stringify(result.output, null, 2)} />}
          <Notes notes={tool.notes} />
        </>
      )}
    </Entry>
  );
}

/** 応答欄に時系列で並ぶ、LLM へのリクエストやツールコールの1行。開くと中身を字下げして見せる */
function Entry({ status, label, metrics, children }: { status: RunStatus; label: ReactNode; metrics: string[]; children: () => ReactNode }) {
  const summary = (
    <>
      <StatusDot status={status} />
      {label}
      {metrics.map((metric) => (
        <span key={metric} className="ml-2 text-xs">
          {metric}
        </span>
      ))}
    </>
  );
  return (
    <Disclosure className="my-0.5 text-sm" summary={summary}>
      {() => <div className="my-1 ml-1 border-l-2 pl-3">{children()}</div>}
    </Disclosure>
  );
}

/** ログやファイルの変更の記録 */
function Notes({ notes }: { notes: CallNote[] }) {
  return notes.map((note, i) =>
    note.type === 'log' ? (
      <div key={i} className={`text-sm ${logColors[note.level]}`}>
        {note.message}
      </div>
    ) : (
      <div key={i} className="text-sm text-muted">
        {note.deleted ? '削除' : '書き込み'} {note.volume}:{note.path}
      </div>
    ),
  );
}

const logColors: Record<RunEventOf<'log'>['level'], string> = {
  info: 'text-muted',
  warn: 'text-warn',
  error: 'text-danger',
};

function StatusDot({ status }: { status: RunStatus }) {
  return <span className={`mr-1.5 inline-block size-[4px] rounded-full ${statusDotColors[status]}`} />;
}

const statusDotColors: Record<RunStatus, string> = {
  running: 'bg-accent',
  done: 'bg-muted opacity-10',
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
  return call.steps.flatMap((step) => (step.record?.text ? [step.record.text] : [])).join('\n\n');
}

function finishErrorOf(events: RunEvent[] | undefined): string | null {
  const finish = events?.find((e) => e.type === 'turn.finish');
  return finish?.type === 'turn.finish' ? finish.error : null;
}
