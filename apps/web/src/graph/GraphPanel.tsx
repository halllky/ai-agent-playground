import { useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import { Allotment } from 'allotment';
import {
  applyEdgeChanges,
  applyNodeChanges,
  Background,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  useReactFlow,
  ReactFlowProvider,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import { diagnoseGraph, edgeKindBetween, type GraphDefinition, type GraphNode, type GraphWarning } from 'protocol';
import { updateGraphDefinition, useSession } from '../session/store.ts';
import { NumberField } from './fields.tsx';
import { edgeKindView, edgeKindViews, nodeKindView, nodeKindViews } from './kinds.tsx';

/** 編集中のグラフのキャンバスとインスペクタ */
export function GraphPanel() {
  const graph = useSession((s) => s.graphs.find((g) => g.id === s.graphId));
  const models = useSession((s) => s.models);
  const [selection, setSelection] = useState<Selection>(null);
  const warnings = useMemo(() => (graph ? diagnoseGraph(graph.definition, models) : []), [graph, models]);
  if (!graph) return <div className="panel-empty">グラフがありません</div>;

  return (
    <Allotment vertical defaultSizes={[65, 35]}>
      <Allotment.Pane minSize={120}>
        {/* グラフを切り替えたときに表示範囲を合わせ直すため、グラフごとに作り直す */}
        <ReactFlowProvider key={graph.id}>
          <Canvas definition={graph.definition} warnings={warnings} selection={selection} onSelect={setSelection} />
        </ReactFlowProvider>
      </Allotment.Pane>
      <Allotment.Pane minSize={80}>
        <Inspector definition={graph.definition} warnings={warnings} selection={selection} />
      </Allotment.Pane>
    </Allotment>
  );
}

type Selection = { nodeId: string } | { edgeId: string } | null;
type FlowNode = Node<{ node: GraphNode; warnings: string[] }, 'graphNode'>;

const nodeTypes = { graphNode: GraphNodeView };

function Canvas(props: {
  definition: GraphDefinition;
  warnings: GraphWarning[];
  selection: Selection;
  onSelect: Dispatch<SetStateAction<Selection>>;
}) {
  const { definition, warnings, selection, onSelect } = props;
  const { screenToFlowPosition } = useReactFlow();
  // 制御モードでは React Flow が測った寸法を渡し返さないとノードが表示されないため、保存対象ではないがここで保持する
  const [measured, setMeasured] = useState<Record<string, { width: number; height: number }>>({});

  const nodes = definition.nodes.map(
    (node): FlowNode => ({
      id: node.id,
      type: 'graphNode',
      position: node.position,
      measured: measured[node.id],
      selected: selection !== null && 'nodeId' in selection && selection.nodeId === node.id,
      data: { node, warnings: warningsFor(warnings, { nodeId: node.id }) },
    }),
  );
  const edges = definition.edges.map(
    (edge): Edge => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      label: edgeKindView(edge).label(edge) || undefined,
      selected: selection !== null && 'edgeId' in selection && selection.edgeId === edge.id,
      markerEnd: { type: MarkerType.ArrowClosed },
      className: warningsFor(warnings, { edgeId: edge.id }).length > 0 ? 'edge-warning' : undefined,
    }),
  );

  const addNode = (kind: GraphNode['kind']) => {
    const id = crypto.randomUUID();
    const position = screenToFlowPosition({ x: 120, y: 120 });
    updateGraphDefinition((d) => ({ ...d, nodes: [...d.nodes, nodeKindViews[kind].create(id, position)] }));
    onSelect({ nodeId: id });
  };

  return (
    <div className="graph-canvas">
      <div className="palette">
        {(Object.keys(nodeKindViews) as GraphNode['kind'][])
          .filter((kind) => nodeKindViews[kind].addable(definition))
          .map((kind) => (
            <button key={kind} onClick={() => addNode(kind)}>
              + {nodeKindViews[kind].label}
            </button>
          ))}
      </div>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        colorMode="system"
        fitView
        onNodesChange={(changes) => {
          for (const c of changes) {
            if (c.type === 'select') onSelect(selectionAfter(c.id, c.selected, (id) => ({ nodeId: id })));
            if (c.type === 'dimensions' && c.dimensions) {
              const dimensions = c.dimensions;
              setMeasured((m) => ({ ...m, [c.id]: dimensions }));
            }
          }
          const next = applyNodeChanges(changes, nodes);
          if (!changes.some((c) => c.type === 'position' || c.type === 'remove')) return;
          const ids = new Set(next.map((n) => n.id));
          updateGraphDefinition((d) => ({
            ...d,
            nodes: next.map((n) => ({ ...n.data.node, position: n.position })),
            edges: d.edges.filter((e) => ids.has(e.source) && ids.has(e.target)),
          }));
        }}
        onEdgesChange={(changes) => {
          for (const c of changes) {
            if (c.type === 'select') onSelect(selectionAfter(c.id, c.selected, (id) => ({ edgeId: id })));
          }
          const next = applyEdgeChanges(changes, edges);
          if (!changes.some((c) => c.type === 'remove')) return;
          const ids = new Set(next.map((e) => e.id));
          updateGraphDefinition((d) => ({ ...d, edges: d.edges.filter((e) => ids.has(e.id)) }));
        }}
        isValidConnection={(connection) => {
          const source = definition.nodes.find((n) => n.id === connection.source);
          const target = definition.nodes.find((n) => n.id === connection.target);
          const duplicate = definition.edges.some((e) => e.source === connection.source && e.target === connection.target);
          return !!source && !!target && !duplicate && edgeKindBetween(source, target) !== undefined;
        }}
        onConnect={(connection) => {
          updateGraphDefinition((d) => {
            const source = d.nodes.find((n) => n.id === connection.source);
            const target = d.nodes.find((n) => n.id === connection.target);
            const kind = source && target && edgeKindBetween(source, target);
            if (!kind) return d;
            return { ...d, edges: [...d.edges, edgeKindViews[kind].create(crypto.randomUUID(), connection.source, connection.target)] };
          });
        }}
      >
        <Background />
        <Controls />
      </ReactFlow>
    </div>
  );
}

/**
 * 選択変更1件を反映する更新関数。
 * ノードからエッジへ選択を移すと「ノードの選択解除」と「エッジの選択」が別々に届き順序も決まらないため、
 * 解除は現在の選択がその要素であるときだけ行う。
 */
function selectionAfter(id: string, selected: boolean, toSelection: (id: string) => NonNullable<Selection>) {
  return (current: Selection): Selection => {
    if (selected) return toSelection(id);
    const currentId = current && ('nodeId' in current ? current.nodeId : current.edgeId);
    return currentId === id ? null : current;
  };
}

function GraphNodeView({ data }: NodeProps<FlowNode>) {
  const view = nodeKindView(data.node);
  return (
    <div className={`graph-node kind-${data.node.kind}`}>
      {view.acceptsIncoming && <Handle type="target" position={Position.Top} />}
      <div className="graph-node-kind">{view.label}</div>
      <div className="graph-node-title">{view.title(data.node)}</div>
      <div className="graph-node-summary">{view.summary(data.node)}</div>
      {data.warnings.length > 0 && (
        <div className="graph-node-warning" title={data.warnings.join('\n')}>
          ⚠ {data.warnings.length}
        </div>
      )}
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}

function Inspector({ definition, warnings, selection }: { definition: GraphDefinition; warnings: GraphWarning[]; selection: Selection }) {
  const node = selection && 'nodeId' in selection ? definition.nodes.find((n) => n.id === selection.nodeId) : undefined;
  const edge = selection && 'edgeId' in selection ? definition.edges.find((e) => e.id === selection.edgeId) : undefined;

  if (node) {
    const view = nodeKindView(node);
    return (
      <div className="inspector">
        <h3>{view.label}</h3>
        <WarningList messages={warningsFor(warnings, { nodeId: node.id })} />
        <view.Inspector
          node={node}
          onChange={(changed) => updateGraphDefinition((d) => ({ ...d, nodes: d.nodes.map((n) => (n.id === changed.id ? changed : n)) }))}
        />
      </div>
    );
  }
  if (edge) {
    const view = edgeKindView(edge);
    return (
      <div className="inspector">
        <h3>エッジ</h3>
        <WarningList messages={warningsFor(warnings, { edgeId: edge.id })} />
        <view.Inspector
          edge={edge}
          target={definition.nodes.find((n) => n.id === edge.target)}
          onChange={(changed) => updateGraphDefinition((d) => ({ ...d, edges: d.edges.map((e) => (e.id === changed.id ? changed : e)) }))}
        />
      </div>
    );
  }
  return (
    <div className="inspector">
      <h3>グラフ設定</h3>
      <WarningList messages={warnings.filter((w) => 'graph' in w.target).map((w) => w.message)} />
      <NumberField
        label="呼び出しネストの上限"
        min={1}
        value={definition.settings.maxCallDepth}
        onChange={(maxCallDepth) => updateGraphDefinition((d) => ({ ...d, settings: { ...d.settings, maxCallDepth } }))}
      />
      <p className="hint">ノードやエッジを選ぶと設定を編集できます。Delete / Backspace で削除。</p>
    </div>
  );
}

function WarningList({ messages }: { messages: string[] }) {
  if (messages.length === 0) return null;
  return (
    <ul className="warnings">
      {messages.map((m) => (
        <li key={m}>⚠ {m}</li>
      ))}
    </ul>
  );
}

function warningsFor(warnings: GraphWarning[], target: { nodeId: string } | { edgeId: string }): string[] {
  return warnings
    .filter((w) =>
      'nodeId' in target ? 'nodeId' in w.target && w.target.nodeId === target.nodeId : 'edgeId' in w.target && w.target.edgeId === target.edgeId,
    )
    .map((w) => w.message);
}
