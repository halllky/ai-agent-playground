import { createGraph, createSession, discardGraphChanges, dismissError, openSession, renameGraph, saveGraphs, selectGraph, useSession } from './store.ts';

/** セッションと、編集・実行に使うグラフ構成の切り替え */
export function TopBar() {
  const sessions = useSession((s) => s.sessions);
  const sessionId = useSession((s) => s.sessionId);
  const graphs = useSession((s) => s.graphs);
  const graph = useSession((s) => s.graphs.find((g) => g.id === s.graphId));
  const unsavedGraphs = useSession((s) => s.unsavedGraphs);
  const error = useSession((s) => s.error);

  return (
    <header className="flex items-center gap-2 border-b bg-surface-sub px-2.5 py-1.5">
      <label className="flex items-center gap-1">
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

      <label className="flex items-center gap-1">
        グラフ
        <select value={graph?.id ?? ''} onChange={(e) => void selectGraph(e.target.value)}>
          {graphs.map((g) => (
            <option key={g.id} value={g.id}>
              {g.id in unsavedGraphs ? `${g.name} ●` : g.name}
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
      <button title="Ctrl+S" disabled={Object.keys(unsavedGraphs).length === 0} onClick={() => void saveGraphs()}>
        保存
      </button>
      <button
        disabled={!graph || !(graph.id in unsavedGraphs)}
        onClick={() => {
          if (graph && confirm(`「${graph.name}」の未保存の変更を破棄しますか？`)) discardGraphChanges(graph.id);
        }}
      >
        変更を破棄
      </button>

      {error && (
        <div className="ml-auto max-w-[50%] cursor-pointer truncate text-danger" onClick={dismissError} title="クリックで閉じる">
          {error}
        </div>
      )}
    </header>
  );
}
