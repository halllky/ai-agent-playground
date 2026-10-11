import { useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import { LockClosedIcon, LockOpenIcon } from '@heroicons/react/16/solid';
import { Allotment } from 'allotment';
import {
  Background,
  ControlButton,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  useReactFlow,
  ReactFlowProvider,
  type Connection,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import {
  canConnect,
  createEdge,
  createNode,
  diagnoseGraph,
  nodeRoles,
  removeEdges,
  removeNodes,
  type EdgeKind,
  type GraphDefinition,
  type GraphNode,
  type GraphWarning,
  type NodeKind,
  type TurnRecord,
} from 'protocol';
import { loadTurnGraph, showTurnGraph, updateGraph, useSession } from '../session/store.ts';
import { EmptyNote } from '../ui/primitives.tsx';
import { Hint, NumberField } from './fields.tsx';
import { addableNodeKinds, edgeKindView, nodeKindView, nodeKindViews, nodeName } from './kinds.tsx';

/**
 * 編集中のグラフのキャンバスとインスペクタ。
 * ターンの実行時のグラフを表示しているときは、読み取り専用で表示する。
 */
export function GraphPanel() {
  const graph = useSession((s) => s.graph);
  const sessionId = useSession((s) => s.sessionId);
  const viewingTurn = useSession((s) => s.turns.find((t) => t.id === s.viewingTurnId));
  const models = useSession((s) => s.models);
  const [selection, setSelection] = useState<Selection>(null);
  const definition = viewingTurn?.graph ?? graph;
  const warnings = useMemo(() => (definition ? diagnoseGraph(definition, models) : []), [definition, models]);
  if (!definition) return <EmptyNote>グラフがありません</EmptyNote>;

  const readOnly = viewingTurn !== undefined;
  return (
    <div className="flex h-full flex-col">
      {viewingTurn && <TurnGraphBanner turn={viewingTurn} />}
      <div className="min-h-0 flex-1">
        <Allotment vertical defaultSizes={[65, 35]}>
          <Allotment.Pane minSize={120}>
            {/* 表示するグラフを切り替えたときに表示範囲を合わせ直すため、グラフごとに作り直す */}
            <ReactFlowProvider key={viewingTurn?.id ?? sessionId}>
              <Canvas definition={definition} warnings={warnings} readOnly={readOnly} selection={selection} onSelect={setSelection} />
            </ReactFlowProvider>
          </Allotment.Pane>
          <Allotment.Pane minSize={80}>
            <Inspector definition={definition} warnings={warnings} readOnly={readOnly} selection={selection} onSelect={setSelection} />
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
      <button title="保存するまではセッションに反映しません" onClick={() => loadTurnGraph(turn)}>
        このグラフを編集する
      </button>
      <button onClick={() => showTurnGraph(null)}>現在のグラフに戻る</button>
    </div>
  );
}

type Selection = { nodeId: string } | { edgeId: string } | null;
type FlowNode = Node<{ node: GraphNode; warnings: string[] }, 'graphNode'>;

const nodeTypes = { graphNode: GraphNodeView };
// React Flow の既定では Backspace でしか消えず、Delete キーが効かないため両方を割り当てる
const deleteKeys = ['Delete', 'Backspace'];

function Canvas(props: {
  definition: GraphDefinition;
  warnings: GraphWarning[];
  readOnly: boolean;
  selection: Selection;
  onSelect: Dispatch<SetStateAction<Selection>>;
}) {
  const { definition, warnings, readOnly, selection, onSelect } = props;
  const { screenToFlowPosition } = useReactFlow();
  // 制御モードでは React Flow が測った寸法を渡し返さないとノードが表示されないため、保存対象ではないがここで保持する
  const [measured, setMeasured] = useState<Record<string, { width: number; height: number }>>({});
  const [locked, setLocked] = useState(false);
  const editable = !readOnly && !locked;

  const nodes = definition.nodes.map(
    (node): FlowNode => ({
      id: node.id,
      type: 'graphNode',
      position: node.position,
      measured: measured[node.id],
      deletable: node.kind !== 'user',
      selected: selection !== null && 'nodeId' in selection && selection.nodeId === node.id,
      data: { node, warnings: warningsFor(warnings, { nodeId: node.id }) },
    }),
  );
  const edges = definition.edges.map((edge): Edge => {
    return {
      id: edge.id,
      source: edge.source,
      target: edge.target,
      sourceHandle: edge.kind,
      targetHandle: edge.kind,
      label: edgeKindView(edge).label(edge, definition.nodes.find((n) => n.id === edge.target)) || undefined,
      selected: selection !== null && 'edgeId' in selection && selection.edgeId === edge.id,
      markerEnd: { type: MarkerType.ArrowClosed },
      // React Flow が選択中などに付ける線の色より、警告の色を優先する
      className: warningsFor(warnings, { edgeId: edge.id }).length > 0 ? '[&_path]:stroke-warn!' : edge.kind === 'flow' ? '[&_path]:stroke-accent' : undefined,
    };
  });

  const addNode = (kind: NodeKind) => {
    const id = crypto.randomUUID();
    const position = screenToFlowPosition({ x: 120, y: 120 });
    updateGraph((d) => ({ ...d, nodes: [...d.nodes, createNode(kind, id, position)] }));
    onSelect({ nodeId: id });
  };

  return (
    <div className="relative h-full">
      {!readOnly && (
        // 折り返すために横幅いっぱいに広げるが、ボタンの無い所ではキャンバスを操作できるようにする
        <div className="pointer-events-none absolute top-2 right-2 left-2 z-5 flex flex-wrap gap-1.5 *:pointer-events-auto">
          {addableNodeKinds(definition).map((kind) => (
            <button key={kind} onClick={() => addNode(kind)}>
              + {nodeKindViews[kind].label}
            </button>
          ))}
        </div>
      )}
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        colorMode="system"
        fitView
        nodesDraggable={editable}
        nodesConnectable={editable}
        deleteKeyCode={editable ? deleteKeys : null}
        onNodesChange={(changes) => {
          for (const c of changes) {
            if (c.type === 'select') onSelect(selectionAfter(c.id, c.selected, (id) => ({ nodeId: id })));
            if (c.type === 'dimensions' && c.dimensions) {
              const dimensions = c.dimensions;
              setMeasured((m) => ({ ...m, [c.id]: dimensions }));
            }
          }
          const positions = new Map(changes.flatMap((c) => (c.type === 'position' && c.position ? [[c.id, c.position] as const] : [])));
          if (positions.size > 0) {
            updateGraph((d) => ({ ...d, nodes: d.nodes.map((n) => ({ ...n, position: positions.get(n.id) ?? n.position })) }));
          }
          const removed = changes.flatMap((c) => (c.type === 'remove' ? [c.id] : []));
          if (removed.length > 0) updateGraph((d) => removeNodes(d, removed));
        }}
        onEdgesChange={(changes) => {
          for (const c of changes) {
            if (c.type === 'select') onSelect(selectionAfter(c.id, c.selected, (id) => ({ edgeId: id })));
          }
          const removed = changes.flatMap((c) => (c.type === 'remove' ? [c.id] : []));
          if (removed.length > 0) updateGraph((d) => removeEdges(d, removed));
        }}
        isValidConnection={(connection) => connectionKind(definition, connection) !== undefined}
        onConnect={(connection) => {
          updateGraph((d) => {
            const kind = connectionKind(d, connection);
            if (!kind) return d;
            return { ...d, edges: [...d.edges, createEdge(kind, crypto.randomUUID(), connection.source, connection.target)] };
          });
        }}
      >
        <Background />
        {/* 標準のロックは要素の選択までできなくするため、移動・接続・キーでの削除だけを止める自前のロックに置き換える */}
        <Controls showInteractive={false}>
          {!readOnly && (
            <ControlButton title={locked ? 'ロックを解除' : 'ロック'} aria-label={locked ? 'ロックを解除' : 'ロック'} onClick={() => setLocked((l) => !l)}>
              {locked ? <LockClosedIcon /> : <LockOpenIcon />}
            </ControlButton>
          )}
        </Controls>
      </ReactFlow>
    </div>
  );
}

/**
 * 接続口どうしをつないだときにできるエッジの種類。つなげない、または同じ種類のエッジが既にあれば undefined。
 * 接続口の id はエッジの種類で、種類の違う接続口どうしはつなげない
 */
function connectionKind(definition: GraphDefinition, connection: Connection | Edge): EdgeKind | undefined {
  const kind: EdgeKind = connection.sourceHandle === 'flow' ? 'flow' : 'tool';
  if (connection.targetHandle !== kind) return undefined;
  const source = definition.nodes.find((n) => n.id === connection.source);
  const target = definition.nodes.find((n) => n.id === connection.target);
  if (!source || !target || !canConnect(source, target, kind)) return undefined;
  const duplicate = definition.edges.some((e) => e.source === connection.source && e.target === connection.target && e.kind === kind);
  return duplicate ? undefined : kind;
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

function GraphNodeView({ data, selected }: NodeProps<FlowNode>) {
  const view = nodeKindView(data.node);
  const roles = nodeRoles[data.node.kind];
  return (
    <div
      className={`min-w-[150px] rounded-md bg-surface px-2.5 py-2 ${data.node.kind === 'user' ? 'border-2' : 'border'} ${
        selected ? 'border-accent ring-1 ring-accent' : ''
      }`}
    >
      {roles.isTool && <Handle id="tool" type="target" position={Position.Top} />}
      {roles.inFlow && <Handle id="flow" type="target" position={Position.Left} className={flowHandle} />}
      <div className="text-2xs text-muted">{view.label}</div>
      <div className="font-semibold">{nodeName(data.node)}</div>
      <div className="max-w-[200px] truncate text-xs text-muted">{view.summary(data.node)}</div>
      {data.warnings.length > 0 && (
        <div className="mt-1 text-xs text-warn" title={data.warnings.join('\n')}>
          ⚠ {data.warnings.length}
        </div>
      )}
      {roles.usesTools && <Handle id="tool" type="source" position={Position.Bottom} />}
      {roles.inFlow && <Handle id="flow" type="source" position={Position.Right} className={flowHandle} />}
    </div>
  );
}

/** フローの接続口。道具の接続口と見分けられるよう色を付ける */
const flowHandle = 'bg-accent!';

/** 選択中の要素の設定。読み取り専用なら入力欄を無効にして表示だけする */
function Inspector(props: {
  definition: GraphDefinition;
  warnings: GraphWarning[];
  readOnly: boolean;
  selection: Selection;
  onSelect: Dispatch<SetStateAction<Selection>>;
}) {
  const { definition, warnings, readOnly, selection, onSelect } = props;
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
        <WarningList messages={warningsFor(warnings, { nodeId: node.id })} />
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
        <WarningList messages={warningsFor(warnings, { edgeId: edge.id })} />
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
      <WarningList messages={warningsFor(warnings, { graph: true })} />
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

function warningsFor(warnings: GraphWarning[], target: GraphWarning['target']): string[] {
  const key = targetKey(target);
  return warnings.filter((w) => targetKey(w.target) === key).map((w) => w.message);
}

function targetKey(target: GraphWarning['target']): string {
  if ('nodeId' in target) return `node:${target.nodeId}`;
  if ('edgeId' in target) return `edge:${target.edgeId}`;
  return 'graph';
}
