import { useCallback, useState } from 'react';
import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  type Edge,
  type Node,
  type OnConnect,
  type OnEdgesChange,
  type OnNodesChange,
} from '@xyflow/react';

const initialNodes: Node[] = [
  { id: 'input', type: 'input', position: { x: 0, y: 0 }, data: { label: 'User Input' } },
  { id: 'agent', position: { x: 0, y: 120 }, data: { label: 'Agent (Claude)' } },
  { id: 'tool', position: { x: 200, y: 240 }, data: { label: 'Tool: getCurrentTime' } },
  { id: 'output', type: 'output', position: { x: 0, y: 360 }, data: { label: 'Response' } },
];

const initialEdges: Edge[] = [
  { id: 'input-agent', source: 'input', target: 'agent' },
  { id: 'agent-tool', source: 'agent', target: 'tool', animated: true },
  { id: 'agent-output', source: 'agent', target: 'output' },
];

export function Flow() {
  const [nodes, setNodes] = useState(initialNodes);
  const [edges, setEdges] = useState(initialEdges);

  const onNodesChange: OnNodesChange = useCallback(
    (changes) => setNodes((ns) => applyNodeChanges(changes, ns)),
    [],
  );
  const onEdgesChange: OnEdgesChange = useCallback(
    (changes) => setEdges((es) => applyEdgeChanges(changes, es)),
    [],
  );
  const onConnect: OnConnect = useCallback((params) => setEdges((es) => addEdge(params, es)), []);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onConnect={onConnect}
      fitView
    >
      <Background />
      <Controls />
      <MiniMap />
    </ReactFlow>
  );
}
