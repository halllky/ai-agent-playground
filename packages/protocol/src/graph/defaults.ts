import { defaultModelOf } from '../model.ts';
import type { EdgeKind, EdgeOf, GraphDefinition, GraphNode, NodeKind, NodeOf } from './schema.ts';

/**
 * 新規グラフの既定の構成。ユーザーの発言をエージェント1つが受けて返し、エージェントはこの会話でのこれまでの依頼と応答を覚えている。
 * フローが左から右へ流れるように並べ、空のワークフォルダをその下に置く
 */
export function createDefaultGraph(): GraphDefinition {
  const agent = createNode('agent', 'assistant', { x: 300, y: 0 });
  agent.config = { ...agent.config, name: 'assistant', systemPrompt: 'You are a helpful assistant.' };
  return {
    nodes: [
      createNode('userInput', 'input', { x: 0, y: 0 }),
      agent,
      createNode('userOutput', 'output', { x: 600, y: 0 }),
      createNode('workfolder', 'workfolder', { x: 300, y: 160 }),
    ],
    edges: [
      { ...createEdge('flow', 'input-assistant', 'input', 'assistant'), memory: 'session' },
      createEdge('flow', 'assistant-output', 'assistant', 'output'),
    ],
    settings: { maxCallDepth: 5 },
  };
}

/** 既定の設定を持つ新しいノード */
export function createNode<K extends NodeKind>(kind: K, id: string, position: GraphNode['position']): NodeOf<K> {
  return nodeFactories[kind](id, position);
}

/** 既定の設定を持つ新しいエッジ。アクセスならワークフォルダ全体の参照のみでプロンプトには含めず、フローなら無条件。エージェントとの間では最後の応答文を渡し、記憶は持たない */
export function createEdge<K extends EdgeKind>(kind: K, id: string, source: string, target: string): EdgeOf<K> {
  return edgeFactories[kind](id, source, target);
}

const nodeFactories: { [K in NodeKind]: (id: string, position: GraphNode['position']) => NodeOf<K> } = {
  userInput: (id, position) => ({ id, kind: 'userInput', position }),
  userOutput: (id, position) => ({ id, kind: 'userOutput', position }),
  agent: (id, position) => ({
    id,
    kind: 'agent',
    position,
    config: {
      name: `agent_${id.slice(0, 4)}`,
      provider: 'openrouter',
      model: defaultModelOf.openrouter,
      systemPrompt: '',
      maxSteps: 10,
      conversation: 'none',
      conversationLength: 2,
      workOnly: false,
    },
  }),
  workfolder: (id, position) => ({ id, kind: 'workfolder', position, config: { description: '', entries: [] } }),
  judge: (id, position) => ({
    id,
    kind: 'judge',
    position,
    config: {
      name: `judge_${id.slice(0, 4)}`,
      model: '',
      questions: [{ key: 'answer', type: 'noul', instructions: '', yes: '', no: '' }],
    },
  }),
  webSearch: (id, position) => ({ id, kind: 'webSearch', position, config: { name: 'web_search', maxResults: 5, searchDepth: 'basic' } }),
};

const edgeFactories: { [K in EdgeKind]: (id: string, source: string, target: string) => EdgeOf<K> } = {
  tool: (id, source, target) => ({ id, kind: 'tool', source, target, description: '', returns: 'finalText', memory: 'none' }),
  access: (id, source, target) => ({ id, kind: 'access', source, target, entryId: null, permission: 'read', attach: false }),
  flow: (id, source, target) => ({ id, kind: 'flow', source, target, condition: null, returns: 'finalText', memory: 'none' }),
};
