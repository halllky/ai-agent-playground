import { TrashIcon } from '@heroicons/react/16/solid';
import { createGraph, deleteGraph, discardGraphChanges, dismissError, hasUnsavedGraph, openGraph, renameGraph, saveGraph, useSession } from './store.ts';

/** グラフの切り替え・作成・名前変更・削除と、編集中のグラフの保存 */
export function TopBar() {
  const graphs = useSession((s) => s.graphs);
  const graphId = useSession((s) => s.graphId);
  const unsaved = useSession(hasUnsavedGraph);
  const error = useSession((s) => s.error);
  const graph = graphs.find((g) => g.id === graphId);
  const running = useSession((s) => s.turns.some((t) => t.status === 'running'));

  return (
    <header className="flex items-center gap-2 border-b bg-surface-sub px-2.5 py-1.5">
      <select className="min-w-0" value={graphId ?? ''} onChange={(e) => void openGraph(e.target.value)}>
        {graphs.map((g) => (
          <option key={g.id} value={g.id}>
            {g.id === graphId && unsaved ? `${g.name} ●` : g.name}
          </option>
        ))}
      </select>
      <button title="今のグラフを複製した新しいグラフを作る" onClick={() => void createGraph()}>
        新規
      </button>
      <button
        disabled={!graph}
        onClick={() => {
          const name = graph && prompt('グラフの名前', graph.name)?.trim();
          if (name && name !== graph.name) void renameGraph(name);
        }}
      >
        名前変更
      </button>
      <button
        className="self-stretch px-1.5 text-danger"
        title={running ? '実行中は削除できません' : 'このグラフを削除'}
        aria-label="このグラフを削除"
        disabled={!graph || running}
        onClick={() => {
          if (graph && confirm(`グラフ「${graph.name}」を削除しますか？\nこのグラフの会話・ターン・ファイルもすべて消え、元に戻せません。`)) void deleteGraph();
        }}
      >
        <TrashIcon className="size-3.5" />
      </button>
      <div className="flex-1"></div>
      <button
        disabled={!unsaved}
        onClick={() => {
          if (confirm('グラフの未保存の変更を破棄しますか？')) discardGraphChanges();
        }}
      >
        変更を破棄
      </button>
      <button title="Ctrl+S" disabled={!unsaved} onClick={() => void saveGraph()}>
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
