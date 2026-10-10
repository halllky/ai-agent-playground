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
  type AgentNode,
  type CallSettings,
  type EdgeOf,
  type FlowCondition,
  type GraphDefinition,
  type GraphEdge,
  type GraphNode,
  type NodeKind,
  type NodeOf,
} from 'protocol';
import { ChecklistField, Hint, JudgeQuestionsField, ModelField, NumberField, ResourceFilesField, SectionHeading, SelectField, TextField } from './fields.tsx';

/**
 * ノード種別ごとの画面上の振る舞い。
 * ノード種別を増やしたときは、ここに1件足せばキャンバス・パレット・インスペクタに反映される。
 */
type NodeKindView<K extends NodeKind> = {
  /** パレットやノード見出しに出す種別名 */
  label: string;
  /** ノードの見出し */
  title(node: NodeOf<K>): string;
  /** ノード本体に出す要約 */
  summary(node: NodeOf<K>): string;
  /** 道具として使われる側の接続口（上）を持つか */
  acceptsIncoming: boolean;
  /** 道具を使う側の接続口（下）を持つか */
  emitsOutgoing: boolean;
  /** フローの入力の接続口（左）を持つか */
  flowIn: boolean;
  /** フローの出力の接続口（右）を持つか */
  flowOut: boolean;
  /**
   * グラフに常に1個だけ置く種別か。そうなら削除できない。
   * 何かの間違いで欠けたグラフや、この種別が増える前に作ったグラフのために、グラフに無いときはパレットから追加できる
   */
  single: boolean;
  Inspector(props: { node: NodeOf<K>; onChange: (node: NodeOf<K>) => void }): ReactNode;
};

/** エッジ種別ごとの画面上の振る舞い */
type EdgeKindView<K extends GraphEdge['kind']> = {
  /** キャンバス上のエッジに添える説明。空文字なら何も出さない */
  label(edge: EdgeOf<K>): string;
  Inspector(props: { edge: EdgeOf<K>; source: GraphNode | undefined; target: GraphNode | undefined; onChange: (edge: EdgeOf<K>) => void }): ReactNode;
};

/** 全ノード種別の画面上の振る舞い */
export const nodeKindViews: { [K in NodeKind]: NodeKindView<K> } = {
  mainAgent: {
    label: 'メインエージェント',
    title: () => 'メイン',
    summary: agentSummary,
    acceptsIncoming: false,
    emitsOutgoing: true,
    flowIn: true,
    flowOut: false,
    single: true,
    Inspector: ({ node, onChange }) => <AgentFields node={node} onChange={onChange} />,
  },
  subAgent: {
    label: 'サブエージェント',
    title: (node) => node.config.name,
    summary: agentSummary,
    acceptsIncoming: true,
    emitsOutgoing: true,
    flowIn: true,
    flowOut: true,
    single: false,
    Inspector: ({ node, onChange }) => {
      const set = (config: Partial<NodeOf<'subAgent'>['config']>) => onChange({ ...node, config: { ...node.config, ...config } });
      const setDefault = (settings: Partial<CallSettings>) => set({ callDefaults: { ...node.config.callDefaults, ...settings } });
      return (
        <>
          <TextField label="ツール名" value={node.config.name} onChange={(name) => set({ name })} />
          <TextField label="ツールの説明（呼び出し元に見える）" value={node.config.description} onChange={(description) => set({ description })} />
          <AgentFields node={node} onChange={onChange} />
          <SectionHeading>呼び出しの既定値</SectionHeading>
          <Hint>フローの段として実行するときはこの設定で呼ばれ、流れてきた入力がタスク、今回の発言までの会話が親の履歴になります。</Hint>
          <SelectField label="渡すもの" value={node.config.callDefaults.pass} options={passOptions} onChange={(pass) => setDefault({ pass })} />
          <SelectField label="返すもの" value={node.config.callDefaults.returns} options={returnOptions} onChange={(returns) => setDefault({ returns })} />
          <SelectField label="記憶" value={node.config.callDefaults.memory} options={memoryOptions} onChange={(memory) => setDefault({ memory })} />
        </>
      );
    },
  },
  workfolder: {
    label: 'ワークフォルダ',
    title: () => 'ワークフォルダ',
    summary: () => 'Markdown / JSON',
    acceptsIncoming: true,
    emitsOutgoing: false,
    flowIn: false,
    flowOut: false,
    single: true,
    Inspector: () => (
      <Hint>
        この会話の作業用フォルダです。エージェントからエッジを張ると、ファイルの参照・編集のツールが使えるようになります。
        中身はターンごとに残り、過去のターンからやり直すとその時点の中身に戻ります。
      </Hint>
    ),
  },
  resource: {
    label: 'リソース',
    title: (node) => node.config.name,
    summary: (node) => `JSON ${node.config.files.length} ファイル`,
    acceptsIncoming: true,
    emitsOutgoing: false,
    flowIn: false,
    flowOut: false,
    single: false,
    Inspector: ({ node, onChange }) => {
      const set = (config: Partial<NodeOf<'resource'>['config']>) => onChange({ ...node, config: { ...node.config, ...config } });
      return (
        <>
          <TextField label="名前（ツール名の接頭辞）" value={node.config.name} onChange={(name) => set({ name })} />
          <TextField label="説明（エージェントに見える）" value={node.config.description} onChange={(description) => set({ description })} />
          <SectionHeading>ファイル</SectionHeading>
          <Hint>会話で初めて使うときにこの内容が写され、以降の編集はその会話の中だけに効きます。</Hint>
          <ResourceFilesField files={node.config.files} onChange={(files) => set({ files })} />
        </>
      );
    },
  },
  webSearch: {
    label: 'Web検索',
    title: (node) => node.config.name,
    summary: () => 'Tavily',
    acceptsIncoming: true,
    emitsOutgoing: false,
    flowIn: true,
    flowOut: true,
    single: false,
    Inspector: ({ node, onChange }) => {
      const set = (config: Partial<NodeOf<'webSearch'>['config']>) => onChange({ ...node, config: { ...node.config, ...config } });
      return (
        <>
          <TextField label="ツール名" value={node.config.name} onChange={(name) => set({ name })} />
          <NumberField label="最大件数" min={1} value={node.config.maxResults} onChange={(maxResults) => set({ maxResults })} />
          <SelectField label="検索の深さ" value={node.config.searchDepth} options={searchDepthOptions} onChange={(searchDepth) => set({ searchDepth })} />
        </>
      );
    },
  },
  judge: {
    label: '判定（Jev）',
    title: (node) => node.config.name,
    summary: (node) => `質問 ${node.config.questions.length} 件`,
    acceptsIncoming: true,
    emitsOutgoing: false,
    flowIn: true,
    flowOut: true,
    single: false,
    Inspector: ({ node, onChange }) => {
      const set = (config: Partial<NodeOf<'judge'>['config']>) => onChange({ ...node, config: { ...node.config, ...config } });
      return (
        <>
          <TextField label="ツール名" value={node.config.name} onChange={(name) => set({ name })} />
          <TextField label="ツールの説明（呼び出し元に見える）" value={node.config.description} onChange={(description) => set({ description })} />
          <TextField label="モデル（空なら jev-latest）" value={node.config.model} onChange={(model) => set({ model })} />
          <SectionHeading>質問</SectionHeading>
          <Hint>呼び出し元は判定対象の state だけを渡し、ここで決めた質問への回答を確率付きで受け取ります。</Hint>
          <JudgeQuestionsField questions={node.config.questions} onChange={(questions) => set({ questions })} />
        </>
      );
    },
  },
};

/** graph にパレットから追加できるノード種別 */
export function addableNodeKinds(graph: GraphDefinition): NodeKind[] {
  return (Object.keys(nodeKindViews) as NodeKind[]).filter((kind) => !nodeKindViews[kind].single || !graph.nodes.some((n) => n.kind === kind));
}

/** node の種別の振る舞い */
export function nodeKindView(node: GraphNode): NodeKindView<NodeKind> {
  return nodeKindViews[node.kind] as NodeKindView<NodeKind>;
}

/** グラフ上のノードの表示名。ノードが見つからなければ id をそのまま返す */
export function nodeTitle(graph: GraphDefinition, nodeId: string): string {
  const node = graph.nodes.find((n) => n.id === nodeId);
  return node ? nodeKindView(node).title(node) : nodeId;
}

/** edge の種別の振る舞い */
export function edgeKindView(edge: GraphEdge): EdgeKindView<GraphEdge['kind']> {
  return edgeKindViews[edge.kind] as EdgeKindView<GraphEdge['kind']>;
}

const edgeKindViews: { [K in GraphEdge['kind']]: EdgeKindView<K> } = {
  call: {
    label: (edge) =>
      [
        edge.settings.pass && passLabels[edge.settings.pass],
        edge.settings.returns && returnLabels[edge.settings.returns],
        edge.settings.memory && memoryLabels[edge.settings.memory],
      ]
        .filter(Boolean)
        .join(' / '),
    Inspector: ({ edge, target, onChange }) => {
      const defaults = target?.kind === 'subAgent' ? target.config.callDefaults : undefined;
      const set = (settings: Partial<CallSettings>) => onChange({ ...edge, settings: { ...edge.settings, ...settings } });
      return (
        <>
          <OverridableSelect label="渡すもの" value={edge.settings.pass} fallback={defaults?.pass} labels={passLabels} onChange={(pass) => set({ pass })} />
          <OverridableSelect label="返すもの" value={edge.settings.returns} fallback={defaults?.returns} labels={returnLabels} onChange={(returns) => set({ returns })} />
          <OverridableSelect label="記憶" value={edge.settings.memory} fallback={defaults?.memory} labels={memoryLabels} onChange={(memory) => set({ memory })} />
        </>
      );
    },
  },
  access: {
    label: (edge) => permissionLabels[edge.permission],
    Inspector: ({ edge, onChange }) => (
      <SelectField label="権限" value={edge.permission} options={permissionOptions} onChange={(permission) => onChange({ ...edge, permission })} />
    ),
  },
  use: {
    label: () => '',
    Inspector: () => <Hint>接続先をツールとして使えるようにします。設定はありません。</Hint>,
  },
  flow: {
    label: (edge) => (edge.condition ? `${edge.condition.questionKey}: ${edge.condition.anyOf.join(' / ')}` : ''),
    Inspector: ({ edge, source, onChange }) => (
      <>
        <Hint>
          送り元の出力を、送り先の入力として流します。フローの段はメインエージェントより前に、流れの順に1回ずつ実行されます。
          前段を持たない段は今回のユーザーの発言を受け取ります。サブエージェントは、ノードの呼び出しの既定値で呼ばれます。
        </Hint>
        {source?.kind === 'judge' && (
          <FlowConditionFields questions={source.config.questions} condition={edge.condition} onChange={(condition) => onChange({ ...edge, condition })} />
        )}
      </>
    ),
  },
};

const passLabels: Record<CallSettings['pass'], string> = { task: 'タスクのみ', taskWithHistory: '親の履歴も渡す', history: '親の履歴のみ' };
const returnLabels: Record<CallSettings['returns'], string> = { finalText: '最終テキスト', allSteps: '全ステップ' };
const memoryLabels: Record<CallSettings['memory'], string> = { fresh: '毎回まっさら', turn: 'ターン内で継続', session: 'セッションで継続' };
const permissionLabels: Record<AccessPermission, string> = { read: '参照', write: '編集' };
const passOptions = passModes.map((value) => ({ value, label: passLabels[value] }));
const returnOptions = returnModes.map((value) => ({ value, label: returnLabels[value] }));
const memoryOptions = memoryModes.map((value) => ({ value, label: memoryLabels[value] }));
const permissionOptions = accessPermissions.map((value) => ({ value, label: permissionLabels[value] }));
const searchDepthOptions = searchDepths.map((value) => ({ value, label: value === 'basic' ? '標準' : '詳細（クレジットを多く使う）' }));
const providerOptions = modelProviders.map((value) => ({ value, label: modelProviderLabels[value] }));

function agentSummary(node: AgentNode): string {
  return `${modelProviderLabels[node.config.provider]} · ${node.config.model}`;
}

/** エージェント系ノードに共通の設定項目 */
function AgentFields<N extends AgentNode>({ node, onChange }: { node: N; onChange: (node: N) => void }) {
  const set = (config: Partial<N['config']>) => onChange({ ...node, config: { ...node.config, ...config } });
  return (
    <>
      <SelectField
        label="プロバイダ"
        value={node.config.provider}
        options={providerOptions}
        // モデル ID はプロバイダごとに別物なので、切り替えたら既定のモデルに戻す
        onChange={(provider) => set({ provider, model: defaultModelOf[provider] } as Partial<N['config']>)}
      />
      <ModelField provider={node.config.provider} value={node.config.model} onChange={(model) => set({ model } as Partial<N['config']>)} />
      <TextField label="システムプロンプト" multiline value={node.config.systemPrompt} onChange={(systemPrompt) => set({ systemPrompt } as Partial<N['config']>)} />
      <NumberField label="最大ステップ数" min={1} value={node.config.maxSteps} onChange={(maxSteps) => set({ maxSteps } as Partial<N['config']>)} />
    </>
  );
}

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

/** 未指定ならノードの既定値に従う設定項目 */
function OverridableSelect<T extends string>(props: {
  label: string;
  value: T | undefined;
  fallback: T | undefined;
  labels: Record<T, string>;
  onChange: (value: T | undefined) => void;
}) {
  const inherit = '__inherit__';
  const options = [
    { value: inherit, label: `ノードの既定値（${props.fallback ? props.labels[props.fallback] : '-'}）` },
    ...(Object.keys(props.labels) as T[]).map((value) => ({ value, label: props.labels[value] })),
  ];
  return (
    <SelectField
      label={props.label}
      value={props.value ?? inherit}
      options={options}
      onChange={(value) => props.onChange(value === inherit ? undefined : (value as T))}
    />
  );
}
