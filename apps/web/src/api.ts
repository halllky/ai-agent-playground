import type { GraphDefinition, ModelInfo, ModelProvider, RunEvent, SessionDetail, SessionRecord, TurnFiles, TurnRecord } from 'protocol';

/** サーバー API の呼び出し。失敗はレスポンス本文をメッセージにした Error で投げる */
export const api = {
  sessions: () => request<SessionRecord[]>('GET', '/sessions'),
  session: (id: string) => request<SessionDetail>('GET', `/sessions/${id}`),
  /** copyFrom のセッションのグラフを写した新しいセッションを作る。省略すると既定のグラフ */
  createSession: (copyFrom?: string) => request<SessionRecord>('POST', '/sessions', { copyFrom }),
  updateSession: (id: string, patch: { graph?: GraphDefinition; activeTurnId?: string | null }) =>
    request<SessionRecord>('PUT', `/sessions/${id}`, patch),
  /** セッションを会話ごと消す */
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
