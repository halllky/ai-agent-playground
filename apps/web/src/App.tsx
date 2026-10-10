import { useEffect } from 'react';
import { Allotment } from 'allotment';
import { ChatPanel } from './chat/ChatPanel.tsx';
import { FilePanel } from './files/FilePanel.tsx';
import { GraphPanel } from './graph/GraphPanel.tsx';
import { LogPanel } from './log/LogPanel.tsx';
import { saveGraphs, useSession } from './session/store.ts';
import { TopBar } from './session/TopBar.tsx';

/** 画面全体のレイアウト */
export function App() {
  useGraphSaveShortcuts();
  return (
    <div className="app">
      <TopBar />
      <div className="workspace">
        <Allotment vertical defaultSizes={[70, 30]}>
          <Allotment.Pane minSize={200}>
            <Allotment defaultSizes={[40, 40, 20]}>
              <Allotment.Pane minSize={200}>
                <GraphPanel />
              </Allotment.Pane>
              <Allotment.Pane minSize={260}>
                <ChatPanel />
              </Allotment.Pane>
              <Allotment.Pane minSize={140}>
                <FilePanel />
              </Allotment.Pane>
            </Allotment>
          </Allotment.Pane>
          <Allotment.Pane minSize={80}>
            <LogPanel />
          </Allotment.Pane>
        </Allotment>
      </div>
    </div>
  );
}

/** Ctrl+S（Mac では Cmd+S）でのグラフの保存と、未保存の変更があるときの離脱確認 */
function useGraphSaveShortcuts(): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 's') return;
      e.preventDefault();
      void saveGraphs();
    };
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (Object.keys(useSession.getState().unsavedGraphs).length > 0) e.preventDefault();
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
  }, []);
}
