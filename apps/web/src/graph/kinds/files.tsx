import type { NodeOf } from 'protocol';
import { Hint, SectionHeading, TextField } from '../fields.tsx';
import type { NodeKindView } from './index.ts';

/** ファイルノードの画面上の振る舞い */
export const filesView: NodeKindView<'files'> = {
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
};

type InitialFile = { path: string; content: string };

/** files ノードの初期ファイル群の編集。パスや JSON の誤りはここでは検査しない */
function InitialFilesField(props: { files: InitialFile[]; onChange: (files: InitialFile[]) => void }) {
  const { files, onChange } = props;
  const update = (index: number, file: Partial<InitialFile>) => onChange(files.map((f, i) => (i === index ? { ...f, ...file } : f)));
  return (
    <div className="mb-2 flex flex-col gap-2">
      {files.map((file, i) => (
        <div key={i} className="flex flex-col gap-0.5">
          <div className="flex gap-1">
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
