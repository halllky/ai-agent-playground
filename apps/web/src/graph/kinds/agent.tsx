import { defaultModelOf, memoryModes, modelProviderLabels, modelProviders, passModes, returnModes, type NodeOf } from 'protocol';
import { Hint, ModelField, NumberField, SectionHeading, SelectField, TextField } from '../fields.tsx';
import type { NodeKindView } from './index.ts';

/** エージェントノードの画面上の振る舞い */
export const agentView: NodeKindView<'agent'> = {
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
};

const passLabels: Record<NodeOf<'agent'>['config']['pass'], string> = { task: '依頼のみ', taskWithHistory: '呼び出し元の会話も渡す', history: '呼び出し元の会話のみ' };
const returnLabels: Record<NodeOf<'agent'>['config']['returns'], string> = { finalText: '最終テキスト', allSteps: '全ステップ' };
const memoryLabels: Record<NodeOf<'agent'>['config']['memory'], string> = { fresh: '毎回まっさら', turn: 'ターン内で継続', session: 'セッションで継続' };
const passOptions = passModes.map((value) => ({ value, label: passLabels[value] }));
const returnOptions = returnModes.map((value) => ({ value, label: returnLabels[value] }));
const memoryOptions = memoryModes.map((value) => ({ value, label: memoryLabels[value] }));
const providerOptions = modelProviders.map((value) => ({ value, label: modelProviderLabels[value] }));
