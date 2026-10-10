import type { FileEntry, GraphDefinition, GraphRecord, ModelInfo, RunEvent, SessionDetail, SessionRecord, TurnRecord } from 'protocol';

/** サーバー API の呼び出し。失敗はレスポンス本文をメッセージにした Error で投げる */
export const api = {
  graphs: () => request<GraphRecord[]>('GET', '/graphs'),
  createGraph: (name: string, definition?: GraphDefinition) => request<GraphRecord>('POST', '/graphs', { name, definition }),
  updateGraph: (id: string, patch: { name?: string; definition?: GraphDefinition }) => request<GraphRecord>('PUT', `/graphs/${id}`, patch),

  sessions: () => request<SessionRecord[]>('GET', '/sessions'),
  session: (id: string) => request<SessionDetail>('GET', `/sessions/${id}`),
  createSession: (graphId: string) => request<SessionRecord>('POST', '/sessions', { graphId }),
  updateSession: (id: string, patch: { graphId?: string; activeTurnId?: string | null }) =>
    request<SessionRecord>('PUT', `/sessions/${id}`, patch),
  createTurn: (sessionId: string, parentTurnId: string | null, userText: string) =>
    request<TurnRecord>('POST', `/sessions/${sessionId}/turns`, { parentTurnId, userText }),
  abortTurn: (turnId: string) => request<void>('POST', `/turns/${turnId}/abort`),
  turnFiles: (turnId: string) => request<FileEntry[]>('GET', `/turns/${turnId}/files`),
  fileContent: (turnId: string, file: { volume: string; path: string }) =>
    request<{ content: string }>('GET', `/turns/${turnId}/files/content?${new URLSearchParams(file)}`),

  models: () => request<ModelInfo[]>('GET', '/models'),

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
