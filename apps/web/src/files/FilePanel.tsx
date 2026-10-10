import { useEffect, useState } from 'react';
import { Allotment } from 'allotment';
import { resourceSpecOf, workfolderSpec, type FileEntry, type GraphDefinition } from 'protocol';
import { api } from '../api.ts';
import { Markdown } from '../markdown/Markdown.tsx';
import { useSession } from '../session/store.ts';

/**
 * 表示中のターン時点のファイルの閲覧。ファイルはエージェントだけが書き込み、ここでは読み取り専用で表示する。
 * 実行中は、ファイルが変わるたびに取り直す。
 */
export function FilePanel() {
  const activeTurnId = useSession((s) => s.activeTurnId);
  const activeGraph = useSession((s) => s.turns.find((t) => t.id === s.activeTurnId)?.graph);
  // 表示中のターンでファイルが変わった、または終わったことを知るための目印
  const revision = useSession((s) =>
    activeTurnId ? (s.events[activeTurnId] ?? []).filter((e) => e.type === 'file.change' || e.type === 'turn.finish').length : 0,
  );
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [selected, setSelected] = useState<FileRef | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!activeTurnId) {
      setFiles([]);
      return;
    }
    let cancelled = false;
    api.turnFiles(activeTurnId).then(
      (entries) => {
        if (cancelled) return;
        setFiles(entries);
        setError(null);
      },
      (e) => !cancelled && setError(e instanceof Error ? e.message : String(e)),
    );
    return () => {
      cancelled = true;
    };
  }, [activeTurnId, revision]);

  const selectedEntry = selected && files.find((f) => f.volume === selected.volume && f.path === selected.path);

  return (
    <div className="files">
      <div className="panel-title">ファイル</div>
      <div className="files-body">
        <Allotment vertical defaultSizes={[40, 60]}>
          <Allotment.Pane minSize={60}>
            <div className="file-tree">
              {error && <div className="status-note error">{error}</div>}
              {files.length === 0 && !error && <div className="panel-empty">まだファイルはありません</div>}
              {groupByVolume(files).map(([volume, entries]) => (
                <div key={volume} className="file-volume">
                  <div className="file-volume-title">{volumeLabel(volume, activeGraph)}</div>
                  <TreeView nodes={treeOf(entries)} activeTurnId={activeTurnId} selected={selected} onSelect={setSelected} />
                </div>
              ))}
            </div>
          </Allotment.Pane>
          <Allotment.Pane minSize={60}>
            {selected && activeTurnId ? (
              <FileView turnId={activeTurnId} file={selected} entry={selectedEntry ?? undefined} />
            ) : (
              <div className="panel-empty">ファイルを選ぶと中身を表示します</div>
            )}
          </Allotment.Pane>
        </Allotment>
      </div>
    </div>
  );
}

type FileRef = { volume: string; path: string };

/** パスを / で区切った木の1要素。フォルダなら children を持つ */
type TreeNode = { name: string; entry?: FileEntry; children: TreeNode[] };

function TreeView(props: {
  nodes: TreeNode[];
  activeTurnId: string | null;
  selected: FileRef | null;
  onSelect: (file: FileRef) => void;
}) {
  const { nodes, activeTurnId, selected, onSelect } = props;
  return (
    <ul className="file-list">
      {nodes.map((node) =>
        node.entry ? (
          <li key={`file:${node.name}`}>
            <button
              type="button"
              className={`file-item${selected?.volume === node.entry.volume && selected.path === node.entry.path ? ' selected' : ''}`}
              onClick={() => onSelect({ volume: node.entry!.volume, path: node.entry!.path })}
            >
              {node.name}
              {node.entry.turnId === activeTurnId && (
                <span className="file-changed" title="このターンで変更されたファイル">
                  ●
                </span>
              )}
            </button>
          </li>
        ) : (
          <li key={`folder:${node.name}`}>
            <details open>
              <summary>{node.name}/</summary>
              <TreeView {...props} nodes={node.children} />
            </details>
          </li>
        ),
      )}
    </ul>
  );
}

function FileView({ turnId, file, entry }: { turnId: string; file: FileRef; entry: FileEntry | undefined }) {
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!entry) return;
    let cancelled = false;
    setContent(null);
    api.fileContent(turnId, file).then(
      (r) => {
        if (cancelled) return;
        setContent(r.content);
        setError(null);
      },
      (e) => !cancelled && setError(e instanceof Error ? e.message : String(e)),
    );
    return () => {
      cancelled = true;
    };
    // 同じファイルでも、書き換えられたら (turnId, at) が変わるので取り直す
  }, [turnId, file.volume, file.path, entry?.turnId, entry?.at]);

  return (
    <div className="file-view">
      <div className="file-view-title">{file.path}</div>
      {!entry ? (
        <div className="panel-empty">このターンの時点では存在しません</div>
      ) : error ? (
        <div className="status-note error">{error}</div>
      ) : content === null ? (
        <span className="pending">…</span>
      ) : file.path.endsWith('.md') ? (
        <Markdown text={content} />
      ) : (
        <pre className="json">{prettyJson(content)}</pre>
      )}
    </div>
  );
}

function groupByVolume(files: FileEntry[]): [string, FileEntry[]][] {
  const groups = new Map<string, FileEntry[]>();
  for (const file of files) groups.set(file.volume, [...(groups.get(file.volume) ?? []), file]);
  return [...groups];
}

/** volume の見出し。リソースは表示中のターンのグラフにあるノード名で表す */
function volumeLabel(volume: string, graph: GraphDefinition | undefined): string {
  if (volume === workfolderSpec.volume) return 'ワークフォルダ';
  const resource = graph?.nodes.find((n) => n.kind === 'resource' && resourceSpecOf(n).volume === volume);
  return resource?.kind === 'resource' ? `リソース: ${resource.config.name}` : volume;
}

/** パスを / で区切って木にする。同じ階層ではフォルダを先、ファイルを後に並べる */
function treeOf(entries: FileEntry[]): TreeNode[] {
  const root: TreeNode = { name: '', children: [] };
  for (const entry of entries) {
    const segments = entry.path.split('/');
    let parent = root;
    for (const segment of segments.slice(0, -1)) {
      let folder = parent.children.find((c) => c.name === segment && !c.entry);
      if (!folder) {
        folder = { name: segment, children: [] };
        parent.children.push(folder);
      }
      parent = folder;
    }
    parent.children.push({ name: segments.at(-1)!, entry, children: [] });
  }
  const sort = (nodes: TreeNode[]): TreeNode[] =>
    nodes
      .map((n) => ({ ...n, children: sort(n.children) }))
      .sort((a, b) => Number(!!a.entry) - Number(!!b.entry) || a.name.localeCompare(b.name));
  return sort(root.children);
}

function prettyJson(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}
