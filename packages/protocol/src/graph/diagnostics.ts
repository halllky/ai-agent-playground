import { modelProviderLabels, type ModelInfo, type ModelProvider } from '../model.ts';
import { canConnect, flowOrder } from './connections.ts';
import { judgeAnswerOptions, type EdgeOf, type GraphDefinition, type GraphNode, type JudgeQuestion, type NodeOf, type WorkfolderEntry } from './schema.ts';
import { agentToolNames, toolNamePattern } from './tools.ts';
import { entryNameError, entryPath, filePathError, scopeOf } from './workfolder.ts';

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
  const graphWarning = (message: string) => warnings.push({ target: { graph: true }, message });

  const inputs = graph.nodes.filter((n) => n.kind === 'userInput');
  const outputs = graph.nodes.filter((n) => n.kind === 'userOutput');
  const workfolders = graph.nodes.filter((n) => n.kind === 'workfolder');
  if (inputs.length !== 1) graphWarning(`ユーザー入力ノードがちょうど1つ必要です（現在 ${inputs.length}）`);
  if (outputs.length !== 1) graphWarning(`ユーザー出力ノードがちょうど1つ必要です（現在 ${outputs.length}）`);
  if (workfolders.length !== 1) graphWarning(`ワークフォルダノードがちょうど1つ必要です（現在 ${workfolders.length}）`);
  const order = flowOrder(graph);
  if (order === null) graphWarning('フローが循環しているため実行できません');
  else if (order.length === 0) graphWarning('ユーザー入力から何も流れていません');
  if (!graph.edges.some((e) => e.kind === 'flow' && outputs.some((o) => o.id === e.target))) {
    graphWarning('ユーザー出力へ何も流れ込まないため、返答が空になります');
  }

  for (const node of graph.nodes) {
    warnings.push(...configWarnings(node).map((message) => ({ target: { nodeId: node.id }, message })));
    if (node.kind === 'agent' || node.kind === 'judge') {
      warnings.push(...conversationWarnings(graph, node).map((message) => ({ target: { nodeId: node.id }, message })));
    }
    if (node.kind !== 'agent') continue;
    const toolNames = agentToolNames(graph, node);
    const catalog = models[node.config.provider];
    const model = catalog?.find((m) => m.id === node.config.model);
    if (catalog && !model) {
      warnings.push({ target: { nodeId: node.id }, message: `${modelProviderLabels[node.config.provider]} のモデル一覧に ${node.config.model} がありません` });
    }
    if (model && !model.supportsTools && toolNames.length > 0) {
      warnings.push({ target: { nodeId: node.id }, message: 'ツールコール非対応のモデルにツールが付いています' });
    }
    warnings.push(...duplicateToolNameWarnings(toolNames).map((message) => ({ target: { nodeId: node.id }, message })));
  }

  for (const edge of graph.edges) {
    const source = nodeById.get(edge.source);
    const target = nodeById.get(edge.target);
    if (!source || !target || !canConnect(source, target, edge.kind)) {
      warnings.push({ target: { edgeId: edge.id }, message: 'このノード同士は接続できません' });
    } else if (edge.kind === 'flow') {
      warnings.push(...flowConditionWarnings(edge, source).map((message) => ({ target: { edgeId: edge.id }, message })));
    } else if (edge.kind === 'access') {
      warnings.push(...accessWarnings(edge, target).map((message) => ({ target: { edgeId: edge.id }, message })));
    }
  }

  return warnings;
}

/** ノード単体の設定の問題 */
function configWarnings(node: GraphNode): string[] {
  switch (node.kind) {
    case 'userInput':
    case 'userOutput':
      return [];
    case 'agent':
    case 'webSearch':
      return toolNamePattern.test(node.config.name) ? [] : [toolNameMessage];
    case 'judge':
      return [...(toolNamePattern.test(node.config.name) ? [] : [toolNameMessage]), ...judgeQuestionWarnings(node.config.questions)];
    case 'workfolder':
      return entryWarnings(node.config.entries);
  }
}

const toolNameMessage = 'ツール名は半角英数字・_・- の64文字以内にしてください';

/**
 * ユーザーとの会話の設定の問題。会話を見ないのに、フローの前段がユーザー入力か作業だけして終わるエージェントだけなら、入力が空になる。
 * 判定は入力に上限があるので、会話をすべて含めると長い会話で判定できなくなる
 */
function conversationWarnings(graph: GraphDefinition, node: NodeOf<'agent'> | NodeOf<'judge'>): string[] {
  const messages: string[] = [];
  const sources = graph.edges.filter((e) => e.kind === 'flow' && e.target === node.id).map((e) => graph.nodes.find((n) => n.id === e.source));
  const flowsNothing = (source: GraphNode | undefined) => source?.kind === 'userInput' || (source?.kind === 'agent' && source.config.workOnly);
  if (node.config.conversation === 'none' && sources.length > 0 && sources.every(flowsNothing)) {
    messages.push('ユーザーとの会話を含めず、前段からも何も流れてこないため、入力が空になります');
  }
  if (node.kind === 'judge' && node.config.conversation === 'all') messages.push('会話が長くなると、判定の入力の上限を超えて判定できなくなります');
  return messages;
}

function accessWarnings(edge: EdgeOf<'access'>, target: GraphNode): string[] {
  if (target.kind !== 'workfolder') return [];
  if (!scopeOf(target, edge.entryId)) return ['権限を与えるファイル・フォルダがワークフォルダにありません'];
  if (edge.permission === 'none' && !edge.attach) return ['権限が無く、プロンプトにも含めないため、このエッジは何もしません'];
  return [];
}

/** ワークフォルダの初期エントリの、名前・置き場所・中身の問題 */
function entryWarnings(entries: WorkfolderEntry[]): string[] {
  const messages: string[] = [];
  const folderIds = new Set(entries.filter((e) => e.type === 'folder').map((e) => e.id));
  const paths = new Set<string>();
  for (const entry of entries) {
    const path = entryPath(entries, entry);
    const nameError = entryNameError(entry.name);
    if (nameError) messages.push(nameError);
    if (entry.parentId !== null && !folderIds.has(entry.parentId)) messages.push(`${path} の親のフォルダがありません`);
    if (paths.has(path)) messages.push(`${path} がほかにもあります`);
    paths.add(path);
    if (entry.type !== 'file' || nameError) continue;
    const pathError = filePathError(path);
    if (pathError) messages.push(pathError);
    else if (path.endsWith('.json') && !isJson(entry.content)) messages.push(`${path} が JSON として読めません`);
  }
  return messages;
}

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

function duplicateToolNameWarnings(toolNames: string[]): string[] {
  const duplicates = toolNames.filter((name, i) => toolNames.indexOf(name) !== i);
  return [...new Set(duplicates)].map((name) => `ツール名 ${name} が重複しています`);
}
