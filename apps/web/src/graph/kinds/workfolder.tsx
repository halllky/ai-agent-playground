import { useEffect, type ReactNode } from 'react';
import { DocumentTextIcon, FolderIcon } from '@heroicons/react/16/solid';
import { Handle, Position, useUpdateNodeInternals } from '@xyflow/react';
import type { NodeOf, WorkfolderEntry } from 'protocol';
import { Hint, SectionHeading, TextField } from '../fields.tsx';
import type { NodeKindView } from './index.ts';

/**
 * ワークフォルダノードの画面上の振る舞い。キャンバスには見出しの下に会話の始まりの時点のファイル・フォルダを木で並べ、
 * 全体を表す見出しと各行に、エージェントからアクセスエッジをつなぐ接続口を置く。ファイル・フォルダの編集はインスペクタだけで行う
 */
export const workfolderView: NodeKindView<'workfolder'> = {
  label: 'ワークフォルダ',
  fixed: true,
  Contents: ({ node }) => <EntryRows node={node} />,
  Inspector: ({ node, onChange }) => {
    const set = (config: Partial<NodeOf<'workfolder'>['config']>) => onChange({ ...node, config: { ...node.config, ...config } });
    return (
      <>
        <TextField label="全体の説明（エージェントに見える）" value={node.config.description} onChange={(description) => set({ description })} />
        <SectionHeading>会話の始まりの時点のファイル・フォルダ</SectionHeading>
        <Hint>会話の最初のターンでワークフォルダに置きます。会話の途中で変えても、その会話には反映しません。</Hint>
        <EntriesField entries={node.config.entries} onChange={(entries) => set({ entries })} />
      </>
    );
  },
};

/** キャンバスで、ワークフォルダの entryId のエントリ（null なら全体）へアクセスエッジをつなぐ接続口の id */
export function accessHandleId(entryId: string | null): string {
  return entryId === null ? 'access' : `access:${entryId}`;
}

/** 接続口の id が指す、ワークフォルダのエントリの id。全体なら null、どのエントリの接続口でもなければ undefined */
export function entryIdOfHandle(workfolder: NodeOf<'workfolder'>, handleId: string | null | undefined): string | null | undefined {
  if (handleId === accessHandleId(null)) return null;
  return workfolder.config.entries.find((e) => accessHandleId(e.id) === handleId)?.id;
}

/** キャンバスに描く、全体を表す見出しとエントリの行。行が増減・移動したら、React Flow に接続口の位置を測り直させる */
function EntryRows({ node }: { node: NodeOf<'workfolder'> }) {
  const rows = treeRows(node.config.entries);
  const updateNodeInternals = useUpdateNodeInternals();
  const layout = rows.map((r) => r.entry.id).join();
  useEffect(() => updateNodeInternals(node.id), [updateNodeInternals, node.id, layout]);
  return (
    <div className="max-w-[240px]">
      <EntryRow handleId={accessHandleId(null)} depth={0}>
        <span className="font-semibold">{workfolderView.label}</span>
      </EntryRow>
      {rows.map(({ entry, depth }) => (
        <EntryRow key={entry.id} handleId={accessHandleId(entry.id)} depth={depth + 1}>
          <EntryIcon entry={entry} />
          <span className="truncate">{entry.type === 'folder' ? `${entry.name}/` : entry.name}</span>
        </EntryRow>
      ))}
    </div>
  );
}

/** 接続口を左端に持つ1行。ノードの余白の外まで広げて、接続口をノードの縁にそろえる */
function EntryRow({ handleId, depth, children }: { handleId: string; depth: number; children: ReactNode }) {
  return (
    <div className="relative -mx-2.5 flex items-center gap-1 py-px pr-2.5" style={{ paddingLeft: `${10 + depth * 12}px` }}>
      <Handle id={handleId} type="target" position={Position.Left} />
      {children}
    </div>
  );
}

function EntryIcon({ entry }: { entry: WorkfolderEntry }) {
  const Icon = entry.type === 'folder' ? FolderIcon : DocumentTextIcon;
  return <Icon className="size-3 shrink-0 text-muted" />;
}

/** エントリの木の編集。直下と各フォルダに追加ボタンを置き、フォルダの削除は中身ごと消す。名前や JSON の誤りはグラフの警告に出す */
function EntriesField({ entries, onChange }: { entries: WorkfolderEntry[]; onChange: (entries: WorkfolderEntry[]) => void }) {
  const update = (id: string, change: Partial<WorkfolderEntry>) => onChange(entries.map((e) => (e.id === id ? ({ ...e, ...change } as WorkfolderEntry) : e)));
  return (
    <div className="mb-2 flex flex-col gap-2">
      <AddButtons entries={entries} parentId={null} onChange={onChange} />
      {treeRows(entries).map(({ entry, depth }) => (
        <div key={entry.id} className="flex flex-col gap-0.5 border-l-2 pl-1.5" style={{ marginLeft: `${depth * 12}px` }}>
          <div className="flex items-center gap-1">
            <EntryIcon entry={entry} />
            <input className="min-w-0 flex-1" value={entry.name} onChange={(e) => update(entry.id, { name: e.target.value })} />
            <button type="button" className="border-danger text-danger" onClick={() => onChange(withoutEntry(entries, entry.id))}>
              削除
            </button>
          </div>
          <input value={entry.description} placeholder="説明（エージェントに見える）" onChange={(e) => update(entry.id, { description: e.target.value })} />
          {entry.type === 'file' ? (
            <textarea
              className="font-mono text-sm"
              rows={4}
              spellCheck={false}
              value={entry.content}
              onChange={(e) => update(entry.id, { content: e.target.value })}
            />
          ) : (
            <AddButtons entries={entries} parentId={entry.id} onChange={onChange} />
          )}
        </div>
      ))}
    </div>
  );
}

/** parentId のフォルダ（null なら直下）にファイル・フォルダを足すボタン */
function AddButtons(props: { entries: WorkfolderEntry[]; parentId: string | null; onChange: (entries: WorkfolderEntry[]) => void }) {
  const { entries, parentId, onChange } = props;
  const add = (type: WorkfolderEntry['type']) => {
    const base = { id: crypto.randomUUID(), parentId, name: freeName(entries, parentId, type), description: '' };
    onChange([...entries, type === 'folder' ? { ...base, type } : { ...base, type, content: '' }]);
  };
  return (
    <div className="flex gap-1">
      <button type="button" onClick={() => add('file')}>
        + ファイル
      </button>
      <button type="button" onClick={() => add('folder')}>
        + フォルダ
      </button>
    </div>
  );
}

/** エントリを、フォルダの中身がフォルダの直後に来るよう並べたもの。depth は直下が 0。親が見つからないエントリは直下に置く */
function treeRows(entries: WorkfolderEntry[]): { entry: WorkfolderEntry; depth: number }[] {
  const ids = new Set(entries.map((e) => e.id));
  const childrenOf = (parentId: string | null) =>
    entries
      .filter((e) => (parentId === null ? e.parentId === null || !ids.has(e.parentId) : e.parentId === parentId))
      .sort((a, b) => Number(a.type === 'file') - Number(b.type === 'file') || a.name.localeCompare(b.name));
  const rows: { entry: WorkfolderEntry; depth: number }[] = [];
  const visit = (parentId: string | null, depth: number) => {
    for (const entry of childrenOf(parentId)) {
      rows.push({ entry, depth });
      if (entry.type === 'folder') visit(entry.id, depth + 1);
    }
  };
  visit(null, 0);
  return rows;
}

/** id のエントリと、それがフォルダならその中身をすべて除いたもの */
function withoutEntry(entries: WorkfolderEntry[], id: string): WorkfolderEntry[] {
  const removed = new Set([id]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const e of entries) {
      if (e.parentId !== null && removed.has(e.parentId) && !removed.has(e.id)) {
        removed.add(e.id);
        grew = true;
      }
    }
  }
  return entries.filter((e) => !removed.has(e.id));
}

/** parentId のフォルダの中で、ほかと重ならない新しいエントリの名前 */
function freeName(entries: WorkfolderEntry[], parentId: string | null, type: WorkfolderEntry['type']): string {
  const taken = new Set(entries.filter((e) => e.parentId === parentId).map((e) => e.name));
  for (let i = 1; ; i++) {
    const name = type === 'folder' ? `folder${i}` : `file${i}.md`;
    if (!taken.has(name)) return name;
  }
}
