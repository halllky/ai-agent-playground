/** ワークフォルダのファイルを、パスの / で区切ったフォルダの木で表示する。changed のパスには印を付ける */
export function FileTree(props: { paths: string[]; changed: string[]; selectedPath: string | null; onSelect: (path: string) => void }) {
  const { paths, changed, selectedPath, onSelect } = props;
  const changedPaths = new Set(changed);
  return <Folder nodes={treeOf(paths)} isChanged={(path) => changedPaths.has(path)} selectedPath={selectedPath} onSelect={onSelect} />;
}

/** パスを / で区切った木の1要素。ファイルなら path を、フォルダなら children を持つ */
type TreeNode = { name: string; path?: string; children: TreeNode[] };

function Folder(props: { nodes: TreeNode[]; isChanged: (path: string) => boolean; selectedPath: string | null; onSelect: (path: string) => void }) {
  const { nodes, isChanged, selectedPath, onSelect } = props;
  return (
    <ul>
      {nodes.map(({ name, path, children }) =>
        path !== undefined ? (
          <li key={`file:${name}`}>
            <button
              type="button"
              className={`flex w-full items-center gap-1 border-0 px-1 py-px text-left ${
                path === selectedPath ? 'bg-highlight' : 'bg-transparent hover:bg-surface-sub'
              }`}
              onClick={() => onSelect(path)}
            >
              {name}
              {isChanged(path) && (
                <span className="text-3xs text-accent" title="このターンで追加・変更されたファイル">
                  ●
                </span>
              )}
            </button>
          </li>
        ) : (
          <li key={`folder:${name}`}>
            <details open>
              <summary>{name}/</summary>
              <div className="pl-3">
                <Folder {...props} nodes={children} />
              </div>
            </details>
          </li>
        ),
      )}
    </ul>
  );
}

/** パスを / で区切って木にする。同じ階層ではフォルダを先、ファイルを後に並べる */
function treeOf(paths: string[]): TreeNode[] {
  const root: TreeNode = { name: '', children: [] };
  for (const path of paths) {
    const segments = path.split('/');
    let parent = root;
    for (const segment of segments.slice(0, -1)) {
      let folder = parent.children.find((c) => c.name === segment && c.path === undefined);
      if (!folder) {
        folder = { name: segment, children: [] };
        parent.children.push(folder);
      }
      parent = folder;
    }
    parent.children.push({ name: segments.at(-1)!, path, children: [] });
  }
  const isFile = (node: TreeNode) => Number(node.path !== undefined);
  const sort = (nodes: TreeNode[]): TreeNode[] =>
    nodes.map((n) => ({ ...n, children: sort(n.children) })).sort((a, b) => isFile(a) - isFile(b) || a.name.localeCompare(b.name));
  return sort(root.children);
}
