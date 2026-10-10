import { useMemo, useState } from 'react';
import type { RunEvent, RunEventType, TurnRecord } from 'protocol';
import { nodeTitle } from '../graph/kinds.tsx';
import { turnPath, useSession } from '../session/store.ts';

/** 表示中の分岐のターンについて、実行イベントと集計を表示する */
export function LogPanel() {
  const turns = useSession((s) => s.turns);
  const activeTurnId = useSession((s) => s.activeTurnId);
  const allEvents = useSession((s) => s.events);
  const path = useMemo(() => turnPath(turns, activeTurnId), [turns, activeTurnId]);
  const [tab, setTab] = useState<'events' | 'stats'>('events');

  return (
    <div className="log">
      <div className="log-tabs">
        <button className={tab === 'events' ? 'active' : ''} onClick={() => setTab('events')}>
          イベント
        </button>
        <button className={tab === 'stats' ? 'active' : ''} onClick={() => setTab('stats')}>
          集計
        </button>
      </div>
      {tab === 'events' ? <EventList path={path} events={allEvents} /> : <Stats path={path} events={allEvents} />}
    </div>
  );
}

type EventsByTurn = Record<string, RunEvent[]>;

const eventTypes: RunEventType[] = ['call.start', 'step.finish', 'tool.call', 'tool.result', 'log', 'call.finish', 'turn.finish'];

function EventList({ path, events }: { path: TurnRecord[]; events: EventsByTurn }) {
  const [turnId, setTurnId] = useState<string>('');
  const [nodeId, setNodeId] = useState<string>('');
  const [hidden, setHidden] = useState<Set<RunEventType>>(new Set());
  const [expanded, setExpanded] = useState<string | null>(null);

  const rows = path
    .filter((t) => !turnId || t.id === turnId)
    .flatMap((turn) => (events[turn.id] ?? []).map((event) => ({ turn, turnNumber: path.indexOf(turn) + 1, event })))
    .filter(({ event }) => (!nodeId || event.nodeId === nodeId) && !hidden.has(event.type));
  const nodeIds = [...new Set(path.flatMap((t) => (events[t.id] ?? []).map((e) => e.nodeId)))].filter(Boolean);
  const latestGraph = path.at(-1)?.graph;

  return (
    <div className="log-body">
      <div className="log-filters">
        <select value={turnId} onChange={(e) => setTurnId(e.target.value)}>
          <option value="">全ターン</option>
          {path.map((t, i) => (
            <option key={t.id} value={t.id}>
              ターン {i + 1}
            </option>
          ))}
        </select>
        <select value={nodeId} onChange={(e) => setNodeId(e.target.value)}>
          <option value="">全ノード</option>
          {nodeIds.map((id) => (
            <option key={id} value={id}>
              {latestGraph ? nodeTitle(latestGraph, id) : id}
            </option>
          ))}
        </select>
        {eventTypes.map((type) => (
          <label key={type} className="check">
            <input
              type="checkbox"
              checked={!hidden.has(type)}
              onChange={(e) => {
                const next = new Set(hidden);
                if (e.target.checked) next.delete(type);
                else next.add(type);
                setHidden(next);
              }}
            />
            {type}
          </label>
        ))}
      </div>
      <table className="log-table">
        <tbody>
          {rows.map(({ turn, turnNumber, event }) => {
            const key = `${event.turnId}:${event.seq}`;
            const open = expanded === key;
            return (
              <tr key={key} className={`log-row type-${event.type.replace('.', '-')}`} onClick={() => setExpanded(open ? null : key)}>
                <td className="time">{new Date(event.at).toLocaleTimeString()}</td>
                <td>T{turnNumber}</td>
                <td>{event.nodeId ? nodeTitle(turn.graph, event.nodeId) : '-'}</td>
                <td className="type">{event.type}</td>
                <td className="summary">{open ? <pre className="json">{JSON.stringify(event, null, 2)}</pre> : summaryOf(event)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function summaryOf(event: RunEvent): string {
  switch (event.type) {
    case 'call.start':
      return `depth ${event.depth}: ${event.task}`;
    case 'step.finish': {
      const { step } = event;
      return `#${step.index} ${step.model} ${step.finishReason} in:${step.usage.inputTokens} out:${step.usage.outputTokens} ${formatCost(step.cost)} ${step.durationMs}ms${step.aborted ? ' (中断)' : ''}`;
    }
    case 'tool.call':
      return `${event.toolName} ${JSON.stringify(event.input)}`;
    case 'tool.result':
      return `${event.isError ? '✖ ' : ''}${event.toolName} ${typeof event.output === 'string' ? event.output : JSON.stringify(event.output)}`;
    case 'file.change':
      return `${event.deleted ? '削除' : '書き込み'} ${event.volume}:${event.path}`;
    case 'log':
      return `[${event.level}] ${event.message}`;
    case 'call.finish':
      return `${event.status} ${event.error ?? event.output}`;
    case 'turn.finish':
      return `${event.status}${event.error ? ` ${event.error}` : ''}`;
    case 'text.delta':
      return event.text;
  }
}

/** ステップの集計値。cost はコストが判明したステップだけの合計で、1つも判明しなければ null */
type Totals = { steps: number; inputTokens: number; outputTokens: number; cost: number | null; durationMs: number };

function Stats({ path, events }: { path: TurnRecord[]; events: EventsByTurn }) {
  const rows = path.flatMap((turn, i) => {
    const byNode = new Map<string, Totals>();
    for (const event of events[turn.id] ?? []) {
      if (event.type !== 'step.finish') continue;
      byNode.set(event.nodeId, add(byNode.get(event.nodeId) ?? emptyTotals(), event.step));
    }
    const nodeRows = [...byNode].map(([nodeId, totals]) => ({
      key: `${turn.id}:${nodeId}`,
      turn: `T${i + 1}`,
      node: nodeTitle(turn.graph, nodeId),
      totals,
      isTotal: false,
    }));
    const turnTotals = nodeRows.reduce((acc, r) => merge(acc, r.totals), emptyTotals());
    return [...nodeRows, { key: turn.id, turn: `T${i + 1}`, node: '合計', totals: turnTotals, isTotal: true }];
  });

  return (
    <div className="log-body">
      <table className="stats-table">
        <thead>
          <tr>
            <th>ターン</th>
            <th>ノード</th>
            <th>ステップ</th>
            <th>入力トークン</th>
            <th>出力トークン</th>
            <th>コスト</th>
            <th>所要時間</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className={r.isTotal ? 'total' : ''}>
              <td>{r.turn}</td>
              <td>{r.node}</td>
              <td>{r.totals.steps}</td>
              <td>{r.totals.inputTokens}</td>
              <td>{r.totals.outputTokens}</td>
              <td>{formatCost(r.totals.cost)}</td>
              <td>{(r.totals.durationMs / 1000).toFixed(1)}s</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function emptyTotals(): Totals {
  return { steps: 0, inputTokens: 0, outputTokens: 0, cost: null, durationMs: 0 };
}

function add(totals: Totals, step: { usage: { inputTokens: number; outputTokens: number }; cost: number | null; durationMs: number }): Totals {
  return merge(totals, { steps: 1, ...step.usage, cost: step.cost, durationMs: step.durationMs });
}

function merge(a: Totals, b: Totals): Totals {
  return {
    steps: a.steps + b.steps,
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cost: a.cost === null && b.cost === null ? null : (a.cost ?? 0) + (b.cost ?? 0),
    durationMs: a.durationMs + b.durationMs,
  };
}

function formatCost(cost: number | null): string {
  return cost === null ? '$?' : `$${cost.toFixed(6)}`;
}
