import { useState, type Dispatch, type SetStateAction } from 'react';
import { LockClosedIcon, LockOpenIcon } from '@heroicons/react/16/solid';
import {
  Background,
  ControlButton,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  useReactFlow,
  type Connection,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import {
  canConnect,
  createEdge,
  createNode,
  nodeRoles,
  removeEdges,
  removeNodes,
  type EdgeKind,
  type GraphDefinition,
  type GraphNode,
  type GraphWarning,
  type NodeKind,
} from 'protocol';
import { updateGraph } from '../session/store.ts';
import type { Selection } from './GraphPanel.tsx';
import { addableNodeKinds, edgeKindView, nodeKindView, nodeKindViews, nodeName } from './kinds/index.ts';

/** グラフのノード・エッジを描き、追加・接続・移動・削除を受け付けるキャンバス */
export function Canvas(props: {
  definition: GraphDefinition;
  warningsOf: (target: GraphWarning['target']) => string[];
  readOnly: boolean;
  selection: Selection;
  onSelect: Dispatch<SetStateAction<Selection>>;
}) {
  const { definition, warningsOf, readOnly, selection, onSelect } = props;
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
      deletable: !nodeKindView(node).fixed,
      selected: selection !== null && 'nodeId' in selection && selection.nodeId === node.id,
      data: { node, warnings: warningsOf({ nodeId: node.id }) },
    }),
  );
  const edges = definition.edges.map((edge): Edge => {
    const view = edgeKindView(edge);
    const ends = { source: definition.nodes.find((n) => n.id === edge.source), target: definition.nodes.find((n) => n.id === edge.target) };
    return {
      id: edge.id,
      source: edge.source,
      target: edge.target,
      sourceHandle: edge.kind,
      targetHandle: edge.kind,
      label: view.label(edge, ends) || undefined,
      selected: selection !== null && 'edgeId' in selection && selection.edgeId === edge.id,
      markerEnd: { type: MarkerType.ArrowClosed },
      // React Flow が選択中などに付ける線の色より、警告の色を優先する
      className: warningsOf({ edgeId: edge.id }).length > 0 ? '[&_path]:stroke-warn!' : edge.kind === 'flow' ? '[&_path]:stroke-accent' : undefined,
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

type FlowNode = Node<{ node: GraphNode; warnings: string[] }, 'graphNode'>;

const nodeTypes = { graphNode: GraphNodeView };
// React Flow の既定では Backspace でしか消えず、Delete キーが効かないため両方を割り当てる
const deleteKeys = ['Delete', 'Backspace'];

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
      className={`min-w-[150px] rounded-md bg-surface px-2.5 py-2 ${view.fixed ? 'border-2' : 'border'} ${
        selected ? 'border-accent ring-1 ring-accent' : ''
      }`}
    >
      {roles.isTool && <Handle id="tool" type="target" position={Position.Top} />}
      {roles.receivesFlow && <Handle id="flow" type="target" position={Position.Left} className={flowHandle} />}
      <div className="text-2xs text-muted">{view.label}</div>
      <div className="font-semibold">{nodeName(data.node)}</div>
      <div className="max-w-[200px] truncate text-xs text-muted">{view.summary(data.node)}</div>
      {data.warnings.length > 0 && (
        <div className="mt-1 text-xs text-warn" title={data.warnings.join('\n')}>
          ⚠ {data.warnings.length}
        </div>
      )}
      {roles.usesTools && <Handle id="tool" type="source" position={Position.Bottom} />}
      {roles.sendsFlow && <Handle id="flow" type="source" position={Position.Right} className={flowHandle} />}
    </div>
  );
}

/** フローの接続口。道具の接続口と見分けられるよう色を付ける */
const flowHandle = 'bg-accent!';
