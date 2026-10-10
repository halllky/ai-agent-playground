import { create } from 'zustand';
import type { GraphDefinition, GraphRecord, ModelInfo, RunEvent, SessionRecord, TurnRecord } from 'protocol';
import { api } from '../api.ts';

type State = {
  graphs: GraphRecord[];
  sessions: SessionRecord[];
  /** 取得前・取得失敗時は undefined */
  models: ModelInfo[] | undefined;
  /** 編集中のグラフ。セッションを開いているときはそのセッションが参照するグラフ */
  graphId: string | null;
  sessionId: string | null;
  turns: TurnRecord[];
  activeTurnId: string | null;
  /** ターンごとの永続イベント（`text.delta` を除く） */
  events: Record<string, RunEvent[]>;
  /** 呼び出しごとの、まだステップとして確定していない生成中テキスト */
  liveText: Record<string, string>;
  error: string | null;
};

const initialState: State = {
  graphs: [],
  sessions: [],
  models: undefined,
  graphId: null,
  sessionId: null,
  turns: [],
  activeTurnId: null,
  events: {},
  liveText: {},
  error: null,
};

/**
 * 画面全体で共有する、グラフ・セッション・実行状況の状態。
 * 書き換えはこのモジュールの操作関数を通して行い、サーバーとの同期もそこで行う。
 * 操作関数はサーバーとの通信の失敗を例外にせず、error に入れて表示に回す。
 */
export const useSession = create<State>(() => initialState);

/** 画面を開いたときの読み込み。グラフが1つもなければ既定のグラフを作る */
export async function initialize(): Promise<void> {
  await report(async () => {
    let graphs = await api.graphs();
    if (graphs.length === 0) graphs = [await api.createGraph('Default')];
    const sessions = await api.sessions();
    useSession.setState({ graphs, sessions, graphId: graphs[0].id });
    if (sessions[0]) await openSession(sessions[0].id);
  });
  api.models().then(
    (models) => useSession.setState({ models }),
    (e) => useSession.setState({ error: `モデル一覧を取得できません: ${messageOf(e)}` }),
  );
}

/** セッションを開き、表示中の分岐のイベントを購読する。null ならセッションを開いていない状態にする */
export async function openSession(sessionId: string | null): Promise<void> {
  stopFollowingAll();
  if (!sessionId) {
    useSession.setState({ sessionId: null, turns: [], activeTurnId: null, events: {}, liveText: {} });
    return;
  }
  await report(async () => {
    const detail = await api.session(sessionId);
    useSession.setState({
      sessionId,
      graphId: detail.graphId,
      turns: detail.turns,
      activeTurnId: detail.activeTurnId,
      events: {},
      liveText: {},
    });
    for (const turn of turnPath(detail.turns, detail.activeTurnId)) follow(turn.id);
  });
}

/** 編集中のグラフを参照する新しいセッションを作って開く */
export async function createSession(): Promise<void> {
  const { graphId } = useSession.getState();
  if (!graphId) return;
  await report(async () => {
    const session = await api.createSession(graphId);
    useSession.setState((s) => ({ sessions: [session, ...s.sessions] }));
    await openSession(session.id);
  });
}

/** 編集対象のグラフを切り替える。セッションを開いていれば、そのセッションの参照先も切り替える */
export async function selectGraph(graphId: string): Promise<void> {
  await flushGraphSave();
  const { sessionId } = useSession.getState();
  await report(async () => {
    if (sessionId) {
      const session = await api.updateSession(sessionId, { graphId });
      useSession.setState((s) => ({ sessions: s.sessions.map((x) => (x.id === session.id ? session : x)) }));
    }
    useSession.setState({ graphId });
  });
}

/** 新しいグラフを作って編集対象にする。definition を渡さなければ既定の構成 */
export async function createGraph(name: string, definition?: GraphDefinition): Promise<void> {
  await report(async () => {
    const graph = await api.createGraph(name, definition);
    useSession.setState((s) => ({ graphs: [...s.graphs, graph].sort((a, b) => a.name.localeCompare(b.name)) }));
    await selectGraph(graph.id);
  });
}

/** グラフの名前を変える。編集対象は切り替えない */
export async function renameGraph(graphId: string, name: string): Promise<void> {
  await report(async () => {
    const graph = await api.updateGraph(graphId, { name });
    useSession.setState((s) => ({ graphs: s.graphs.map((g) => (g.id === graph.id ? graph : g)) }));
  });
}

/** 編集中のグラフ構成を書き換える。保存は少し遅らせてまとめて行う */
export function updateGraphDefinition(update: (definition: GraphDefinition) => GraphDefinition): void {
  const { graphId, graphs } = useSession.getState();
  const graph = graphs.find((g) => g.id === graphId);
  if (!graph) return;
  const definition = update(graph.definition);
  useSession.setState({ graphs: graphs.map((g) => (g.id === graph.id ? { ...g, definition } : g)) });
  if (pendingSave) clearTimeout(pendingSave.timer);
  pendingSave = { graphId: graph.id, timer: setTimeout(() => void flushGraphSave(), 500) };
}

/** 表示中の分岐の末尾に発言を追加して実行する。セッションがなければ作る */
export async function send(userText: string): Promise<void> {
  // 実行はサーバー上の現在のグラフで行われるため、未保存の編集を先に反映する
  await flushGraphSave();
  if (!useSession.getState().sessionId) await createSession();
  const { sessionId, activeTurnId } = useSession.getState();
  if (!sessionId) return;
  await report(async () => {
    const turn = await api.createTurn(sessionId, activeTurnId, userText);
    useSession.setState((s) => ({ turns: [...s.turns, turn], activeTurnId: turn.id }));
    follow(turn.id);
  });
}

/** 実行中のターンの中断を要求する。中断の結果は購読中のイベントで届く */
export async function abort(turnId: string): Promise<void> {
  await report(() => api.abortTurn(turnId));
}

/** 表示中のエラーを消す */
export function dismissError(): void {
  useSession.setState({ error: null });
}

/** 会話の先頭から activeTurnId までのターン */
export function turnPath(turns: TurnRecord[], activeTurnId: string | null): TurnRecord[] {
  const byId = new Map(turns.map((t) => [t.id, t]));
  const path: TurnRecord[] = [];
  for (let turn = activeTurnId ? byId.get(activeTurnId) : undefined; turn; turn = turn.parentTurnId ? byId.get(turn.parentTurnId) : undefined) {
    path.unshift(turn);
  }
  return path;
}

let pendingSave: { graphId: string; timer: ReturnType<typeof setTimeout> } | undefined;

async function flushGraphSave(): Promise<void> {
  if (!pendingSave) return;
  const { graphId, timer } = pendingSave;
  clearTimeout(timer);
  pendingSave = undefined;
  const graph = useSession.getState().graphs.find((g) => g.id === graphId);
  if (graph) await report(() => api.updateGraph(graphId, { definition: graph.definition }));
}

const following = new Map<string, () => void>();

function follow(turnId: string): void {
  if (following.has(turnId)) return;
  following.set(turnId, api.followTurn(turnId, receive));
}

function stopFollowingAll(): void {
  for (const stop of following.values()) stop();
  following.clear();
}

function receive(event: RunEvent): void {
  useSession.setState((s) => {
    if (event.type === 'text.delta') {
      return { liveText: { ...s.liveText, [event.callId]: (s.liveText[event.callId] ?? '') + event.text } };
    }
    const received = s.events[event.turnId] ?? [];
    // 再接続で再生し直されたイベントを重複して取り込まない
    if (event.seq! <= (received.at(-1)?.seq ?? 0)) return {};
    const next: Partial<State> = { events: { ...s.events, [event.turnId]: [...received, event] } };
    if (event.type === 'step.finish' || event.type === 'call.finish') {
      next.liveText = { ...s.liveText, [event.callId]: '' };
    }
    if (event.type === 'turn.finish') {
      next.turns = s.turns.map((t) => (t.id === event.turnId ? { ...t, status: event.status } : t));
      following.delete(event.turnId);
    }
    return next;
  });
}

async function report<T>(action: () => Promise<T>): Promise<T | undefined> {
  try {
    return await action();
  } catch (e) {
    useSession.setState({ error: messageOf(e) });
    return undefined;
  }
}

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
