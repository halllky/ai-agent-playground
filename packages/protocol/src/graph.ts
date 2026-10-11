import { z } from 'zod';
import { defaultModelOf, modelProviders } from './model.ts';

/** エージェントに何を渡すか。history なら呼び出し元は指示を書かず、呼び出し元の会話だけを渡す */
export const passModes = ['task', 'taskWithHistory', 'history'] as const;
/** エージェントから何を返すか */
export const returnModes = ['finalText', 'allSteps'] as const;
/** エージェントの記憶をどこまで持ち越すか */
export const memoryModes = ['fresh', 'turn', 'session'] as const;
/** ファイル群へのアクセス権限。write は read を含む */
export const accessPermissions = ['read', 'write'] as const;
/** ファイル群へのアクセス権限 */
export type AccessPermission = (typeof accessPermissions)[number];
/** Web検索の深さ。advanced は精度が上がるがクレジットを多く使う */
export const searchDepths = ['basic', 'advanced'] as const;

/** ツール名として各プロバイダが受け付ける文字種 */
export const toolNamePattern = /^[A-Za-z0-9_-]{1,64}$/;

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

/**
 * グラフのノード。形式だけを検証し、接続の妥当性などの意味的な検査はしない。
 * user 以外のノードの config.name は、呼び出し元から見えるツール名（files ノードではツール名の接頭辞）になる
 */
export const graphNodeSchema = z.discriminatedUnion('kind', [
  /** ユーザー。ターンの発言はここから流れ出し、ここへ流れ込んだものが返答になる。グラフに1つだけ置く */
  z.object({
    id: z.string(),
    kind: z.literal('user'),
    position: positionSchema,
  }),
  /** LLM を呼び出して動くエージェント */
  z.object({
    id: z.string(),
    kind: z.literal('agent'),
    position: positionSchema,
    config: z.object({
      name: z.string(),
      /** 呼び出し元に見せるツールの説明 */
      description: z.string(),
      provider: z.enum(modelProviders),
      model: z.string(),
      systemPrompt: z.string(),
      maxSteps: z.number().int().positive(),
      pass: z.enum(passModes),
      returns: z.enum(returnModes),
      memory: z.enum(memoryModes),
    }),
  }),
  /** エージェントが Markdown / JSON ファイルを置く場所。会話で初めて使うときに files を写し、以降の中身はターンごとに残る */
  z.object({
    id: z.string(),
    kind: z.literal('files'),
    position: positionSchema,
    config: z.object({
      name: z.string(),
      /** エージェントに見せるファイル群の説明 */
      description: z.string(),
      files: z.array(z.object({ path: z.string(), content: z.string() })),
    }),
  }),
  /**
   * Jev（TypeSafe AI）による判定。入力された state について、
   * ノードに固定で定義した質問への回答を確率・confidence 付きで返す。テキスト生成やツールコールはしない
   */
  z.object({
    id: z.string(),
    kind: z.literal('judge'),
    position: positionSchema,
    config: z.object({
      name: z.string(),
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
      name: z.string(),
      maxResults: z.number().int().positive(),
      searchDepth: z.enum(searchDepths),
    }),
  }),
]);
/** グラフのノード */
export type GraphNode = z.infer<typeof graphNodeSchema>;
/** ノードの種別 */
export type NodeKind = GraphNode['kind'];
/** 種別 K のノード */
export type NodeOf<K extends NodeKind> = Extract<GraphNode, { kind: K }>;
/** 入力を受け取って出力を返す、呼び出せるノード */
export type InvocableNode = NodeOf<'agent'> | NodeOf<'judge'> | NodeOf<'webSearch'>;

/** グラフのエッジ。両端のノードが存在するかどうかは検証しない */
export const graphEdgeSchema = z.discriminatedUnion('kind', [
  /** 送り元のエージェントが、送り先をツールとして使う。permission は送り先が files ノードのときだけ意味を持つ */
  z.object({
    id: z.string(),
    kind: z.literal('tool'),
    source: z.string(),
    target: z.string(),
    permission: z.enum(accessPermissions),
  }),
  /** 送り元の出力を、送り先の入力として流す */
  z.object({
    id: z.string(),
    kind: z.literal('flow'),
    source: z.string(),
    target: z.string(),
    /** 送り元が判定ノードのとき、回答がこれを満たす場合だけ流す。null なら常に流す */
    condition: flowConditionSchema.nullable(),
  }),
]);
/** グラフのエッジ */
export type GraphEdge = z.infer<typeof graphEdgeSchema>;
/** エッジの種別 */
export type EdgeKind = GraphEdge['kind'];
/** 種別 K のエッジ */
export type EdgeOf<K extends EdgeKind> = Extract<GraphEdge, { kind: K }>;

/**
 * エージェント構成のグラフ全体。セッションが1つ持ち、ターンは実行時の写しを持つ。
 * 実行できる構成かどうかはスキーマでは保証しない（警告付きでも保存・実行できるようにしている）。
 */
export const graphDefinitionSchema = z.object({
  nodes: z.array(graphNodeSchema),
  edges: z.array(graphEdgeSchema),
  settings: z.object({
    /** 循環の有無に関係なく一律にかける、ツールとしての呼び出しのネストの上限 */
    maxCallDepth: z.number().int().positive(),
  }),
});
/** エージェント構成のグラフ全体 */
export type GraphDefinition = z.infer<typeof graphDefinitionSchema>;

/**
 * ノード種別ごとの、グラフ上での役割。接続できる組み合わせはすべてここから決まる。
 * usesTools はツールを使う側、isTool はツールとして使われる側、inFlow はフローに置けるか
 */
export const nodeRoles: Record<NodeKind, { usesTools: boolean; isTool: boolean; inFlow: boolean }> = {
  user: { usesTools: false, isTool: false, inFlow: true },
  agent: { usesTools: true, isTool: true, inFlow: true },
  files: { usesTools: false, isTool: true, inFlow: false },
  judge: { usesTools: false, isTool: true, inFlow: true },
  webSearch: { usesTools: false, isTool: true, inFlow: true },
};

/** 新規セッションのグラフ。ユーザーの発言をエージェント1つが受けて返す */
export function createDefaultGraph(): GraphDefinition {
  const agent = createNode('agent', 'assistant', { x: 0, y: 150 });
  agent.config = { ...agent.config, name: 'assistant', systemPrompt: 'You are a helpful assistant.', memory: 'session' };
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

/** source から target へ kind のエッジを張れるか */
export function canConnect(source: GraphNode, target: GraphNode, kind: EdgeKind): boolean {
  if (source.id === target.id) return false;
  if (kind === 'tool') return nodeRoles[source.kind].usesTools && nodeRoles[target.kind].isTool;
  return nodeRoles[source.kind].inFlow && nodeRoles[target.kind].inFlow;
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

/**
 * ユーザーから流れをたどって届くノードを、前段がすべて先に来る順に並べる（ユーザー自身は含めない）。
 * 循環していて順序が決まらなければ null。ユーザーノードが無ければ空
 */
export function flowOrder(graph: GraphDefinition): InvocableNode[] | null {
  const user = graph.nodes.find((n) => n.kind === 'user');
  if (!user) return [];
  const nodeById = new Map(graph.nodes.map((n) => [n.id, n]));
  const flows = graph.edges.filter((e) => {
    const source = nodeById.get(e.source);
    const target = nodeById.get(e.target);
    return e.kind === 'flow' && source && target && canConnect(source, target, 'flow') && target.kind !== 'user';
  });

  const reachable = new Set<string>();
  const visit = (id: string) => {
    for (const edge of flows.filter((e) => e.source === id)) {
      if (reachable.has(edge.target)) continue;
      reachable.add(edge.target);
      visit(edge.target);
    }
  };
  visit(user.id);

  const pending = new Map([...reachable].map((id) => [id, flows.filter((e) => e.target === id && reachable.has(e.source)).length]));
  const ordered: InvocableNode[] = [];
  let ready = [...pending].filter(([, count]) => count === 0).map(([id]) => id);
  while (ready.length > 0) {
    const next: string[] = [];
    for (const id of ready) {
      ordered.push(nodeById.get(id) as InvocableNode);
      for (const edge of flows.filter((e) => e.source === id && reachable.has(e.target))) {
        const count = pending.get(edge.target)! - 1;
        pending.set(edge.target, count);
        if (count === 0) next.push(edge.target);
      }
    }
    ready = next;
  }
  return ordered.length === reachable.size ? ordered : null;
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
      pass: 'task',
      returns: 'finalText',
      memory: 'fresh',
    },
  }),
  files: (id, position) => ({
    id,
    kind: 'files',
    position,
    config: { name: 'workfolder', description: 'この会話の作業用フォルダ', files: [] },
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
