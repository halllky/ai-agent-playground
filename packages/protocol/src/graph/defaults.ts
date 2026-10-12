import { defaultModelOf } from '../model.ts';
import type { EdgeKind, EdgeOf, GraphDefinition, GraphNode, NodeKind, NodeOf } from './schema.ts';

/** 新規セッションのグラフ。ユーザーの発言をエージェント1つが受けて返す */
export function createDefaultGraph(): GraphDefinition {
  const agent = createNode('agent', 'assistant', { x: 0, y: 150 });
  agent.config = { ...agent.config, name: 'assistant', systemPrompt: 'You are a helpful assistant.', history: 'sessionCalls' };
  return {
    nodes: [createNode('user', 'user', { x: 0, y: 0 }), agent],
    edges: [createEdge('flow', 'user-assistant', 'user', 'assistant'), createEdge('flow', 'assistant-user', 'assistant', 'user')],
    settings: { maxCallDepth: 5 },
  };
}

/** 既定の設定を持つ新しいノード */
export function createNode<K extends NodeKind>(kind: K, id: string, position: GraphNode['position']): NodeOf<K> {
  return nodeFactories[kind](id, position);
}

/** 既定の設定を持つ新しいエッジ。ツールなら参照のみ、フローなら無条件 */
export function createEdge<K extends EdgeKind>(kind: K, id: string, source: string, target: string): EdgeOf<K> {
  return edgeFactories[kind](id, source, target);
}

const nodeFactories: { [K in NodeKind]: (id: string, position: GraphNode['position']) => NodeOf<K> } = {
  user: (id, position) => ({ id, kind: 'user', position }),
  agent: (id, position) => ({
    id,
    kind: 'agent',
    position,
    config: {
      name: `agent_${id.slice(0, 4)}`,
      description: '',
      provider: 'openrouter',
      model: defaultModelOf.openrouter,
      systemPrompt: '',
      maxSteps: 10,
      history: 'none',
      historyLength: 2,
      attachments: [],
      returns: 'finalText',
    },
  }),
  files: (id, position) => ({
    id,
    kind: 'files',
    position,
    config: { path: '', description: '', files: [] },
  }),
  judge: (id, position) => ({
    id,
    kind: 'judge',
    position,
    config: {
      name: `judge_${id.slice(0, 4)}`,
      description: '',
      model: '',
      questions: [{ key: 'answer', type: 'noul', instructions: '', yes: '', no: '' }],
    },
  }),
  webSearch: (id, position) => ({ id, kind: 'webSearch', position, config: { name: 'web_search', maxResults: 5, searchDepth: 'basic' } }),
};

const edgeFactories: { [K in EdgeKind]: (id: string, source: string, target: string) => EdgeOf<K> } = {
  tool: (id, source, target) => ({ id, kind: 'tool', source, target, permission: 'read' }),
  flow: (id, source, target) => ({ id, kind: 'flow', source, target, condition: null }),
};
