import { create } from 'zustand';
import { modelProviders, type GraphDefinition, type ModelInfo, type ModelProvider, type RunEvent, type SessionRecord, type TurnRecord } from 'protocol';
import { api } from '../api.ts';
import { latestLeafOf, turnPath } from './branches.ts';

type State = {
  sessions: SessionRecord[];
  /** プロバイダごとのモデル一覧。取得前・取得失敗時は無い */
  models: Partial<Record<ModelProvider, ModelInfo[]>>;
  /** プロバイダごとの、モデル一覧を取得できなかった理由 */
  modelErrors: Partial<Record<ModelProvider, string>>;
  /** 開いているセッション。読み込みが終わるまでは null */
  sessionId: string | null;
  /** 編集中のグラフ。savedGraph と同じ参照なら未保存の変更は無い */
  graph: GraphDefinition | null;
  /** セッションに最後に保存したグラフ */
  savedGraph: GraphDefinition | null;
  turns: TurnRecord[];
  activeTurnId: string | null;
  /** グラフ欄に実行時のグラフを表示しているターン。null なら編集中のグラフを表示する */
  viewingTurnId: string | null;
  /** ターンごとの永続イベント（`text.delta` を除く） */
  events: Record<string, RunEvent[]>;
  /** 呼び出しごとの、まだステップとして確定していない生成中テキスト */
  liveText: Record<string, string>;
  error: string | null;
};

/**
 * 画面全体で共有する、セッション・グラフ・実行状況の状態。
 * 書き換えはこのモジュールの操作関数を通して行い、サーバーとの同期もそこで行う。
 * 操作関数はサーバーとの通信の失敗を例外にせず、error に入れて表示に回す。
 * 未保存のグラフの変更は、セッションの切り替え・作成と発言の送信の前に保存する。
 */
export const useSession = create<State>(() => ({
  sessions: [],
  models: {},
  modelErrors: {},
  sessionId: null,
  graph: null,
  savedGraph: null,
  turns: [],
  activeTurnId: null,
  viewingTurnId: null,
  events: {},
  liveText: {},
  error: null,
}));

/** 未保存のグラフの変更があるか */
export function hasUnsavedGraph(s: State): boolean {
  return s.graph !== s.savedGraph;
}

/** 画面を開いたときの読み込み。セッションが1つもなければ作る */
export async function initialize(): Promise<void> {
  await report(async () => {
    let sessions = await api.sessions();
    if (sessions.length === 0) sessions = [await api.createSession()];
    useSession.setState({ sessions });
    await openSession(sessions[0].id);
  });
  // 使わないプロバイダのキーは未設定のことがあるので、取得失敗は画面全体のエラーにしない
  for (const provider of modelProviders) {
    api.models(provider).then(
      (models) => useSession.setState((s) => ({ models: { ...s.models, [provider]: models } })),
      (e) => useSession.setState((s) => ({ modelErrors: { ...s.modelErrors, [provider]: messageOf(e) } })),
    );
  }
}

/** セッションを開き、表示中の分岐のイベントを購読する */
export async function openSession(sessionId: string): Promise<void> {
  if (!(await saveGraph())) return;
  stopFollowingAll();
  await report(async () => {
    const detail = await api.session(sessionId);
    useSession.setState({
      sessionId,
      graph: detail.graph,
      savedGraph: detail.graph,
      turns: detail.turns,
      activeTurnId: detail.activeTurnId,
      viewingTurnId: null,
      events: {},
      liveText: {},
    });
    for (const turn of turnPath(detail.turns, detail.activeTurnId)) follow(turn.id);
  });
}

/** 開いているセッションのグラフを写した、新しいセッションを作って開く */
export async function createSession(): Promise<void> {
  if (!(await saveGraph())) return;
  await report(async () => {
    const session = await api.createSession(useSession.getState().sessionId ?? undefined);
    useSession.setState((s) => ({ sessions: [session, ...s.sessions] }));
    await openSession(session.id);
  });
}

/**
 * 開いているセッションを、未保存のグラフの変更ごと消し、残ったセッションの先頭を開く。
 * 1つも残らなければ既定のグラフのセッションを作って開く
 */
export async function deleteSession(): Promise<void> {
  const { sessionId } = useSession.getState();
  if (!sessionId) return;
  await report(async () => {
    await api.deleteSession(sessionId);
    const sessions = useSession.getState().sessions.filter((s) => s.id !== sessionId);
    if (sessions.length === 0) sessions.push(await api.createSession());
    // 消したセッションへ未保存の変更を保存しに行かないよう、開いていない状態にしてから開き直す
    useSession.setState({ sessions, sessionId: null, graph: null, savedGraph: null });
    await openSession(sessions[0].id);
  });
}

/** 編集中のグラフを書き換える。サーバーへは保存せず、未保存の変更として持つ */
export function updateGraph(update: (graph: GraphDefinition) => GraphDefinition): void {
  useSession.setState((s) => (s.graph ? { graph: update(s.graph) } : {}));
}

/** 未保存の変更があればセッションに保存する。保存できなければ false */
export async function saveGraph(): Promise<boolean> {
  const { sessionId, graph, savedGraph } = useSession.getState();
  if (!sessionId || !graph || graph === savedGraph) return true;
  const saved = await report(() => api.updateSession(sessionId, { graph }));
  if (!saved) return false;
  // 保存中にさらに編集されていたら、その分は未保存のまま残る
  useSession.setState({ savedGraph: graph });
  return true;
}

/** グラフの未保存の変更を捨て、最後に保存した構成に戻す */
export function discardGraphChanges(): void {
  useSession.setState((s) => ({ graph: s.savedGraph }));
}

/** turn の実行時のグラフを、編集中のグラフとして読み込む。保存するまではセッションに反映しない */
export function loadTurnGraph(turn: TurnRecord): void {
  useSession.setState({ graph: turn.graph, viewingTurnId: null });
}

/** 表示中の分岐の末尾に発言を追加して実行する */
export async function send(userText: string): Promise<void> {
  await startTurn(useSession.getState().activeTurnId, userText);
}

/**
 * turn と同じ親の下に新しい分岐を作って実行する。
 * userText を省略すると同じ発言で再実行し、渡すとその発言に書き換えて再送信する。
 */
export async function branchFrom(turn: TurnRecord, userText = turn.userText): Promise<void> {
  await startTurn(turn.parentTurnId, userText);
}

/** turnId を含む分岐に表示を切り替える。turnId から先は、それぞれ最も新しい子をたどった末端まで表示する */
export async function showBranch(turnId: string): Promise<void> {
  const { sessionId, turns } = useSession.getState();
  if (!sessionId) return;
  const leaf = latestLeafOf(turns, turnId);
  useSession.setState({ activeTurnId: leaf });
  for (const turn of turnPath(turns, leaf)) follow(turn.id);
  await report(() => api.updateSession(sessionId, { activeTurnId: leaf }));
}

/** グラフ欄に turnId の実行時のグラフを表示する。null なら編集中のグラフに戻す */
export function showTurnGraph(turnId: string | null): void {
  useSession.setState({ viewingTurnId: turnId });
}

/** 実行中のターンの中断を要求する。中断の結果は購読中のイベントで届く */
export async function abort(turnId: string): Promise<void> {
  await report(() => api.abortTurn(turnId));
}

/** 表示中のエラーを消す */
export function dismissError(): void {
  useSession.setState({ error: null });
}

/** 実行はサーバー上のセッションのグラフで行われるため、未保存の編集を先に保存する */
async function startTurn(parentTurnId: string | null, userText: string): Promise<void> {
  if (!(await saveGraph())) return;
  const { sessionId } = useSession.getState();
  if (!sessionId) return;
  await report(async () => {
    const turn = await api.createTurn(sessionId, parentTurnId, userText);
    useSession.setState((s) => ({ turns: [...s.turns, turn], activeTurnId: turn.id }));
    follow(turn.id);
  });
}

const following = new Map<string, () => void>();

function follow(turnId: string): void {
  // 終わったターンのイベントは取り込み済みなら変わらないので、購読し直さない
  if (following.has(turnId) || useSession.getState().events[turnId]?.some((e) => e.type === 'turn.finish')) return;
  following.set(turnId, api.followTurn(turnId, receive));
}

function stopFollowingAll(): void {
  for (const stop of following.values()) stop();
  following.clear();
}

function receive(event: RunEvent): void {
  useSession.setState((s) => {
    if (event.type === 'text.delta') {
      const callId = event.callId!;
      return { liveText: { ...s.liveText, [callId]: (s.liveText[callId] ?? '') + event.text } };
    }
    const received = s.events[event.turnId] ?? [];
    // 再接続で再生し直されたイベントを重複して取り込まない
    if (event.seq! <= (received.at(-1)?.seq ?? 0)) return {};
    const next: Partial<State> = { events: { ...s.events, [event.turnId]: [...received, event] } };
    if ((event.type === 'step.finish' || event.type === 'call.finish') && event.callId) {
      next.liveText = { ...s.liveText, [event.callId]: '' };
    }
    if (event.type === 'turn.finish') {
      next.turns = s.turns.map((t) => (t.id === event.turnId ? { ...t, status: event.status, reply: event.reply } : t));
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
