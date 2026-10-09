import { createGraph, createSession, dismissError, openSession, renameGraph, selectGraph, useSession } from './store.ts';

/** セッションと、編集・実行に使うグラフ構成の切り替え */
export function TopBar() {
  const sessions = useSession((s) => s.sessions);
  const sessionId = useSession((s) => s.sessionId);
  const graphs = useSession((s) => s.graphs);
  const graph = useSession((s) => s.graphs.find((g) => g.id === s.graphId));
  const error = useSession((s) => s.error);

  return (
    <header className="topbar">
      <label>
        セッション
        <select value={sessionId ?? ''} onChange={(e) => void openSession(e.target.value || null)}>
          <option value="">（新しい会話）</option>
          {sessions.map((s) => (
            <option key={s.id} value={s.id}>
              {s.title}
            </option>
          ))}
        </select>
      </label>
      <button onClick={() => void createSession()}>新規セッション</button>

      <label>
        グラフ
        <select value={graph?.id ?? ''} onChange={(e) => void selectGraph(e.target.value)}>
          {graphs.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
      </label>
      <button
        onClick={() => {
          const name = prompt('新しいグラフの名前');
          if (name) void createGraph(name);
        }}
      >
        新規
      </button>
      <button
        disabled={!graph}
        onClick={() => {
          const name = graph && prompt('複製先の名前', `${graph.name} のコピー`);
          if (graph && name) void createGraph(name, graph.definition);
        }}
      >
        複製
      </button>
      <button
        disabled={!graph}
        onClick={() => {
          const name = graph && prompt('グラフの名前', graph.name);
          if (graph && name) void renameGraph(graph.id, name);
        }}
      >
        名前変更
      </button>

      {error && (
        <div className="topbar-error" onClick={dismissError} title="クリックで閉じる">
          {error}
        </div>
      )}
    </header>
  );
}
