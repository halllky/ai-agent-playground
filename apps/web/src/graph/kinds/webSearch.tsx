import { searchDepths, type NodeOf } from 'protocol';
import { NumberField, SelectField, TextField } from '../fields.tsx';
import type { NodeKindView } from './index.ts';

/** Web検索ノードの画面上の振る舞い */
export const webSearchView: NodeKindView<'webSearch'> = {
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
};

const searchDepthOptions = searchDepths.map((value) => ({ value, label: value === 'basic' ? '標準' : '詳細（クレジットを多く使う）' }));
