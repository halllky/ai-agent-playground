import { useEffect, useState } from 'react';
import { Allotment, LayoutPriority } from 'allotment';
import type { TurnFiles } from 'protocol';
import { api } from '../api.ts';
import { useStore } from '../store.ts';
import { Markdown } from '../ui/Markdown.tsx';
import { CodeBlock, EmptyNote, ErrorNote } from '../ui/primitives.tsx';
import { FileTree } from './FileTree.tsx';

/**
 * 表示中のターン時点のワークフォルダの閲覧。ファイルはエージェントだけが書き込み、ここでは読み取り専用で表示する。
 * 実行中は、ツールの実行が終わるたびに取り直す。
 */
export function FilePanel() {
  const activeTurnId = useStore((s) => s.activeTurnId);
  // ターン中のファイルの変更はツールの実行で起きるので、ツールの結果の数を取り直す目印にする。
  // 設定から写した初期ファイルはツールを介さないため、ターンの終了でも取り直す
  const revision = useStore((s) => {
    const events = s.activeTurnId ? (s.events[s.activeTurnId] ?? []) : [];
    return `${events.filter((e) => e.type === 'tool.result').length}:${events.some((e) => e.type === 'turn.finish')}`;
  });
  const [{ files, changed }, setFiles] = useState<TurnFiles>(noFiles);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  const paths = Object.keys(files);
  const content = selected ? files[selected] : undefined;

  return (
    <div className="flex h-full flex-col border-l">
      <div className="border-b px-2.5 py-1.5 font-semibold">ワークフォルダ</div>
      <div className="min-h-0 flex-1">
        <Allotment vertical proportionalLayout={false}>
          <Allotment.Pane minSize={60} priority={LayoutPriority.Low}>
            <div className={paneBody}>
              {error && <ErrorNote>{error}</ErrorNote>}
              {paths.length === 0 && !error && <EmptyNote>まだファイルはありません</EmptyNote>}
              <FileTree paths={paths} changed={changed} selectedPath={selected} onSelect={setSelected} />
            </div>
          </Allotment.Pane>
          <Allotment.Pane minSize={60}>
            {selected ? (
              <div className={`${paneBody} border-t`}>
                <div className="mb-1 font-semibold break-all">{selected}</div>
                {content === undefined ? (
                  <EmptyNote>このターンの時点では存在しません</EmptyNote>
                ) : selected.endsWith('.md') ? (
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

const noFiles: TurnFiles = { files: {}, changed: [] };

function prettyJson(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}
