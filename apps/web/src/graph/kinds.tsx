import type { ReactNode } from 'react';
import {
  memoryModes,
  passModes,
  returnModes,
  type AgentNode,
  type CallSettings,
  type EdgeOf,
  type GraphDefinition,
  type GraphEdge,
  type GraphNode,
  type NodeKind,
  type NodeOf,
} from 'protocol';
import { ModelField, NumberField, SelectField, TextField } from './fields.tsx';

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
  acceptsIncoming: boolean;
  /** パレットから追加できるか */
  addable(graph: GraphDefinition): boolean;
  Inspector(props: { node: NodeOf<K>; onChange: (node: NodeOf<K>) => void }): ReactNode;
};

/** エッジ種別ごとの画面上の振る舞い */
type EdgeKindView<K extends GraphEdge['kind']> = {
  /** キャンバス上のエッジに添える説明。空文字なら何も出さない */
  label(edge: EdgeOf<K>): string;
  Inspector(props: { edge: EdgeOf<K>; target: GraphNode | undefined; onChange: (edge: EdgeOf<K>) => void }): ReactNode;
};

/** 全ノード種別の画面上の振る舞い */
export const nodeKindViews: { [K in NodeKind]: NodeKindView<K> } = {
  mainAgent: {
    label: 'メインエージェント',
    title: () => 'メイン',
    summary: (node) => node.config.model,
    acceptsIncoming: false,
    addable: (graph) => !graph.nodes.some((n) => n.kind === 'mainAgent'),
    Inspector: ({ node, onChange }) => <AgentFields node={node} onChange={onChange} />,
  },
  subAgent: {
    label: 'サブエージェント',
    title: (node) => node.config.name,
    summary: (node) => node.config.model,
    acceptsIncoming: true,
    addable: () => true,
    Inspector: ({ node, onChange }) => {
      const set = (config: Partial<NodeOf<'subAgent'>['config']>) => onChange({ ...node, config: { ...node.config, ...config } });
      const setDefault = (settings: Partial<CallSettings>) => set({ callDefaults: { ...node.config.callDefaults, ...settings } });
      return (
        <>
          <TextField label="ツール名" value={node.config.name} onChange={(name) => set({ name })} />
          <TextField label="ツールの説明（呼び出し元に見える）" value={node.config.description} onChange={(description) => set({ description })} />
          <AgentFields node={node} onChange={onChange} />
          <h4>呼び出しの既定値</h4>
          <SelectField label="渡すもの" value={node.config.callDefaults.pass} options={passOptions} onChange={(pass) => setDefault({ pass })} />
          <SelectField label="返すもの" value={node.config.callDefaults.returns} options={returnOptions} onChange={(returns) => setDefault({ returns })} />
          <SelectField label="記憶" value={node.config.callDefaults.memory} options={memoryOptions} onChange={(memory) => setDefault({ memory })} />
        </>
      );
    },
  },
};

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
  return edgeKindViews[edge.kind];
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
};

const passLabels: Record<CallSettings['pass'], string> = { task: 'タスクのみ', taskWithHistory: '親の履歴も渡す' };
const returnLabels: Record<CallSettings['returns'], string> = { finalText: '最終テキスト', allSteps: '全ステップ' };
const memoryLabels: Record<CallSettings['memory'], string> = { fresh: '毎回まっさら', turn: 'ターン内で継続', session: 'セッションで継続' };
const passOptions = passModes.map((value) => ({ value, label: passLabels[value] }));
const returnOptions = returnModes.map((value) => ({ value, label: returnLabels[value] }));
const memoryOptions = memoryModes.map((value) => ({ value, label: memoryLabels[value] }));

/** エージェント系ノードに共通の設定項目 */
function AgentFields<N extends AgentNode>({ node, onChange }: { node: N; onChange: (node: N) => void }) {
  const set = (config: Partial<N['config']>) => onChange({ ...node, config: { ...node.config, ...config } });
  return (
    <>
      <ModelField value={node.config.model} onChange={(model) => set({ model } as Partial<N['config']>)} />
      <TextField label="システムプロンプト" multiline value={node.config.systemPrompt} onChange={(systemPrompt) => set({ systemPrompt } as Partial<N['config']>)} />
      <NumberField label="最大ステップ数" min={1} value={node.config.maxSteps} onChange={(maxSteps) => set({ maxSteps } as Partial<N['config']>)} />
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
