import { useEffect } from 'react';
import { Allotment, LayoutPriority } from 'allotment';
import { ChatPanel } from './chat/ChatPanel.tsx';
import { GraphBar } from './graph/GraphBar.tsx';
import { GraphPanel } from './graph/GraphPanel.tsx';
import { dismissError, hasUnsavedGraph, saveGraph, useStore } from './store.ts';

/** 画面全体のレイアウト */
export function App() {
  useGraphSaveShortcuts();
  return (
    <div className="flex h-full flex-col">
      <GraphBar />
      <ErrorBar />
      <div className="min-h-0 flex-1">
        <Allotment proportionalLayout={false}>
          <Allotment.Pane minSize={200}>
            <GraphPanel />
          </Allotment.Pane>
          <Allotment.Pane minSize={200} priority={LayoutPriority.Low}>
            <ChatPanel />
          </Allotment.Pane>
        </Allotment>
      </div>
    </div>
  );
}

/** サーバーとの通信の失敗など、画面全体のエラー */
function ErrorBar() {
  const error = useStore((s) => s.error);
  if (!error) return null;
  return (
    <div className="cursor-pointer truncate border-b px-2.5 py-1 text-danger" onClick={dismissError} title="クリックで閉じる">
      {error}
    </div>
  );
}

/** Ctrl+S（Mac では Cmd+S）でのグラフの保存と、未保存の変更があるときの離脱確認 */
function useGraphSaveShortcuts(): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 's') return;
      e.preventDefault();
      void saveGraph();
    };
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (hasUnsavedGraph(useStore.getState())) e.preventDefault();
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
  }, []);
}
