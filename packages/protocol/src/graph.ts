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
export type CallSettings = z.infer<typeof callSettingsSchema>;

/** ツール名として OpenRouter / 各プロバイダが受け付ける文字種 */
export const toolNamePattern = /^[A-Za-z0-9_-]{1,64}$/;

const agentConfigSchema = z.object({
  model: z.string(),
  systemPrompt: z.string(),
  maxSteps: z.number().int().positive(),
});

const positionSchema = z.object({ x: z.number(), y: z.number() });

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
export type NodeOf<K extends NodeKind> = Extract<GraphNode, { kind: K }>;

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

export const graphDefinitionSchema = z.object({
  nodes: z.array(graphNodeSchema),
  edges: z.array(graphEdgeSchema),
  settings: z.object({
    /** 循環の有無に関係なく一律にかける呼び出しネストの上限 */
    maxCallDepth: z.number().int().positive(),
  }),
});
export type GraphDefinition = z.infer<typeof graphDefinitionSchema>;

export const defaultModel = 'google/gemma-4-31b-it:free';

export function createDefaultGraph(): GraphDefinition {
  return {
    nodes: [
      {
        id: 'main',
        kind: 'mainAgent',
        position: { x: 0, y: 0 },
        config: { model: defaultModel, systemPrompt: 'You are a helpful assistant.', maxSteps: 10 },
      },
    ],
    edges: [],
    settings: { maxCallDepth: 5 },
  };
}

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
export type EdgeOf<K extends GraphEdge['kind']> = Extract<GraphEdge, { kind: K }>;

function stripUndefined<T extends object>(obj: T): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as Partial<T>;
}
