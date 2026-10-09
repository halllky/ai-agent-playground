import { Allotment } from 'allotment';
import { ChatPanel } from './chat/ChatPanel.tsx';
import { FilePanel } from './files/FilePanel.tsx';
import { GraphPanel } from './graph/GraphPanel.tsx';
import { LogPanel } from './log/LogPanel.tsx';
import { TopBar } from './session/TopBar.tsx';

export function App() {
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
