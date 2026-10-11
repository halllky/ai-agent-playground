import type { NodeOf } from 'protocol';
import { SectionHeading, TextField } from '../fields.tsx';
import type { NodeKindView } from './index.ts';

/** フォルダノードの画面上の振る舞い。ノードはセッションに1つのワークフォルダの中のフォルダを表す */
export const filesView: NodeKindView<'files'> = {
  label: 'フォルダ',
  summary: (node) => `初期 ${node.config.files.length} ファイル`,
  Inspector: ({ node, onChange }) => {
    const set = (config: Partial<NodeOf<'files'>['config']>) => onChange({ ...node, config: { ...node.config, ...config } });
    return (
      <>
        <label className="mb-2 flex flex-col gap-0.5">
          <span className="text-xs text-muted">パス</span>
          <span className="flex items-center gap-1">
            <span className="text-muted">ワークフォルダ/</span>
            <input className="min-w-0 flex-1" value={node.config.path} placeholder="（全体）" onChange={(e) => set({ path: e.target.value })} />
          </span>
        </label>
        <TextField label="説明（エージェントに見える）" value={node.config.description} onChange={(description) => set({ description })} />
        <SectionHeading>会話の最初に置くファイル</SectionHeading>
        <InitialFilesField folder={node.config.path} files={node.config.files} onChange={(files) => set({ files })} />
      </>
    );
  },
};

type InitialFile = { path: string; content: string };

/** フォルダの初期ファイルの編集。パスはフォルダからの相対パスで、フォルダのパスを前に添える。パスや JSON の誤りはここでは検査しない */
function InitialFilesField(props: { folder: string; files: InitialFile[]; onChange: (files: InitialFile[]) => void }) {
  const { folder, files, onChange } = props;
  const update = (index: number, file: Partial<InitialFile>) => onChange(files.map((f, i) => (i === index ? { ...f, ...file } : f)));
  return (
    <div className="mb-2 flex flex-col gap-2">
      {files.map((file, i) => (
        <div key={i} className="flex flex-col gap-0.5">
          <div className="flex items-center gap-1">
            {folder && <span className="text-muted">{folder}/</span>}
            <input className="min-w-0 flex-1" value={file.path} placeholder="notes.md" onChange={(e) => update(i, { path: e.target.value })} />
            <button type="button" className="border-danger text-danger" onClick={() => onChange(files.filter((_, j) => j !== i))}>
              削除
            </button>
          </div>
          <textarea className="font-mono text-sm" rows={6} spellCheck={false} value={file.content} onChange={(e) => update(i, { content: e.target.value })} />
        </div>
      ))}
      <button type="button" onClick={() => onChange([...files, { path: `file${files.length + 1}.md`, content: '' }])}>
        + ファイル
      </button>
    </div>
  );
}
