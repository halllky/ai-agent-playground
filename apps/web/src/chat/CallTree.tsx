import type { ReactNode } from 'react';
import type { GraphDefinition, RunStatus, StepRecord } from 'protocol';
import { nodeTitle } from '../graph/kinds/index.ts';
import { useStore } from '../store.ts';
import { Markdown } from '../ui/Markdown.tsx';
import { CodeBlock, Disclosure, ErrorNote, Pending } from '../ui/primitives.tsx';
import { formatDuration, metricsOf, TotalsLine, type Totals } from './totals.tsx';
import type { CallView, StepView, ToolCallView } from './turnTree.ts';

/**
 * ターンの中のノードの呼び出しを、ツールとしての呼び出しの入れ子のまま実行順に並べる。
 * 実行中は展開して見せ、終わったら集計の折りたたみに収める
 */
export function CallTree({ calls, totals, running, graph }: { calls: CallView[]; totals: Totals; running: boolean; graph: GraphDefinition }) {
  const entries = calls.map((call) => <FlowCall key={call.callId} call={call} graph={graph} />);
  if (running) {
    return (
      <>
        {totals.steps > 1 && <TotalsLine className="my-1 text-muted" totals={totals} />}
        {entries}
        {calls.length === 0 && <Pending />}
      </>
    );
  }
  if (calls.length === 0) return null;
  return (
    <Disclosure className="my-1" summary={<TotalsLine totals={totals} />}>
      {() => <div className={nested}>{entries}</div>}
    </Disclosure>
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
  const liveText = useStore((s) => (record ? undefined : s.liveText[callId]));
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
