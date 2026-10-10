import { PencilIcon, TrashIcon } from '@heroicons/react/16/solid';
import { createGraph, deleteGraph, discardGraphChanges, dismissError, renameGraph, saveGraphs, selectGraph, useSession } from './store.ts';

/** 編集・実行に使うグラフ構成の切り替えと、グラフそのものの操作 */
export function TopBar() {
  const graphs = useSession((s) => s.graphs);
  const graph = useSession((s) => s.graphs.find((g) => g.id === s.graphId));
  const sessions = useSession((s) => s.sessions);
  const unsavedGraphs = useSession((s) => s.unsavedGraphs);
  const error = useSession((s) => s.error);

  const confirmDelete = () => {
    if (!graph) return;
    const sessionCount = sessions.filter((s) => s.graphId === graph.id).length;
    const sessionNote = sessionCount > 0 ? `\nこのグラフを使うセッション ${sessionCount} 件も削除されます。` : '';
    if (confirm(`「${graph.name}」を削除しますか？${sessionNote}`)) void deleteGraph(graph.id);
  };

  return (
    <header className="flex items-center gap-2 border-b bg-surface-sub px-2.5 py-1.5">
      <select value={graph?.id ?? ''} onChange={(e) => void selectGraph(e.target.value)}>
        {graphs.map((g) => (
          <option key={g.id} value={g.id}>
            {g.id in unsavedGraphs ? `${g.name} ●` : g.name}
          </option>
        ))}
      </select>
      <button
        className="self-stretch px-1.5"
        title="名前を変更"
        aria-label="名前を変更"
        disabled={!graph}
        onClick={() => {
          const name = graph && prompt('グラフの名前', graph.name);
          if (graph && name) void renameGraph(graph.id, name);
        }}
      >
        <PencilIcon className="size-3.5" />
      </button>
      {/* グラフが1つも無い状態にはしない */}
      <button
        className="self-stretch px-1.5 text-danger"
        title="削除"
        disabled={!graph || graphs.length < 2}
        onClick={confirmDelete}
      >
        <TrashIcon className="size-3.5" />
      </button>
      <div className="basis-2"></div>
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
        onClick={() => {
          const name = prompt('新しいグラフの名前');
          if (name) void createGraph(name);
        }}
      >
        新規
      </button>
      <div className="flex-1"></div>
      <button
        disabled={!graph || !(graph.id in unsavedGraphs)}
        onClick={() => {
          if (graph && confirm(`「${graph.name}」の未保存の変更を破棄しますか？`)) discardGraphChanges(graph.id);
        }}
      >
        変更を破棄
      </button>
      <button title="Ctrl+S" disabled={Object.keys(unsavedGraphs).length === 0} onClick={() => void saveGraphs()}>
        保存
      </button>

      {error && (
        <div className="ml-auto max-w-[50%] cursor-pointer truncate text-danger" onClick={dismissError} title="クリックで閉じる">
          {error}
        </div>
      )}
    </header>
  );
}
