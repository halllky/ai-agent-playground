import { modelProviderLabels, type ModelInfo, type ModelProvider } from '../model.ts';
import { canConnect, flowOrder } from './connections.ts';
import { judgeAnswerOptions, type EdgeOf, type GraphDefinition, type GraphNode, type JudgeQuestion, type NodeOf } from './schema.ts';
import { agentToolNames, filePathError, folderLabel, folderPathError, pathInFolder, toolNamePattern } from './tools.ts';

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

  const users = graph.nodes.filter((n) => n.kind === 'user');
  if (users.length !== 1) graphWarning(`ユーザーノードがちょうど1つ必要です（現在 ${users.length}）`);
  const order = flowOrder(graph);
  if (order === null) graphWarning('フローが循環しているため実行できません');
  else if (order.length === 0) graphWarning('ユーザーから何も流れていません');
  if (!graph.edges.some((e) => e.kind === 'flow' && users.some((u) => u.id === e.target))) {
    graphWarning('ユーザーへ何も流れ込まないため、返答が空になります');
  }

  warnings.push(...folderOverlapWarnings(graph));
  for (const node of graph.nodes) {
    warnings.push(...configWarnings(node).map((message) => ({ target: { nodeId: node.id }, message })));
    if (node.kind !== 'user' && node.kind !== 'files' && emptyTaskIsFlowing(graph, node.id, nodeById)) {
      warnings.push({ target: { nodeId: node.id }, message: '「呼び出し元へ返すもの」が「なし」のエージェントからしか流れてこないので、受け取る内容が空になります' });
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
    }
  }

  return warnings;
}

/** ノード単体の設定の問題 */
function configWarnings(node: GraphNode): string[] {
  switch (node.kind) {
    case 'user':
      return [];
    case 'agent':
      return [...(toolNamePattern.test(node.config.name) ? [] : [toolNameMessage]), ...agentConfigWarnings(node.config)];
    case 'webSearch':
      return toolNamePattern.test(node.config.name) ? [] : [toolNameMessage];
    case 'judge':
      return [...(toolNamePattern.test(node.config.name) ? [] : [toolNameMessage]), ...judgeQuestionWarnings(node.config.questions)];
    case 'files': {
      const folderError = folderPathError(node.config.path);
      const messages = folderError ? [folderError] : [];
      for (const file of node.config.files) {
        const pathError = filePathError(file.path);
        if (pathError) messages.push(pathError);
        else if (file.path.endsWith('.json') && !isJson(file.content)) messages.push(`${file.path} が JSON として読めません`);
      }
      return messages;
    }
  }
}

const toolNameMessage = 'ツール名は半角英数字・_・- の64文字以内にしてください';

function agentConfigWarnings(config: NodeOf<'agent'>['config']): string[] {
  const messages = config.attachments.flatMap((path) => {
    const error = filePathError(path);
    return error ? [`ワークフォルダのファイル: ${error}`] : [];
  });
  if (config.memory === 'session' && config.history !== 'none') {
    messages.push('「前回までの依頼と応答」を「このセッションの分」にしているので、「ユーザーとの会話」も含めると、これまでの発言が二重に入ります');
  }
  return messages;
}

/** 同じパスのフォルダや、複数のフォルダが同じパスに写す初期ファイル */
function folderOverlapWarnings(graph: GraphDefinition): GraphWarning[] {
  const warnings: GraphWarning[] = [];
  const folderOwners = new Map<string, string>();
  const fileOwners = new Map<string, string>();
  for (const node of graph.nodes) {
    if (node.kind !== 'files') continue;
    const folder = node.config.path;
    if (folderOwners.has(folder)) warnings.push({ target: { nodeId: node.id }, message: `フォルダ ${folderLabel(folder)} のノードがほかにもあります` });
    folderOwners.set(folder, node.id);
    for (const file of node.config.files) {
      const path = pathInFolder(folder, file.path);
      if (fileOwners.has(path) && fileOwners.get(path) !== node.id) {
        warnings.push({ target: { nodeId: node.id }, message: `会話の最初に置くファイル ${path} が、ほかのフォルダにもあります。先に置いたほうが残ります` });
      }
      fileOwners.set(path, node.id);
    }
  }
  return warnings;
}

/** nodeId へのフローがあり、その送り元がすべて返すもの「なし」のエージェントか */
function emptyTaskIsFlowing(graph: GraphDefinition, nodeId: string, nodeById: Map<string, GraphNode>): boolean {
  const sources = graph.edges.filter((e) => e.kind === 'flow' && e.target === nodeId).map((e) => nodeById.get(e.source));
  return sources.length > 0 && sources.every((s) => s?.kind === 'agent' && s.config.returns === 'none');
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
