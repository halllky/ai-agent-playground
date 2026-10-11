import { TrashIcon } from '@heroicons/react/16/solid';
import { createSession, deleteSession, discardGraphChanges, dismissError, hasUnsavedGraph, openSession, saveGraph, useSession } from './store.ts';

/** セッションの切り替え・作成・削除と、編集中のグラフの保存 */
export function TopBar() {
  const sessions = useSession((s) => s.sessions);
  const sessionId = useSession((s) => s.sessionId);
  const unsaved = useSession(hasUnsavedGraph);
  const error = useSession((s) => s.error);
  const session = sessions.find((s) => s.id === sessionId);
  const running = useSession((s) => s.turns.some((t) => t.status === 'running'));

  return (
    <header className="flex items-center gap-2 border-b bg-surface-sub px-2.5 py-1.5">
      <select className="min-w-0" value={sessionId ?? ''} onChange={(e) => void openSession(e.target.value)}>
        {sessions.map((s) => (
          <option key={s.id} value={s.id}>
            {s.id === sessionId && unsaved ? `${s.title} ●` : s.title}
          </option>
        ))}
      </select>
      <button title="今のグラフを写した新しい会話を始める" onClick={() => void createSession()}>
        新規
      </button>
      <button
        className="self-stretch px-1.5 text-danger"
        title={running ? '実行中は削除できません' : 'この会話を削除'}
        aria-label="この会話を削除"
        disabled={!session || running}
        onClick={() => {
          if (session && confirm(`会話「${session.title}」を削除しますか？\nターンとファイルもすべて消え、元に戻せません。`)) void deleteSession();
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
