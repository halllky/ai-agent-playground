import { defaultModelOf, modelProviderLabels, modelProviders, type NodeOf } from 'protocol';
import { ModelField, NumberField, SelectField, TextField } from '../fields.tsx';
import { ConversationField } from './conversation.tsx';
import type { NodeKindView } from './index.ts';

type AgentConfig = NodeOf<'agent'>['config'];

/**
 * エージェントノードの画面上の振る舞い。ここではエージェント自身の設定（ユーザーとの会話をどれだけ見るかを含む）だけを扱い、
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

const providerOptions = modelProviders.map((value) => ({ value, label: modelProviderLabels[value] }));
