import { z } from 'zod';
import { defaultModelOf, modelProviders } from './model.ts';

/** サブエージェントに何を渡すか。history なら呼び出し元は指示を書かず、呼び出し元の会話だけを渡す */
export const passModes = ['task', 'taskWithHistory', 'history'] as const;
/** サブエージェントから何を返すか */
export const returnModes = ['finalText', 'allSteps'] as const;
/** サブエージェントの記憶をどこまで持ち越すか */
export const memoryModes = ['fresh', 'turn', 'session'] as const;
/** ファイル群へのアクセス権限。write は read を含む */
export const accessPermissions = ['read', 'write'] as const;
/** ファイル群へのアクセス権限 */
export type AccessPermission = (typeof accessPermissions)[number];
/** Web検索の深さ。advanced は精度が上がるがクレジットを多く使う */
export const searchDepths = ['basic', 'advanced'] as const;

const callSettingsSchema = z.object({
  pass: z.enum(passModes),
  returns: z.enum(returnModes),
  memory: z.enum(memoryModes),
});
/** サブエージェントの呼び出し方 */
export type CallSettings = z.infer<typeof callSettingsSchema>;

/** ツール名として各プロバイダが受け付ける文字種 */
export const toolNamePattern = /^[A-Za-z0-9_-]{1,64}$/;

const agentConfigSchema = z.object({
  provider: z.enum(modelProviders),
  model: z.string(),
  systemPrompt: z.string(),
  maxSteps: z.number().int().positive(),
});

const positionSchema = z.object({ x: z.number(), y: z.number() });

/** 判定ノードの質問の種類。noul は yes/no、choice は選択肢から1つ、score は段階評価 */
export const judgeQuestionTypes = ['noul', 'choice', 'score'] as const;
/** 判定ノードの質問の種類の表示名 */
export const judgeQuestionTypeLabels: Record<(typeof judgeQuestionTypes)[number], string> = { noul: 'はい/いいえ', choice: '選択', score: '段階評価' };

const judgeQuestionSchema = z.discriminatedUnion('type', [
  z.object({
    /** 回答を識別する名前 */
    key: z.string(),
    type: z.literal('noul'),
    instructions: z.string(),
    /** yes / no それぞれの意味。空なら説明しない */
    yes: z.string(),
    no: z.string(),
  }),
  z.object({
    key: z.string(),
    type: z.literal('choice'),
    instructions: z.string(),
    choices: z.array(z.object({ label: z.string(), description: z.string() })),
  }),
  z.object({
    key: z.string(),
    type: z.literal('score'),
    instructions: z.string(),
    /** 0 点から順に並べた各段階の意味 */
    levels: z.array(z.string()),
  }),
]);
/** 判定ノードに固定で定義する質問1つ */
export type JudgeQuestion = z.infer<typeof judgeQuestionSchema>;

const flowConditionSchema = z.object({
  /** 判定ノードの質問の key */
  questionKey: z.string(),
  /** このいずれかの回答のときだけ流す。値の書き方は judgeAnswerOptions に従う */
  anyOf: z.array(z.string()),
});
/** フローエッジに流す条件。判定ノードの回答で決まる */
export type FlowCondition = z.infer<typeof flowConditionSchema>;

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
  /** セッションに1つ与えられる、エージェントが Markdown / JSON ファイルを置く場所。中身はターンごとに版管理される */
  z.object({
    id: z.string(),
    kind: z.literal('workfolder'),
    position: positionSchema,
    config: z.object({}),
  }),
  /** セッション開始時に設定の JSON ファイル群を写し、以降はそのセッション内だけで読み書きされるデータ */
  z.object({
    id: z.string(),
    kind: z.literal('resource'),
    position: positionSchema,
    config: z.object({
      /** ツール名の接頭辞 */
      name: z.string(),
      /** エージェントに見せるデータの説明 */
      description: z.string(),
      files: z.array(z.object({ path: z.string(), content: z.string() })),
    }),
  }),
  /**
   * Jev（TypeSafe AI）による判定。呼び出し元は判定対象の state だけを渡し、
   * ノードに固定で定義した質問への回答を確率・confidence 付きで受け取る。テキスト生成やツールコールはしない
   */
  z.object({
    id: z.string(),
    kind: z.literal('judge'),
    position: positionSchema,
    config: z.object({
      /** 呼び出し元から見えるツール名 */
      name: z.string(),
      /** 呼び出し元に見せるツールの説明 */
      description: z.string(),
      /** 空なら SDK の既定のモデル */
      model: z.string(),
      questions: z.array(judgeQuestionSchema),
    }),
  }),
  /** Tavily によるWeb検索 */
  z.object({
    id: z.string(),
    kind: z.literal('webSearch'),
    position: positionSchema,
    config: z.object({
      /** 呼び出し元から見えるツール名 */
      name: z.string(),
      maxResults: z.number().int().positive(),
      searchDepth: z.enum(searchDepths),
    }),
  }),
]);
export type GraphNode = z.infer<typeof graphNodeSchema>;
export type NodeKind = GraphNode['kind'];
/** 種別 K のノード */
export type NodeOf<K extends NodeKind> = Extract<GraphNode, { kind: K }>;
/** LLM を呼び出して動くノード */
export type AgentNode = NodeOf<'mainAgent'> | NodeOf<'subAgent'>;
/** フローの段になれるノード。フローエッジでつながると、メインエージェントより前に1回ずつ実行される */
export type StageNode = NodeOf<'subAgent'> | NodeOf<'judge'> | NodeOf<'webSearch'>;

/** グラフのエッジ。両端のノードが存在するかどうかは検証しない */
export const graphEdgeSchema = z.discriminatedUnion('kind', [
  /** エージェントがサブエージェントをツールとして呼び出す */
  z.object({
    id: z.string(),
    kind: z.literal('call'),
    source: z.string(),
    target: z.string(),
    /** 未指定の項目は呼び出し先ノードの既定値に従う */
    settings: callSettingsSchema.partial(),
  }),
  /** エージェントにファイル群の参照・編集を許す */
  z.object({
    id: z.string(),
    kind: z.literal('access'),
    source: z.string(),
    target: z.string(),
    permission: z.enum(accessPermissions),
  }),
  /** エージェントに、設定を持たない道具（Web検索など）を使わせる */
  z.object({
    id: z.string(),
    kind: z.literal('use'),
    source: z.string(),
    target: z.string(),
  }),
  /** フローの段の出力を、後段（別の段かメインエージェント）の入力として流す */
  z.object({
    id: z.string(),
    kind: z.literal('flow'),
    source: z.string(),
    target: z.string(),
    /** 送り元が判定ノードのとき、回答がこれを満たす場合だけ流す。null なら常に流す */
    condition: flowConditionSchema.nullable(),
  }),
]);
export type GraphEdge = z.infer<typeof graphEdgeSchema>;
/** 種別 K のエッジ */
export type EdgeOf<K extends GraphEdge['kind']> = Extract<GraphEdge, { kind: K }>;
/**
 * エッジの系統。
 * tools はエージェントに道具（サブエージェント・ファイル群・Web検索など）を持たせ、flow はノードの出力を次のノードへ流す
 */
export type EdgeLane = 'tools' | 'flow';

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

/** 既定の設定を持つ新しいエッジ。サブエージェント呼び出しなら呼び出し方をすべて呼び出し先の既定値に任せ、アクセスなら参照のみ、フローなら無条件 */
export function createEdge<K extends GraphEdge['kind']>(kind: K, id: string, source: string, target: string): EdgeOf<K> {
  return edgeFactories[kind](id, source, target);
}

/** nodeIds のノードと、それらにつながるエッジを取り除いたグラフ */
export function removeNodes(graph: GraphDefinition, nodeIds: Iterable<string>): GraphDefinition {
  const removed = new Set(nodeIds);
  return {
    ...graph,
    nodes: graph.nodes.filter((n) => !removed.has(n.id)),
    edges: graph.edges.filter((e) => !removed.has(e.source) && !removed.has(e.target)),
  };
}

/** edgeIds のエッジを取り除いたグラフ */
export function removeEdges(graph: GraphDefinition, edgeIds: Iterable<string>): GraphDefinition {
  const removed = new Set(edgeIds);
  return { ...graph, edges: graph.edges.filter((e) => !removed.has(e.id)) };
}

/** LLM を呼び出して動くノードか */
export function isAgentNode(node: GraphNode): node is AgentNode {
  return node.kind === 'mainAgent' || node.kind === 'subAgent';
}

/** フローの段になれるノードか */
export function isStageNode(node: GraphNode): node is StageNode {
  return node.kind === 'subAgent' || node.kind === 'judge' || node.kind === 'webSearch';
}

/** メインエージェントが無い・複数あるグラフも保存はできるため、見つからなければ undefined、複数なら最初の1つ */
export function findMainAgent(graph: GraphDefinition): NodeOf<'mainAgent'> | undefined {
  return graph.nodes.find((n): n is NodeOf<'mainAgent'> => n.kind === 'mainAgent');
}

/**
 * source から target へ lane の系統で張れるエッジの種類。張れない組み合わせなら undefined。
 * ノード種別を増やしたときは、ここに接続規則を足す。
 */
export function edgeKindBetween(source: GraphNode, target: GraphNode, lane: EdgeLane): GraphEdge['kind'] | undefined {
  if (source.id === target.id) return undefined;
  if (lane === 'flow') return isStageNode(source) && (isStageNode(target) || target.kind === 'mainAgent') ? 'flow' : undefined;
  if (!isAgentNode(source)) return undefined;
  switch (target.kind) {
    case 'subAgent':
      return 'call';
    case 'workfolder':
    case 'resource':
      return 'access';
    case 'webSearch':
    case 'judge':
      return 'use';
    default:
      return undefined;
  }
}

/** 種別 kind のエッジの系統 */
export function laneOf(kind: GraphEdge['kind']): EdgeLane {
  return kind === 'flow' ? 'flow' : 'tools';
}

/**
 * フローの段を実行順に並べる。
 * 段になれるノードのうち、フローエッジでほかの段かメインエージェントにつながっているものが段になる。
 * 前段がすべて終わってから後段を実行する順にする。循環していて順序が決まらなければ null
 */
export function flowStages(graph: GraphDefinition): StageNode[] | null {
  const stages = new Map<string, StageNode>();
  const flows: GraphEdge[] = [];
  for (const edge of graph.edges) {
    if (edge.kind !== 'flow') continue;
    const source = graph.nodes.find((n) => n.id === edge.source);
    const target = graph.nodes.find((n) => n.id === edge.target);
    if (!source || !target || !isStageNode(source)) continue;
    stages.set(source.id, source);
    if (isStageNode(target)) {
      stages.set(target.id, target);
      flows.push(edge);
    }
  }

  const pending = new Map([...stages.keys()].map((id) => [id, flows.filter((e) => e.target === id).length]));
  const ordered: StageNode[] = [];
  let ready = [...pending].filter(([, count]) => count === 0).map(([id]) => id);
  while (ready.length > 0) {
    const next: string[] = [];
    for (const id of ready) {
      ordered.push(stages.get(id)!);
      for (const edge of flows.filter((e) => e.source === id)) {
        const count = pending.get(edge.target)! - 1;
        pending.set(edge.target, count);
        if (count === 0) next.push(edge.target);
      }
    }
    ready = next;
  }
  return ordered.length === stages.size ? ordered : null;
}

/** 判定ノードの質問1つについて、回答として決まりうる値とその表示名。フローエッジの条件はこの値で書く */
export function judgeAnswerOptions(question: JudgeQuestion): { value: string; label: string }[] {
  switch (question.type) {
    case 'noul':
      return [
        { value: 'yes', label: question.yes ? `はい（${question.yes}）` : 'はい' },
        { value: 'no', label: question.no ? `いいえ（${question.no}）` : 'いいえ' },
      ];
    case 'choice':
      return question.choices.map((c) => ({ value: c.label, label: c.label }));
    case 'score':
      return question.levels.map((level, i) => ({ value: String(i), label: level ? `${i}（${level}）` : String(i) }));
  }
}

/** エッジの設定を呼び出し先の既定値で補完する */
export function resolveCallSettings(edge: EdgeOf<'call'>, target: NodeOf<'subAgent'>): CallSettings {
  return { ...target.config.callDefaults, ...stripUndefined(edge.settings) };
}

const nodeFactories: { [K in NodeKind]: (id: string, position: GraphNode['position']) => NodeOf<K> } = {
  mainAgent: (id, position) => ({
    id,
    kind: 'mainAgent',
    position,
    config: { provider: 'openrouter', model: defaultModelOf.openrouter, systemPrompt: 'You are a helpful assistant.', maxSteps: 10 },
  }),
  subAgent: (id, position) => ({
    id,
    kind: 'subAgent',
    position,
    config: {
      name: `agent_${id.slice(0, 4)}`,
      description: '',
      provider: 'openrouter',
      model: defaultModelOf.openrouter,
      systemPrompt: '',
      maxSteps: 10,
      callDefaults: { pass: 'task', returns: 'finalText', memory: 'fresh' },
    },
  }),
  workfolder: (id, position) => ({ id, kind: 'workfolder', position, config: {} }),
  resource: (id, position) => ({
    id,
    kind: 'resource',
    position,
    config: { name: `resource_${id.slice(0, 4)}`, description: '', files: [{ path: 'data.json', content: '{}' }] },
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

const edgeFactories: { [K in GraphEdge['kind']]: (id: string, source: string, target: string) => EdgeOf<K> } = {
  call: (id, source, target) => ({ id, kind: 'call', source, target, settings: {} }),
  access: (id, source, target) => ({ id, kind: 'access', source, target, permission: 'read' }),
  use: (id, source, target) => ({ id, kind: 'use', source, target }),
  flow: (id, source, target) => ({ id, kind: 'flow', source, target, condition: null }),
};

function stripUndefined<T extends object>(obj: T): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as Partial<T>;
}
