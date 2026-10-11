import { useEffect, useMemo, useState } from 'react';
import { Allotment } from 'allotment';
import type { TurnFiles } from 'protocol';
import { api } from '../api.ts';
import { nodeTitle } from '../graph/kinds.tsx';
import { Markdown } from '../markdown/Markdown.tsx';
import { useSession } from '../session/store.ts';
import { CodeBlock, EmptyNote, ErrorNote } from '../ui/primitives.tsx';

/**
 * 表示中のターン時点のファイルの閲覧。ファイルはエージェントだけが書き込み、ここでは読み取り専用で表示する。
 * 実行中は、ファイルが変わるたびに取り直す。
 */
export function FilePanel() {
  const activeTurn = useSession((s) => s.turns.find((t) => t.id === s.activeTurnId));
  const activeEvents = useSession((s) => (s.activeTurnId ? s.events[s.activeTurnId] : undefined));
  // 表示中のターンで変わったファイル。変わるたび、またターンが終わったときに取り直す目印にもする
  const { changed, revision } = useMemo(() => {
    const changes = (activeEvents ?? []).flatMap((e) => (e.type === 'file.change' ? [fileKey(e)] : []));
    return { changed: new Set(changes), revision: `${changes.length}:${activeEvents?.some((e) => e.type === 'turn.finish')}` };
  }, [activeEvents]);
  const [files, setFiles] = useState<TurnFiles>({});
  const [selected, setSelected] = useState<FileRef | null>(null);
  const [error, setError] = useState<string | null>(null);

  const activeTurnId = activeTurn?.id;
  useEffect(() => {
    if (!activeTurnId) {
      setFiles({});
      return;
    }
    let cancelled = false;
    api.turnFiles(activeTurnId).then(
      (loaded) => {
        if (cancelled) return;
        setFiles(loaded);
        setError(null);
      },
      (e) => !cancelled && setError(e instanceof Error ? e.message : String(e)),
    );
    return () => {
      cancelled = true;
    };
  }, [activeTurnId, revision]);

  const groups = Object.entries(files).filter(([, group]) => Object.keys(group).length > 0);
  const content = selected ? files[selected.filesNodeId]?.[selected.path] : undefined;

  return (
    <div className="flex h-full flex-col border-l">
      <div className="border-b px-2.5 py-1.5 font-semibold">ファイル</div>
      <div className="min-h-0 flex-1">
        <Allotment vertical defaultSizes={[40, 60]}>
          <Allotment.Pane minSize={60}>
            <div className={paneBody}>
              {error && <ErrorNote>{error}</ErrorNote>}
              {groups.length === 0 && !error && <EmptyNote>まだファイルはありません</EmptyNote>}
              {groups.map(([filesNodeId, group]) => (
                <div key={filesNodeId}>
                  <div className="py-1 text-sm font-semibold text-muted">{activeTurn ? nodeTitle(activeTurn.graph, filesNodeId) : filesNodeId}</div>
                  <TreeView nodes={treeOf(filesNodeId, Object.keys(group))} changed={changed} selected={selected} onSelect={setSelected} />
                </div>
              ))}
            </div>
          </Allotment.Pane>
          <Allotment.Pane minSize={60}>
            {selected ? (
              <div className={`${paneBody} border-t`}>
                <div className="mb-1 font-semibold break-all">{selected.path}</div>
                {content === undefined ? (
                  <EmptyNote>このターンの時点では存在しません</EmptyNote>
                ) : selected.path.endsWith('.md') ? (
                  <Markdown text={content} />
                ) : (
                  <CodeBlock text={prettyJson(content)} />
                )}
              </div>
            ) : (
              <EmptyNote>ファイルを選ぶと中身を表示します</EmptyNote>
            )}
          </Allotment.Pane>
        </Allotment>
      </div>
    </div>
  );
}

const paneBody = 'h-full overflow-auto px-1.5 py-1';

type FileRef = { filesNodeId: string; path: string };

/** パスを / で区切った木の1要素。ファイルなら file を、フォルダなら children を持つ */
type TreeNode = { name: string; file?: FileRef; children: TreeNode[] };

function TreeView(props: { nodes: TreeNode[]; changed: Set<string>; selected: FileRef | null; onSelect: (file: FileRef) => void }) {
  const { nodes, changed, selected, onSelect } = props;
  return (
    <ul>
      {nodes.map((node) =>
        node.file ? (
          <li key={`file:${node.name}`}>
            <button
              type="button"
              className={`flex w-full items-center gap-1 border-0 px-1 py-px text-left ${
                selected && fileKey(selected) === fileKey(node.file) ? 'bg-highlight' : 'bg-transparent hover:bg-surface-sub'
              }`}
              onClick={() => onSelect(node.file!)}
            >
              {node.name}
              {changed.has(fileKey(node.file)) && (
                <span className="text-3xs text-accent" title="このターンで変更されたファイル">
                  ●
                </span>
              )}
            </button>
          </li>
        ) : (
          <li key={`folder:${node.name}`}>
            <details open>
              <summary>{node.name}/</summary>
              <div className="pl-3">
                <TreeView {...props} nodes={node.children} />
              </div>
            </details>
          </li>
        ),
      )}
    </ul>
  );
}

function fileKey(file: FileRef): string {
  return `${file.filesNodeId}\n${file.path}`;
}

/** パスを / で区切って木にする。同じ階層ではフォルダを先、ファイルを後に並べる */
function treeOf(filesNodeId: string, paths: string[]): TreeNode[] {
  const root: TreeNode = { name: '', children: [] };
  for (const path of paths) {
    const segments = path.split('/');
    let parent = root;
    for (const segment of segments.slice(0, -1)) {
      let folder = parent.children.find((c) => c.name === segment && !c.file);
      if (!folder) {
        folder = { name: segment, children: [] };
        parent.children.push(folder);
      }
      parent = folder;
    }
    parent.children.push({ name: segments.at(-1)!, file: { filesNodeId, path }, children: [] });
  }
  const sort = (nodes: TreeNode[]): TreeNode[] =>
    nodes
      .map((n) => ({ ...n, children: sort(n.children) }))
      .sort((a, b) => Number(!!a.file) - Number(!!b.file) || a.name.localeCompare(b.name));
  return sort(root.children);
}

function prettyJson(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}
