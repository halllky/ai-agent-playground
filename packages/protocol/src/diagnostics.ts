import {
  edgeKindBetween,
  flowStages,
  isAgentNode,
  judgeAnswerOptions,
  laneOf,
  toolNamePattern,
  type EdgeOf,
  type GraphDefinition,
  type GraphNode,
  type JudgeQuestion,
} from './graph.ts';
import { resourceSpecOf, toolNamesOf, volumePathError, volumeToolName } from './tools.ts';
import { modelProviderLabels, type ModelInfo, type ModelProvider } from './model.ts';

/** グラフ構成への警告1件。target はどの要素についての警告か */
export type GraphWarning = {
  target: { nodeId: string } | { edgeId: string } | { graph: true };
  message: string;
};

/**
 * 実行はできるが意図どおりに動かない可能性がある構成を列挙する。
 * 実行を止める判定には使わない（実験のため、警告付きでも実行できるようにしている）。
 * models にはプロバイダごとのモデル一覧を渡す。一覧が無い（未取得の）プロバイダのノードは、モデルに関する検査を省く。
 */
export function diagnoseGraph(graph: GraphDefinition, models: Partial<Record<ModelProvider, ModelInfo[]>>): GraphWarning[] {
  const warnings: GraphWarning[] = [];
  const nodeById = new Map(graph.nodes.map((n) => [n.id, n]));

  const mainCount = graph.nodes.filter((n) => n.kind === 'mainAgent').length;
  if (mainCount !== 1) {
    warnings.push({ target: { graph: true }, message: `メインエージェントがちょうど1つ必要です（現在 ${mainCount}）` });
  }
  if (graph.nodes.filter((n) => n.kind === 'workfolder').length > 1) {
    warnings.push({ target: { graph: true }, message: 'ワークフォルダはセッションに1つなので、複数置いても同じ中身を指します' });
  }
  if (flowStages(graph) === null) {
    warnings.push({ target: { graph: true }, message: 'フローが循環しています。循環している間はフローの段を実行しません' });
  }

  for (const node of graph.nodes) {
    warnings.push(...configWarnings(node).map((message) => ({ target: { nodeId: node.id }, message })));
    if (!isAgentNode(node)) continue;
    const outgoing = graph.edges.filter((e) => e.source === node.id && laneOf(e.kind) === 'tools');
    const catalog = models[node.config.provider];
    const model = catalog?.find((m) => m.id === node.config.model);
    if (catalog && !model) {
      warnings.push({ target: { nodeId: node.id }, message: `${modelProviderLabels[node.config.provider]} のモデル一覧に ${node.config.model} がありません` });
    }
    if (model && !model.supportsTools && outgoing.length > 0) {
      warnings.push({ target: { nodeId: node.id }, message: 'ツールコール非対応のモデルからエッジが出ています' });
    }
    warnings.push(...duplicateToolNameWarnings(node, outgoing, nodeById));
  }

  for (const edge of graph.edges) {
    const source = nodeById.get(edge.source);
    const target = nodeById.get(edge.target);
    if (!source || !target || edgeKindBetween(source, target, laneOf(edge.kind)) !== edge.kind) {
      warnings.push({ target: { edgeId: edge.id }, message: 'このノード同士は接続できません' });
    } else if (edge.kind === 'flow') {
      warnings.push(...flowConditionWarnings(edge, source).map((message) => ({ target: { edgeId: edge.id }, message })));
    }
  }

  return warnings;
}

/** ノード単体の設定の問題 */
function configWarnings(node: GraphNode): string[] {
  switch (node.kind) {
    case 'subAgent':
    case 'webSearch':
      return toolNamePattern.test(node.config.name) ? [] : [toolNameMessage];
    case 'judge':
      return [...(toolNamePattern.test(node.config.name) ? [] : [toolNameMessage]), ...judgeQuestionWarnings(node.config.questions)];
    case 'resource': {
      const spec = resourceSpecOf(node);
      const messages = toolNamePattern.test(volumeToolName(spec, 'patch_json'))
        ? []
        : ['名前は半角英数字・_・- の53文字以内にしてください（ツール名の接頭辞になります）'];
      for (const file of node.config.files) {
        const pathError = volumePathError(spec, file.path);
        if (pathError) messages.push(pathError);
        else if (!isJson(file.content)) messages.push(`${file.path} が JSON として読めません`);
      }
      return messages;
    }
    default:
      return [];
  }
}

const toolNameMessage = 'ツール名は半角英数字・_・- の64文字以内にしてください';

function judgeQuestionWarnings(questions: JudgeQuestion[]): string[] {
  if (questions.length === 0) return ['質問が1つ以上必要です'];
  const messages: string[] = [];
  const keys = questions.map((q) => q.key);
  if (keys.some((k) => !k.trim())) messages.push('質問の名前が空です');
  if (new Set(keys).size !== keys.length) messages.push('質問の名前が重複しています');
  for (const q of questions) {
    if (q.type === 'choice') {
      const labels = q.choices.map((c) => c.label);
      if (labels.length < 2 || labels.some((l) => !l.trim()) || new Set(labels).size !== labels.length) {
        messages.push(`質問 ${q.key} には、空でも重複でもない選択肢が2つ以上必要です`);
      }
    }
    if (q.type === 'score' && q.levels.length < 2) messages.push(`質問 ${q.key} には段階が2つ以上必要です`);
  }
  return messages;
}

function flowConditionWarnings(edge: EdgeOf<'flow'>, source: GraphNode): string[] {
  const { condition } = edge;
  if (!condition) return [];
  if (source.kind !== 'judge') return ['条件は判定ノードから出るフローにだけ付けられます。この条件は無視されます'];
  const question = source.config.questions.find((q) => q.key === condition.questionKey);
  if (!question) return [`条件の質問 ${condition.questionKey} が判定ノードにありません`];
  const values = new Set(judgeAnswerOptions(question).map((o) => o.value));
  if (!condition.anyOf.some((v) => values.has(v))) return ['条件を満たす回答が1つも選ばれていないため、何も流れません'];
  return [];
}

function isJson(text: string): boolean {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

function duplicateToolNameWarnings(
  node: GraphNode,
  outgoing: GraphDefinition['edges'],
  nodeById: Map<string, GraphNode>,
): GraphWarning[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const edge of outgoing) {
    const target = nodeById.get(edge.target);
    for (const name of target ? toolNamesOf(edge, target) : []) {
      if (seen.has(name)) duplicates.add(name);
      seen.add(name);
    }
  }
  return [...duplicates].map((name) => ({ target: { nodeId: node.id }, message: `ツール名 ${name} が重複しています` }));
}
