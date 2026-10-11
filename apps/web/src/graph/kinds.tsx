import type { ReactNode } from 'react';
import {
  accessPermissions,
  defaultModelOf,
  judgeAnswerOptions,
  memoryModes,
  modelProviderLabels,
  modelProviders,
  passModes,
  returnModes,
  searchDepths,
  type AccessPermission,
  type EdgeKind,
  type EdgeOf,
  type FlowCondition,
  type GraphDefinition,
  type GraphEdge,
  type GraphNode,
  type NodeKind,
  type NodeOf,
} from 'protocol';
import { ChecklistField, Hint, InitialFilesField, JudgeQuestionsField, ModelField, NumberField, SectionHeading, SelectField, TextField } from './fields.tsx';

/**
 * ノード種別ごとの画面上の振る舞い。接続口はノードの役割で決まるので、ここでは持たない。
 * ノード種別を増やしたときは、ここに1件足せばキャンバス・パレット・インスペクタに反映される。
 */
type NodeKindView<K extends NodeKind> = {
  /** パレットやノード見出しに出す種別名 */
  label: string;
  /** ノード本体に出す要約 */
  summary(node: NodeOf<K>): string;
  Inspector(props: { node: NodeOf<K>; onChange: (node: NodeOf<K>) => void }): ReactNode;
};

/** エッジ種別ごとの画面上の振る舞い */
type EdgeKindView<K extends EdgeKind> = {
  /** キャンバス上のエッジに添える説明。空文字なら何も出さない */
  label(edge: EdgeOf<K>, target: GraphNode | undefined): string;
  Inspector(props: { edge: EdgeOf<K>; source: GraphNode | undefined; target: GraphNode | undefined; onChange: (edge: EdgeOf<K>) => void }): ReactNode;
};

/** 全ノード種別の画面上の振る舞い */
export const nodeKindViews: { [K in NodeKind]: NodeKindView<K> } = {
  user: {
    label: 'ユーザー',
    summary: () => '発言の送り元・返答の送り先',
    Inspector: () => (
      <Hint>
        ターンの発言はここから流れ出し、ここへ流れ込んだものが返答になります。複数流れ込んだときは、送り元の名前で区切って並べます。
      </Hint>
    ),
  },
  agent: {
    label: 'エージェント',
    summary: (node) => `${modelProviderLabels[node.config.provider]} · ${node.config.model}`,
    Inspector: ({ node, onChange }) => {
      const set = (config: Partial<NodeOf<'agent'>['config']>) => onChange({ ...node, config: { ...node.config, ...config } });
      return (
        <>
          <TextField label="名前（ツール名）" value={node.config.name} onChange={(name) => set({ name })} />
          <TextField label="ツールの説明（呼び出し元に見える）" value={node.config.description} onChange={(description) => set({ description })} />
          <SelectField
            label="プロバイダ"
            value={node.config.provider}
            options={providerOptions}
            // モデル ID はプロバイダごとに別物なので、切り替えたら既定のモデルに戻す
            onChange={(provider) => set({ provider, model: defaultModelOf[provider] })}
          />
          <ModelField provider={node.config.provider} value={node.config.model} onChange={(model) => set({ model })} />
          <TextField label="システムプロンプト" multiline value={node.config.systemPrompt} onChange={(systemPrompt) => set({ systemPrompt })} />
          <NumberField label="最大ステップ数" min={1} value={node.config.maxSteps} onChange={(maxSteps) => set({ maxSteps })} />
          <SectionHeading>呼び出され方</SectionHeading>
          <Hint>
            フローから呼ばれたときは、流れてきた入力が依頼、この会話の発言と返答が呼び出し元の会話になります。
            ユーザーとの会話を覚えて続けるなら、記憶を「セッションで継続」にします。
          </Hint>
          <SelectField label="渡すもの" value={node.config.pass} options={passOptions} onChange={(pass) => set({ pass })} />
          <SelectField label="返すもの" value={node.config.returns} options={returnOptions} onChange={(returns) => set({ returns })} />
          <SelectField label="記憶" value={node.config.memory} options={memoryOptions} onChange={(memory) => set({ memory })} />
        </>
      );
    },
  },
  files: {
    label: 'ファイル',
    summary: (node) => `Markdown / JSON · 初期 ${node.config.files.length} ファイル`,
    Inspector: ({ node, onChange }) => {
      const set = (config: Partial<NodeOf<'files'>['config']>) => onChange({ ...node, config: { ...node.config, ...config } });
      return (
        <>
          <TextField label="名前（ツール名の接頭辞）" value={node.config.name} onChange={(name) => set({ name })} />
          <TextField label="説明（エージェントに見える）" value={node.config.description} onChange={(description) => set({ description })} />
          <SectionHeading>初期ファイル</SectionHeading>
          <Hint>
            会話で初めて使うときにこの内容が写され、以降の編集はその会話の中だけに効きます。
            中身はターンごとに残り、過去のターンからやり直すとその時点の中身に戻ります。
          </Hint>
          <InitialFilesField files={node.config.files} onChange={(files) => set({ files })} />
        </>
      );
    },
  },
  webSearch: {
    label: 'Web検索',
    summary: () => 'Tavily',
    Inspector: ({ node, onChange }) => {
      const set = (config: Partial<NodeOf<'webSearch'>['config']>) => onChange({ ...node, config: { ...node.config, ...config } });
      return (
        <>
          <TextField label="名前（ツール名）" value={node.config.name} onChange={(name) => set({ name })} />
          <NumberField label="最大件数" min={1} value={node.config.maxResults} onChange={(maxResults) => set({ maxResults })} />
          <SelectField label="検索の深さ" value={node.config.searchDepth} options={searchDepthOptions} onChange={(searchDepth) => set({ searchDepth })} />
        </>
      );
    },
  },
  judge: {
    label: '判定（Jev）',
    summary: (node) => `質問 ${node.config.questions.length} 件`,
    Inspector: ({ node, onChange }) => {
      const set = (config: Partial<NodeOf<'judge'>['config']>) => onChange({ ...node, config: { ...node.config, ...config } });
      return (
        <>
          <TextField label="名前（ツール名）" value={node.config.name} onChange={(name) => set({ name })} />
          <TextField label="ツールの説明（呼び出し元に見える）" value={node.config.description} onChange={(description) => set({ description })} />
          <TextField label="モデル（空なら jev-latest）" value={node.config.model} onChange={(model) => set({ model })} />
          <SectionHeading>質問</SectionHeading>
          <Hint>入力された内容について、ここで決めた質問への回答を確率付きで返します。</Hint>
          <JudgeQuestionsField questions={node.config.questions} onChange={(questions) => set({ questions })} />
        </>
      );
    },
  },
};

/** graph にパレットから追加できるノード種別。ユーザーノードは無いときだけ */
export function addableNodeKinds(graph: GraphDefinition): NodeKind[] {
  return (Object.keys(nodeKindViews) as NodeKind[]).filter((kind) => kind !== 'user' || !graph.nodes.some((n) => n.kind === 'user'));
}

/** node の種別の振る舞い */
export function nodeKindView(node: GraphNode): NodeKindView<NodeKind> {
  return nodeKindViews[node.kind] as NodeKindView<NodeKind>;
}

/** ノードの表示名 */
export function nodeName(node: GraphNode): string {
  return node.kind === 'user' ? 'ユーザー' : node.config.name;
}

/** グラフ上のノードの表示名。ノードが見つからなければ id をそのまま返す */
export function nodeTitle(graph: GraphDefinition, nodeId: string): string {
  const node = graph.nodes.find((n) => n.id === nodeId);
  return node ? nodeName(node) : nodeId;
}

/** edge の種別の振る舞い */
export function edgeKindView(edge: GraphEdge): EdgeKindView<EdgeKind> {
  return edgeKindViews[edge.kind] as EdgeKindView<EdgeKind>;
}

const edgeKindViews: { [K in EdgeKind]: EdgeKindView<K> } = {
  tool: {
    label: (edge, target) => (target?.kind === 'files' ? permissionLabels[edge.permission] : ''),
    Inspector: ({ edge, target, onChange }) =>
      target?.kind === 'files' ? (
        <SelectField label="権限" value={edge.permission} options={permissionOptions} onChange={(permission) => onChange({ ...edge, permission })} />
      ) : (
        <Hint>送り元のエージェントが、送り先をツールとして使えるようにします。呼び出され方は送り先のノードで決まります。</Hint>
      ),
  },
  flow: {
    label: (edge) => (edge.condition ? `${edge.condition.questionKey}: ${edge.condition.anyOf.join(' / ')}` : ''),
    Inspector: ({ edge, source, onChange }) => (
      <>
        <Hint>
          送り元の出力を、送り先の入力として流します。ユーザーから流れをたどれるノードが、流れの順に1回ずつ実行されます。
          何も流れてこなかったノードは実行しません。
        </Hint>
        {source?.kind === 'judge' && (
          <FlowConditionFields questions={source.config.questions} condition={edge.condition} onChange={(condition) => onChange({ ...edge, condition })} />
        )}
      </>
    ),
  },
};

const passLabels: Record<NodeOf<'agent'>['config']['pass'], string> = { task: '依頼のみ', taskWithHistory: '呼び出し元の会話も渡す', history: '呼び出し元の会話のみ' };
const returnLabels: Record<NodeOf<'agent'>['config']['returns'], string> = { finalText: '最終テキスト', allSteps: '全ステップ' };
const memoryLabels: Record<NodeOf<'agent'>['config']['memory'], string> = { fresh: '毎回まっさら', turn: 'ターン内で継続', session: 'セッションで継続' };
const permissionLabels: Record<AccessPermission, string> = { read: '参照', write: '編集' };
const passOptions = passModes.map((value) => ({ value, label: passLabels[value] }));
const returnOptions = returnModes.map((value) => ({ value, label: returnLabels[value] }));
const memoryOptions = memoryModes.map((value) => ({ value, label: memoryLabels[value] }));
const permissionOptions = accessPermissions.map((value) => ({ value, label: permissionLabels[value] }));
const searchDepthOptions = searchDepths.map((value) => ({ value, label: value === 'basic' ? '標準' : '詳細（クレジットを多く使う）' }));
const providerOptions = modelProviders.map((value) => ({ value, label: modelProviderLabels[value] }));

/** 判定ノードから出るフローの条件。質問を選ぶと、まずその質問の最初の回答だけを流す条件にする */
function FlowConditionFields(props: {
  questions: NodeOf<'judge'>['config']['questions'];
  condition: FlowCondition | null;
  onChange: (condition: FlowCondition | null) => void;
}) {
  const { questions, condition, onChange } = props;
  const always = '__always__';
  const question = condition && questions.find((q) => q.key === condition.questionKey);
  const questionOptions = [{ value: always, label: '常に流す' }, ...questions.map((q) => ({ value: q.key, label: q.key }))];
  const selectQuestion = (key: string) => {
    const selected = questions.find((q) => q.key === key);
    onChange(selected ? { questionKey: key, anyOf: judgeAnswerOptions(selected).slice(0, 1).map((o) => o.value) } : null);
  };
  return (
    <>
      <SelectField label="流す条件" value={condition?.questionKey ?? always} options={questionOptions} onChange={selectQuestion} />
      {condition && question && (
        <ChecklistField
          label="この回答のときだけ流す"
          options={judgeAnswerOptions(question)}
          values={condition.anyOf}
          onChange={(anyOf) => onChange({ ...condition, anyOf })}
        />
      )}
    </>
  );
}
