import { PlusIcon, TrashIcon } from '@heroicons/react/16/solid';
import { createSession, deleteSession, openSession, useStore } from '../store.ts';

/** 開いているグラフの会話の切り替え・作成・削除 */
export function SessionBar() {
  const sessions = useStore((s) => s.sessions);
  const sessionId = useStore((s) => s.sessionId);
  const session = sessions.find((s) => s.id === sessionId);
  const running = useStore((s) => s.turns.some((t) => t.status === 'running'));

  return (
    <div className="flex items-center gap-2 border-b px-2 py-1">
      <select className="min-w-0" value={sessionId ?? ''} onChange={(e) => void openSession(e.target.value)}>
        {sessions.map((s) => (
          <option key={s.id} value={s.id}>
            {s.title}
          </option>
        ))}
      </select>
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
      <div className="basis-2"></div>
      <button
        title="新規"
        className="self-stretch px-1.5"
        onClick={() => void createSession()}
      >
        <PlusIcon className="size-3.5" />
      </button>
    </div>
  );
}
