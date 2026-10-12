import type { GraphDefinition, GraphRecord, ModelInfo, ModelProvider, RunEvent, SessionDetail, SessionRecord, TurnFiles, TurnRecord } from 'protocol';

/** サーバー API の呼び出し。失敗はレスポンス本文をメッセージにした Error で投げる */
export const api = {
  graphs: () => request<GraphRecord[]>('GET', '/graphs'),
  /** copyFrom のグラフを複製した新しいグラフを作る。省略すると既定の構成 */
  createGraph: (copyFrom?: string) => request<GraphRecord>('POST', '/graphs', { copyFrom }),
  updateGraph: (id: string, patch: { name?: string; definition?: GraphDefinition }) => request<GraphRecord>('PUT', `/graphs/${id}`, patch),
  /** グラフを会話ごと消す */
  deleteGraph: (id: string) => request<void>('DELETE', `/graphs/${id}`),

  graphSessions: (graphId: string) => request<SessionRecord[]>('GET', `/graphs/${graphId}/sessions`),
  /** グラフに属する空の会話を作る */
  createSession: (graphId: string) => request<SessionRecord>('POST', `/graphs/${graphId}/sessions`),
  session: (id: string) => request<SessionDetail>('GET', `/sessions/${id}`),
  updateSession: (id: string, patch: { activeTurnId: string | null }) => request<SessionRecord>('PUT', `/sessions/${id}`, patch),
  deleteSession: (id: string) => request<void>('DELETE', `/sessions/${id}`),
  createTurn: (sessionId: string, parentTurnId: string | null, userText: string) =>
    request<TurnRecord>('POST', `/sessions/${sessionId}/turns`, { parentTurnId, userText }),
  abortTurn: (turnId: string) => request<void>('POST', `/turns/${turnId}/abort`),
  turnFiles: (turnId: string) => request<TurnFiles>('GET', `/turns/${turnId}/files`),

  models: (provider: ModelProvider) => request<ModelInfo[]>('GET', `/models/${provider}`),

  /** ターンのイベントを保存済みのものから購読する。ターンが終わると自動で閉じる */
  followTurn(turnId: string, onEvent: (event: RunEvent) => void): () => void {
    const source = new EventSource(`/api/turns/${turnId}/events`);
    source.onmessage = (message) => {
      const event = JSON.parse(message.data) as RunEvent;
      onEvent(event);
      // サーバーが接続を閉じると EventSource は再接続して最初から再生し直すため、終了を受けたらこちらから閉じる
      if (event.type === 'turn.finish') source.close();
    };
    return () => source.close();
  },
};

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${await res.text()}`);
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}
