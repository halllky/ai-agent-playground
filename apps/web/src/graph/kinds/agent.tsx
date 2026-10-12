import { useId } from 'react';
import {
  defaultModelOf,
  historyModes,
  modelProviderLabels,
  modelProviders,
  pathInFolder,
  returnModes,
  type GraphDefinition,
  type GraphEdge,
  type NodeOf,
} from 'protocol';
import { ModelField, NumberField, SectionHeading, SelectField, TextField } from '../fields.tsx';
import { nodeName, type NodeKindView } from './index.ts';

type AgentConfig = NodeOf<'agent'>['config'];

/** エージェントノードの画面上の振る舞い */
export const agentView: NodeKindView<'agent'> = {
  label: 'エージェント',
  summary: (node) => `${modelProviderLabels[node.config.provider]} · ${node.config.model}`,
  Inspector: ({ node, graph, onChange }) => {
    const { config } = node;
    const set = (changed: Partial<AgentConfig>) => onChange({ ...node, config: { ...config, ...changed } });
    return (
      <>
        <TextField label="名前（ツール名）" value={config.name} onChange={(name) => set({ name })} />
        <TextField label="ツールの説明（呼び出し元に見える）" value={config.description} onChange={(description) => set({ description })} />
        <SelectField
          label="プロバイダ"
          value={config.provider}
          options={providerOptions}
          // モデル ID はプロバイダごとに別物なので、切り替えたら既定のモデルに戻す
          onChange={(provider) => set({ provider, model: defaultModelOf[provider] })}
        />
        <ModelField provider={config.provider} value={config.model} onChange={(model) => set({ model })} />
        <NumberField label="最大ステップ数" min={1} value={config.maxSteps} onChange={(maxSteps) => set({ maxSteps })} />

        <SectionHeading>LLM への入力</SectionHeading>
        <TextField label="① システムプロンプト" multiline value={config.systemPrompt} onChange={(systemPrompt) => set({ systemPrompt })} />
        <HistoryField config={config} onChange={set} />
        <div className="mb-2 text-xs text-muted">③ 今回のメッセージ</div>
        <div className="mb-2 border-l-2 pl-2">
          <AttachmentsField graph={graph} paths={config.attachments} onChange={(attachments) => set({ attachments })} />
          <RequestSources graph={graph} agentId={node.id} />
        </div>

        <SectionHeading>呼び出し元へ返すもの</SectionHeading>
        <SelectField label="" value={config.returns} options={returnOptions} onChange={(returns) => set({ returns })} />
      </>
    );
  },
};

/** 前回までの経緯として何を入れるか。直近の会話なら発言数をその横で選ぶ */
function HistoryField(props: { config: AgentConfig; onChange: (changed: Partial<AgentConfig>) => void }) {
  const { config, onChange } = props;
  return (
    <label className="mb-2 flex flex-col gap-0.5">
      <span className="text-xs text-muted">② 前回までの経緯</span>
      <span className="flex items-center gap-1">
        <select className="min-w-0 flex-1" value={config.history} onChange={(e) => onChange({ history: e.target.value as AgentConfig['history'] })}>
          {historyOptions.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        {config.history === 'recentConversation' && (
          <>
            <input
              className="w-14"
              type="number"
              min={1}
              value={config.historyLength}
              onChange={(e) => {
                const historyLength = Number(e.target.value);
                if (Number.isInteger(historyLength) && historyLength >= 1) onChange({ historyLength });
              }}
            />
            発言
          </>
        )}
      </span>
    </label>
  );
}

/** 依頼がどこから来るか。このエージェントへ流れてくるノードと、このエージェントをツールとして使うエージェントを名前で示す */
function RequestSources({ graph, agentId }: { graph: GraphDefinition; agentId: string }) {
  const namesOf = (kind: GraphEdge['kind']) =>
    graph.edges
      .filter((e) => e.kind === kind && e.target === agentId)
      .flatMap((e) => graph.nodes.filter((n) => n.id === e.source))
      .map(nodeName)
      .join('、');
  const flowing = namesOf('flow');
  const callers = namesOf('tool');
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-muted">依頼</span>
      {flowing && <span>{flowing} から流れてくるもの</span>}
      {callers && <span>{callers} が呼び出すときに書く指示</span>}
      {!flowing && !callers && <span className="text-muted">どこからもつながっていません</span>}
    </div>
  );
}

/** 今回のメッセージに中身を入れる、ワークフォルダのファイル。候補には、グラフのフォルダの初期ファイルを出す。パスの誤りはグラフの警告に出す */
function AttachmentsField(props: { graph: GraphDefinition; paths: string[]; onChange: (paths: string[]) => void }) {
  const { graph, paths, onChange } = props;
  const listId = useId();
  const suggestions = graph.nodes.flatMap((n) => (n.kind === 'files' ? n.config.files.map((f) => pathInFolder(n.config.path, f.path)) : []));
  return (
    <fieldset className="mb-2 flex flex-col gap-0.5">
      <legend className="mb-0.5 text-xs text-muted">ワークフォルダのファイル（その時点の中身）</legend>
      {paths.map((path, i) => (
        <div key={i} className="flex gap-1">
          <input
            className="min-w-0 flex-1"
            list={listId}
            value={path}
            placeholder="notes/概要.md"
            onChange={(e) => onChange(paths.map((p, j) => (j === i ? e.target.value : p)))}
          />
          <button type="button" className="border-danger text-danger" onClick={() => onChange(paths.filter((_, j) => j !== i))}>
            削除
          </button>
        </div>
      ))}
      <datalist id={listId}>
        {[...new Set(suggestions)].map((path) => (
          <option key={path} value={path} />
        ))}
      </datalist>
      <button type="button" onClick={() => onChange([...paths, ''])}>
        + ファイル
      </button>
    </fieldset>
  );
}

const historyLabels: Record<AgentConfig['history'], string> = {
  none: '含めない',
  recentConversation: 'ユーザーとの会話（直近）',
  conversation: 'ユーザーとの会話（すべて）',
  turnCalls: 'このエージェントへの依頼と応答（このターン）',
  sessionCalls: 'このエージェントへの依頼と応答（このセッション）',
};
const returnLabels: Record<AgentConfig['returns'], string> = {
  finalText: '最後の応答文',
  allSteps: '全ステップ（JSON）',
  none: 'なし（作業だけして終わる）',
};
const historyOptions = historyModes.map((value) => ({ value, label: historyLabels[value] }));
const returnOptions = returnModes.map((value) => ({ value, label: returnLabels[value] }));
const providerOptions = modelProviders.map((value) => ({ value, label: modelProviderLabels[value] }));
