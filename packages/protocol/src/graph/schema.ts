import { z } from 'zod';
import { modelProviders } from '../model.ts';

/**
 * エージェントに、この呼び出しより前の経緯として何を渡すか。1つだけを選ぶので、同じ発言が二重に入ることはない。
 * - recentConversation / conversation: ユーザーとの会話のうち、前のターンまでの直近 historyLength 発言 / すべて
 * - turnCalls / sessionCalls: このエージェントの、このターン / この会話でのこれまでの呼び出しの依頼と応答（ツールコールを含む）
 */
export const historyModes = ['none', 'recentConversation', 'conversation', 'turnCalls', 'sessionCalls'] as const;
/** エージェントから呼び出し元へ何を返すか。none なら何も返さず、終了用のツールで応答を待たずに終われる。フローでは受け取った入力をそのまま後段へ流す */
export const returnModes = ['finalText', 'allSteps', 'none'] as const;
/** ワークフォルダへのアクセス権限。write は read を含む */
export const accessPermissions = ['read', 'write'] as const;
/** ワークフォルダへのアクセス権限 */
export type AccessPermission = (typeof accessPermissions)[number];
/** Web検索の深さ。advanced は精度が上がるがクレジットを多く使う */
export const searchDepths = ['basic', 'advanced'] as const;

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

const workfolderEntryBase = {
  id: z.string(),
  /** 親のフォルダのエントリの id。null ならワークフォルダの直下 */
  parentId: z.string().nullable(),
  /** パスの1階層分の名前 */
  name: z.string(),
  /** エージェントに見せる説明 */
  description: z.string(),
};
const workfolderEntrySchema = z.discriminatedUnion('type', [
  z.object({ ...workfolderEntryBase, type: z.literal('folder') }),
  z.object({ ...workfolderEntryBase, type: z.literal('file'), content: z.string() }),
]);
/** ワークフォルダノードに置く、会話の始まりの時点のファイルかフォルダ1つ。親子は parentId でたどる */
export type WorkfolderEntry = z.infer<typeof workfolderEntrySchema>;

/**
 * グラフのノード。形式だけを検証し、接続の妥当性などの意味的な検査はしない。
 * 呼び出せるノードの config.name は、呼び出し元から見えるツール名になる
 */
export const graphNodeSchema = z.discriminatedUnion('kind', [
  /** ユーザー入力。ターンの発言はここから流れ出す。グラフに1つだけ置く */
  z.object({
    id: z.string(),
    kind: z.literal('userInput'),
    position: positionSchema,
  }),
  /** ユーザー出力。ここへ流れ込んだものがターンの返答になる。グラフに1つだけ置く */
  z.object({
    id: z.string(),
    kind: z.literal('userOutput'),
    position: positionSchema,
  }),
  /**
   * LLM を呼び出して動くエージェント。LLM には、システムプロンプト・前回までの経緯（history）・今回のメッセージの順に渡す。
   * 今回のメッセージは、添付ファイル（attachments）と依頼を並べたもの。
   * 依頼は、フローから呼ばれたときは流れてきた入力、ツールとして呼ばれたときは呼び出し元が書いた引数
   */
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
      history: z.enum(historyModes),
      /** history が recentConversation のときに入れる、直近の発言の数 */
      historyLength: z.number().int().positive(),
      /** 呼び出しのたびに今の中身を入れる、ワークフォルダのファイルのパス */
      attachments: z.array(z.string()),
      returns: z.enum(returnModes),
    }),
  }),
  /**
   * ワークフォルダ。セッションに1つで、Markdown / JSON ファイルを置く。グラフに1つだけ置く。
   * エージェントからのアクセスエッジで、ワークフォルダ全体か、その中のファイル・フォルダへの権限を与える。
   * 会話の先頭のターンで entries のファイルを写し、以降の中身はターンごとに残る
   */
  z.object({
    id: z.string(),
    kind: z.literal('workfolder'),
    position: positionSchema,
    config: z.object({
      /** エージェントに見せるワークフォルダ全体の説明 */
      description: z.string(),
      /** 会話の始まりの時点で置くファイル・フォルダ */
      entries: z.array(workfolderEntrySchema),
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

/** node が入力を受け取って出力を返す、呼び出せるノードか */
export function isInvocable(node: GraphNode): node is InvocableNode {
  return node.kind === 'agent' || node.kind === 'judge' || node.kind === 'webSearch';
}

/** グラフのエッジ。両端のノードが存在するかどうかは検証しない */
export const graphEdgeSchema = z.discriminatedUnion('kind', [
  /** 送り元のエージェントが、送り先をツールとして使う */
  z.object({
    id: z.string(),
    kind: z.literal('tool'),
    source: z.string(),
    target: z.string(),
  }),
  /** 送り元のエージェントに、送り先のワークフォルダの中のエントリ（null なら全体）以下への権限を与える */
  z.object({
    id: z.string(),
    kind: z.literal('access'),
    source: z.string(),
    target: z.string(),
    entryId: z.string().nullable(),
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
