import { useMemo, useState } from 'react';
import { Allotment } from 'allotment';
import { ReactFlowProvider } from '@xyflow/react';
import { diagnoseGraph, type GraphWarning, type TurnRecord } from 'protocol';
import { showTurnGraph, useSession } from '../session/store.ts';
import { EmptyNote } from '../ui/primitives.tsx';
import { Canvas } from './Canvas.tsx';
import { Inspector } from './Inspector.tsx';

/** キャンバスとインスペクタで共有する、選択中の要素 */
export type Selection = { nodeId: string } | { edgeId: string } | null;

/**
 * 編集中のグラフのキャンバスとインスペクタ。
 * ターンの実行時のグラフを表示しているときは、そのログを読み取り専用で表示する。
 */
export function GraphPanel() {
  const graph = useSession((s) => s.graph);
  const graphId = useSession((s) => s.graphId);
  const viewingTurn = useSession((s) => s.turns.find((t) => t.id === s.viewingTurnId));
  const models = useSession((s) => s.models);
  const [selection, setSelection] = useState<Selection>(null);
  const definition = viewingTurn?.graph ?? graph;
  const warningsOf = useMemo(() => warningLookup(definition ? diagnoseGraph(definition, models) : []), [definition, models]);
  if (!definition) return <EmptyNote>グラフがありません</EmptyNote>;

  const readOnly = viewingTurn !== undefined;
  return (
    <div className="flex h-full flex-col">
      {viewingTurn && <TurnGraphBanner turn={viewingTurn} />}
      <div className="min-h-0 flex-1">
        <Allotment vertical defaultSizes={[65, 35]}>
          <Allotment.Pane minSize={120}>
            {/* 表示するグラフを切り替えたときに表示範囲を合わせ直すため、グラフごとに作り直す */}
            <ReactFlowProvider key={viewingTurn?.id ?? graphId}>
              <Canvas definition={definition} warningsOf={warningsOf} readOnly={readOnly} selection={selection} onSelect={setSelection} />
            </ReactFlowProvider>
          </Allotment.Pane>
          <Allotment.Pane minSize={80}>
            <Inspector definition={definition} warningsOf={warningsOf} readOnly={readOnly} selection={selection} onSelect={setSelection} />
          </Allotment.Pane>
        </Allotment>
      </div>
    </div>
  );
}

function TurnGraphBanner({ turn }: { turn: TurnRecord }) {
  return (
    <div className="flex items-center gap-1.5 border-b bg-highlight px-2 py-1">
      <span className="min-w-0 flex-1 truncate" title={turn.userText}>
        「{turn.userText}」の実行時のグラフ（読み取り専用）
      </span>
      <button onClick={() => showTurnGraph(null)}>現在のグラフに戻る</button>
    </div>
  );
}

/** 警告を、どの要素についてのものかで引けるようにする */
function warningLookup(warnings: GraphWarning[]): (target: GraphWarning['target']) => string[] {
  return (target) => {
    const key = targetKey(target);
    return warnings.filter((w) => targetKey(w.target) === key).map((w) => w.message);
  };
}

function targetKey(target: GraphWarning['target']): string {
  if ('nodeId' in target) return `node:${target.nodeId}`;
  if ('edgeId' in target) return `edge:${target.edgeId}`;
  return 'graph';
}
