import type { Dispatch, SetStateAction } from 'react';
import { removeEdges, removeNodes, type GraphDefinition, type GraphWarning } from 'protocol';
import { updateGraph } from '../session/store.ts';
import { Hint, NumberField } from './fields.tsx';
import type { Selection } from './GraphPanel.tsx';
import { edgeKindView, nodeKindView } from './kinds/index.ts';

/** 選択中の要素の設定。読み取り専用なら入力欄を無効にして表示だけする */
export function Inspector(props: {
  definition: GraphDefinition;
  warningsOf: (target: GraphWarning['target']) => string[];
  readOnly: boolean;
  selection: Selection;
  onSelect: Dispatch<SetStateAction<Selection>>;
}) {
  const { definition, warningsOf, readOnly, selection, onSelect } = props;
  const node = selection && 'nodeId' in selection ? definition.nodes.find((n) => n.id === selection.nodeId) : undefined;
  const edge = selection && 'edgeId' in selection ? definition.edges.find((e) => e.id === selection.edgeId) : undefined;

  if (node) {
    const view = nodeKindView(node);
    return (
      <fieldset className={inspector} disabled={readOnly}>
        <InspectorHeader
          title={view.label}
          onDelete={
            node.kind === 'user'
              ? undefined
              : () => {
                  updateGraph((d) => removeNodes(d, [node.id]));
                  onSelect(null);
                }
          }
        />
        <WarningList messages={warningsOf({ nodeId: node.id })} />
        <view.Inspector
          node={node}
          onChange={(changed) => updateGraph((d) => ({ ...d, nodes: d.nodes.map((n) => (n.id === changed.id ? changed : n)) }))}
        />
      </fieldset>
    );
  }
  if (edge) {
    const view = edgeKindView(edge);
    return (
      <fieldset className={inspector} disabled={readOnly}>
        <InspectorHeader
          title="エッジ"
          onDelete={() => {
            updateGraph((d) => removeEdges(d, [edge.id]));
            onSelect(null);
          }}
        />
        <WarningList messages={warningsOf({ edgeId: edge.id })} />
        <view.Inspector
          edge={edge}
          source={definition.nodes.find((n) => n.id === edge.source)}
          target={definition.nodes.find((n) => n.id === edge.target)}
          onChange={(changed) => updateGraph((d) => ({ ...d, edges: d.edges.map((e) => (e.id === changed.id ? changed : e)) }))}
        />
      </fieldset>
    );
  }
  return (
    <fieldset className={inspector} disabled={readOnly}>
      <h3 className="mb-2 font-bold">グラフ設定</h3>
      <WarningList messages={warningsOf({ graph: true })} />
      <NumberField
        label="呼び出しネストの上限"
        min={1}
        value={definition.settings.maxCallDepth}
        onChange={(maxCallDepth) => updateGraph((d) => ({ ...d, settings: { ...d.settings, maxCallDepth } }))}
      />
      <Hint>ノードやエッジを選ぶと設定の編集や削除ができます。選んで Delete / Backspace キーでも削除できます。</Hint>
    </fieldset>
  );
}

const inspector = 'h-full min-w-0 overflow-y-auto border-t px-3 py-2';

/** 選択中の要素の見出し。onDelete が無ければ削除できない要素として削除ボタンを出さない */
function InspectorHeader({ title, onDelete }: { title: string; onDelete?: () => void }) {
  return (
    <div className="mb-2 flex items-center justify-between">
      <h3 className="font-bold">{title}</h3>
      {onDelete && (
        <button className="border-danger text-danger" onClick={onDelete}>
          削除
        </button>
      )}
    </div>
  );
}

function WarningList({ messages }: { messages: string[] }) {
  if (messages.length === 0) return null;
  return (
    <ul className="mb-2 text-warn">
      {messages.map((m) => (
        <li key={m}>⚠ {m}</li>
      ))}
    </ul>
  );
}
