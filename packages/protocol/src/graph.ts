import { z } from 'zod';

/** サブエージェントに何を渡すか */
export const passModes = ['task', 'taskWithHistory'] as const;
/** サブエージェントから何を返すか */
export const returnModes = ['finalText', 'allSteps'] as const;
/** サブエージェントの記憶をどこまで持ち越すか */
export const memoryModes = ['fresh', 'turn', 'session'] as const;

const callSettingsSchema = z.object({
  pass: z.enum(passModes),
  returns: z.enum(returnModes),
  memory: z.enum(memoryModes),
});
/** サブエージェントの呼び出し方 */
export type CallSettings = z.infer<typeof callSettingsSchema>;

/** ツール名として OpenRouter / 各プロバイダが受け付ける文字種 */
export const toolNamePattern = /^[A-Za-z0-9_-]{1,64}$/;

const agentConfigSchema = z.object({
  model: z.string(),
  systemPrompt: z.string(),
  maxSteps: z.number().int().positive(),
});

const positionSchema = z.object({ x: z.number(), y: z.number() });

/** グラフのノード。形式だけを検証し、接続の妥当性などの意味的な検査はしない */
export const graphNodeSchema = z.discriminatedUnion('kind', [
  z.object({
    id: z.string(),
    kind: z.literal('mainAgent'),
    position: positionSchema,
    config: agentConfigSchema,
  }),
  z.object({
    id: z.string(),
    kind: z.literal('subAgent'),
    position: positionSchema,
    config: agentConfigSchema.extend({
      /** 呼び出し元から見えるツール名 */
      name: z.string(),
      /** 呼び出し元に見せるツールの説明 */
      description: z.string(),
      /** エッジ側で指定がないときに使う呼び出し方 */
      callDefaults: callSettingsSchema,
    }),
  }),
]);
export type GraphNode = z.infer<typeof graphNodeSchema>;
export type NodeKind = GraphNode['kind'];
/** 種別 K のノード */
export type NodeOf<K extends NodeKind> = Extract<GraphNode, { kind: K }>;
/** LLM を呼び出して動くノード */
export type AgentNode = NodeOf<'mainAgent'> | NodeOf<'subAgent'>;

/** グラフのエッジ。両端のノードが存在するかどうかは検証しない */
export const graphEdgeSchema = z.discriminatedUnion('kind', [
  z.object({
    id: z.string(),
    kind: z.literal('call'),
    source: z.string(),
    target: z.string(),
    /** 未指定の項目は呼び出し先ノードの既定値に従う */
    settings: callSettingsSchema.partial(),
  }),
]);
export type GraphEdge = z.infer<typeof graphEdgeSchema>;
/** 種別 K のエッジ */
export type EdgeOf<K extends GraphEdge['kind']> = Extract<GraphEdge, { kind: K }>;

/**
 * エージェント構成のグラフ全体。保存・実行の単位。
 * 実行できる構成かどうかはスキーマでは保証しない（警告付きでも保存・実行できるようにしている）。
 */
export const graphDefinitionSchema = z.object({
  nodes: z.array(graphNodeSchema),
  edges: z.array(graphEdgeSchema),
  settings: z.object({
    /** 循環の有無に関係なく一律にかける呼び出しネストの上限 */
    maxCallDepth: z.number().int().positive(),
  }),
});
export type GraphDefinition = z.infer<typeof graphDefinitionSchema>;

/** 新規グラフの初期構成。メインエージェントだけを持つ */
export function createDefaultGraph(): GraphDefinition {
  return {
    nodes: [createNode('mainAgent', 'main', { x: 0, y: 0 })],
    edges: [],
    settings: { maxCallDepth: 5 },
  };
}

/** 既定の設定を持つ新しいノード */
export function createNode<K extends NodeKind>(kind: K, id: string, position: GraphNode['position']): NodeOf<K> {
  return nodeFactories[kind](id, position);
}

/** 呼び出し方をすべて呼び出し先の既定値に任せる新しいエッジ */
export function createEdge<K extends GraphEdge['kind']>(kind: K, id: string, source: string, target: string): EdgeOf<K> {
  return edgeFactories[kind](id, source, target);
}

/** メインエージェントが無い・複数あるグラフも保存はできるため、見つからなければ undefined、複数なら最初の1つ */
export function findMainAgent(graph: GraphDefinition): NodeOf<'mainAgent'> | undefined {
  return graph.nodes.find((n): n is NodeOf<'mainAgent'> => n.kind === 'mainAgent');
}

/**
 * source から target へ張れるエッジの種類。張れない組み合わせなら undefined。
 * ノード種別を増やしたときは、ここに接続規則を足す。
 */
export function edgeKindBetween(source: GraphNode, target: GraphNode): GraphEdge['kind'] | undefined {
  if (source.id === target.id) return undefined;
  const sourceIsAgent = source.kind === 'mainAgent' || source.kind === 'subAgent';
  if (sourceIsAgent && target.kind === 'subAgent') return 'call';
  return undefined;
}

/** エッジの設定を呼び出し先の既定値で補完する */
export function resolveCallSettings(edge: EdgeOf<'call'>, target: NodeOf<'subAgent'>): CallSettings {
  return { ...target.config.callDefaults, ...stripUndefined(edge.settings) };
}

const defaultModel = 'google/gemma-4-31b-it:free';

const nodeFactories: { [K in NodeKind]: (id: string, position: GraphNode['position']) => NodeOf<K> } = {
  mainAgent: (id, position) => ({
    id,
    kind: 'mainAgent',
    position,
    config: { model: defaultModel, systemPrompt: 'You are a helpful assistant.', maxSteps: 10 },
  }),
  subAgent: (id, position) => ({
    id,
    kind: 'subAgent',
    position,
    config: {
      name: `agent_${id.slice(0, 4)}`,
      description: '',
      model: defaultModel,
      systemPrompt: '',
      maxSteps: 10,
      callDefaults: { pass: 'task', returns: 'finalText', memory: 'fresh' },
    },
  }),
};

const edgeFactories: { [K in GraphEdge['kind']]: (id: string, source: string, target: string) => EdgeOf<K> } = {
  call: (id, source, target) => ({ id, kind: 'call', source, target, settings: {} }),
};

function stripUndefined<T extends object>(obj: T): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as Partial<T>;
}
