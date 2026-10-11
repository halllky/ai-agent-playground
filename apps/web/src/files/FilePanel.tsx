import { useEffect, useState } from 'react';
import { Allotment } from 'allotment';
import type { TurnFiles } from 'protocol';
import { api } from '../api.ts';
import { nodeTitle } from '../graph/kinds/index.ts';
import { Markdown } from '../ui/Markdown.tsx';
import { useSession } from '../session/store.ts';
import { CodeBlock, EmptyNote, ErrorNote } from '../ui/primitives.tsx';
import { FileTree, type FileRef } from './FileTree.tsx';

/**
 * 表示中のターン時点のファイルの閲覧。ファイルはエージェントだけが書き込み、ここでは読み取り専用で表示する。
 * 実行中は、ツールの実行が終わるたびに取り直す。
 */
export function FilePanel() {
  const activeTurn = useSession((s) => s.turns.find((t) => t.id === s.activeTurnId));
  // ターン中のファイルの変更はツールの実行で起きるので、ツールの結果の数を取り直す目印にする。
  // 設定から写した初期ファイルはツールを介さないため、ターンの終了でも取り直す
  const revision = useSession((s) => {
    const events = s.activeTurnId ? (s.events[s.activeTurnId] ?? []) : [];
    return `${events.filter((e) => e.type === 'tool.result').length}:${events.some((e) => e.type === 'turn.finish')}`;
  });
  const [{ files, changed }, setFiles] = useState<TurnFiles>(noFiles);
  const [selected, setSelected] = useState<FileRef | null>(null);
  const [error, setError] = useState<string | null>(null);

  const activeTurnId = activeTurn?.id;
  useEffect(() => {
    if (!activeTurnId) {
      setFiles(noFiles);
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
                  <FileTree
                    filesNodeId={filesNodeId}
                    paths={Object.keys(group)}
                    changed={changed[filesNodeId] ?? []}
                    selected={selected}
                    onSelect={setSelected}
                  />
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

const noFiles: TurnFiles = { files: {}, changed: {} };

function prettyJson(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}
