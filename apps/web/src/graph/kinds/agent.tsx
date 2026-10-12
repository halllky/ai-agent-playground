import { conversationModes, defaultModelOf, modelProviderLabels, modelProviders, type NodeOf } from 'protocol';
import { ModelField, NumberField, SelectField, TextField } from '../fields.tsx';
import type { NodeKindView } from './index.ts';

type AgentConfig = NodeOf<'agent'>['config'];

/**
 * エージェントノードの画面上の振る舞い。ここではエージェント自身の設定だけを扱い、
 * ツールの説明・返すもの・依頼と応答の記憶・プロンプトに含めるファイルは、つないだエッジで決める
 */
export const agentView: NodeKindView<'agent'> = {
  label: 'エージェント',
  summary: (node) => [modelProviderLabels[node.config.provider], node.config.model, ...(node.config.workOnly ? ['作業のみ'] : [])].join(' · '),
  Inspector: ({ node, onChange }) => {
    const { config } = node;
    const set = (changed: Partial<AgentConfig>) => onChange({ ...node, config: { ...config, ...changed } });
    return (
      <>
        <TextField label="名前（ツール名）" value={config.name} onChange={(name) => set({ name })} />
        <SelectField
          label="プロバイダ"
          value={config.provider}
          options={providerOptions}
          // モデル ID はプロバイダごとに別物なので、切り替えたら既定のモデルに戻す
          onChange={(provider) => set({ provider, model: defaultModelOf[provider] })}
        />
        <ModelField provider={config.provider} value={config.model} onChange={(model) => set({ model })} />
        <NumberField label="最大ステップ数" min={1} value={config.maxSteps} onChange={(maxSteps) => set({ maxSteps })} />
        <TextField label="システムプロンプト" multiline value={config.systemPrompt} onChange={(systemPrompt) => set({ systemPrompt })} />
        <ConversationField config={config} onChange={set} />
      </>
    );
  },
};

/** ユーザーとの会話をどれだけ入れるか。直近なら発言数をその横で選ぶ */
function ConversationField(props: { config: AgentConfig; onChange: (changed: Partial<AgentConfig>) => void }) {
  const { config, onChange } = props;
  return (
    <label className="mb-2 flex flex-col gap-0.5">
      <span className="text-xs text-muted">ユーザーとの会話</span>
      <span className="flex items-center gap-1">
        <select
          className="min-w-0 flex-1"
          value={config.conversation}
          onChange={(e) => onChange({ conversation: e.target.value as AgentConfig['conversation'] })}
        >
          {conversationOptions.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        {config.conversation === 'recent' && (
          <>
            <input
              className="w-14"
              type="number"
              min={1}
              value={config.conversationLength}
              onChange={(e) => {
                const conversationLength = Number(e.target.value);
                if (Number.isInteger(conversationLength) && conversationLength >= 1) onChange({ conversationLength });
              }}
            />
            発言
          </>
        )}
      </span>
    </label>
  );
}

const conversationLabels: Record<AgentConfig['conversation'], string> = { none: '含めない', recent: '直近', all: 'すべて' };
const conversationOptions = conversationModes.map((value) => ({ value, label: conversationLabels[value] }));
const providerOptions = modelProviders.map((value) => ({ value, label: modelProviderLabels[value] }));
