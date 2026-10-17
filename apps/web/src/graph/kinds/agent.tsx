import { modelProviderLabels, type NodeOf } from 'protocol';
import { NumberField, ProviderAndModelField, TextField } from '../fields.tsx';
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
        <ProviderAndModelField provider={config.provider} model={config.model} onChange={set} />
        <NumberField label="最大ステップ数" min={1} value={config.maxSteps} onChange={(maxSteps) => set({ maxSteps })} />
        <TextField label="システムプロンプト" multiline value={config.systemPrompt} onChange={(systemPrompt) => set({ systemPrompt })} />
        <ConversationField config={config} onChange={set} />
      </>
    );
  },
};
