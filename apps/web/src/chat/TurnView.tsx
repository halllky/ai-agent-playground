import { useMemo, useState, type ReactNode } from 'react';
import type { GraphDefinition, RunEvent, RunEventOf, RunStatus, StepRecord, TurnRecord } from 'protocol';
import { nodeTitle } from '../graph/kinds';
import { Markdown } from '../markdown/Markdown';
import { branchFrom, showBranch, showTurnGraph, siblingsOf, useSession } from '../session/store';
import { CodeBlock, CopyButton, Disclosure, ErrorNote, Pending } from '../ui/primitives';
import { buildTurnTree, type CallView, type StepView, type ToolCallView, type TurnLog } from './callTree';
import { formatDuration, metricsOf, TotalsLine } from './totals';

/**
 * ユーザーが入力した内容とそれに対する応答の1ターン分の表示。
 * 実行中はノードの呼び出しを時系列に並べ、終わったらそれらを集計の折りたたみに収めて返答だけを見せる
 */
export function TurnView({ turn, busy }: { turn: TurnRecord; busy: boolean }) {
  const events = useSession((s) => s.events[turn.id]);
  const { calls, totals, logs } = useMemo(() => buildTurnTree(events ?? []), [events]);
  const turnError = finishErrorOf(events);
  const [editing, setEditing] = useState(false);
  const graph = turn.graph;
  const callEntries = calls.map((call) => <FlowCall key={call.callId} call={call} graph={graph} />);
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
        {turn.status === 'running' ? (
          <>
            {totals.steps > 1 && <TotalsLine className="my-1 text-muted" totals={totals} />}
            {callEntries}
            {calls.length === 0 && <Pending />}
          </>
        ) : (
          <>
            {calls.length > 0 && (
              <Disclosure className="my-1" summary={<TotalsLine totals={totals} />}>
                {() => <div className={nested}>{callEntries}</div>}
              </Disclosure>
            )}
            {turn.reply ? <Markdown className="my-1" text={turn.reply} /> : turn.status === 'done' && <div className="text-sm text-muted">（返答はありません）</div>}
          </>
        )}
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

/** フローから呼ばれた呼び出し。ノード名の見出しの下に中身を展開して見せる */
function FlowCall({ call, graph }: { call: CallView; graph: GraphDefinition }) {
  return (
    <div className="my-1">
      <div className="text-sm text-muted">
        <StatusDot status={call.status} />
        {nodeTitle(graph, call.nodeId)}
      </div>
      <CallBody call={call} graph={graph} />
    </div>
  );
}

/**
 * 呼び出しの中身。エージェントなら LLM へのリクエストとツール呼び出しを時系列に並べ、
 * それ以外のノードは返した出力を見せる
 */
function CallBody({ call, graph }: { call: CallView; graph: GraphDefinition }) {
  return (
    <>
      {call.steps.map((step) => (
        <Step key={step.index} callId={call.callId} step={step} graph={graph} />
      ))}
      {call.steps.length === 0 && (call.status === 'running' ? <Pending /> : call.output !== null && !call.error && <ValueBlock value={call.output} />)}
      {call.error && <ErrorNote>{call.error}</ErrorNote>}
    </>
  );
}

/** LLM への1リクエスト分。内訳の行、応答のテキスト、その応答で行ったツールコールの順に並べる */
function Step({ callId, step, graph }: { callId: string; step: StepView; graph: GraphDefinition }) {
  const { record } = step;
  // 生成中のテキストは結果が届いていないステップだけが読む。届いたステップは text.delta のたびに描画し直さずに済む
  const liveText = useSession((s) => (record ? undefined : s.liveText[callId]));
  return (
    <>
      <StepEntry step={step} />
      {record?.text && <StepText record={record} />}
      {liveText && <Markdown className="my-1 text-muted" text={liveText} />}
      {step.tools.map((tool) => (
        <ToolCall key={tool.toolCallId} tool={tool} graph={graph} />
      ))}
    </>
  );
}

function StepText({ record }: { record: StepRecord }) {
  const abortedMark = "after:text-muted after:content-['_…(中断)']";
  return <Markdown className={`my-1 ${record.aborted ? abortedMark : ''}`} text={record.text} />;
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
  return (
    <Entry status={record.aborted ? 'aborted' : 'done'} label={`${record.model} ${record.finishReason}`} metrics={metricsOf({ ...record.usage, durationMs: record.durationMs, cost: record.cost })}>
      {() => (
        <>
          {record.reasoning && <Disclosure summary="思考">{() => <CodeBlock text={record.reasoning ?? ''} />}</Disclosure>}
          {record.request !== null && <Disclosure summary="リクエスト">{() => <ValueBlock value={record.request} />}</Disclosure>}
          {record.response !== null && <Disclosure summary="レスポンス">{() => <ValueBlock value={record.response} />}</Disclosure>}
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
        {nodeTitle(graph, child.nodeId)}
        {child.input && (
          <>
            : <span className="text-ink">{excerpt(child.input)}</span>
          </>
        )}
      </>
    );
    return (
      <Entry status={child.status} label={label} metrics={metrics}>
        {() => <CallBody call={child} graph={graph} />}
      </Entry>
    );
  }
  return (
    <Entry status={result ? (result.isError ? 'error' : 'done') : 'running'} label={tool.toolName} metrics={metrics}>
      {() => (
        <>
          <ValueBlock value={tool.input} />
          {result && <ValueBlock value={result.output} />}
        </>
      )}
    </Entry>
  );
}

/** ツールの入出力や LLM との生のやりとり。文字列はそのまま、それ以外は JSON で見せる */
function ValueBlock({ value }: { value: unknown }) {
  return <CodeBlock text={typeof value === 'string' ? value : JSON.stringify(value, null, 2)} />;
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
      {() => <div className={nested}>{children()}</div>}
    </Disclosure>
  );
}

/** 折りたたみを開いたときの中身。入れ子が分かるよう字下げして線を引く */
const nested = 'my-1 ml-1 border-l-2 pl-3';

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

function StatusDot({ status }: { status: RunStatus }) {
  return <span className={`mr-1.5 inline-block size-[4px] rounded-full ${statusDotColors[status]}`} />;
}

const statusDotColors: Record<RunStatus, string> = {
  running: 'bg-accent',
  done: 'bg-muted opacity-10',
  error: 'bg-danger',
  aborted: 'bg-warn',
};

/** 長い入力を1行に収まる程度に切り詰める */
function excerpt(text: string): string {
  const firstLine = text.split('\n', 1)[0];
  return firstLine.length > 80 || firstLine !== text ? `${firstLine.slice(0, 80)}…` : text;
}

function finishErrorOf(events: RunEvent[] | undefined): string | null {
  const finish = events?.find((e) => e.type === 'turn.finish');
  return finish?.type === 'turn.finish' ? finish.error : null;
}
