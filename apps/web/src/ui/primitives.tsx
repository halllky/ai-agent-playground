import { useState, type ReactNode } from 'react';

/** パネルに表示するものがないときの案内 */
export function EmptyNote({ children }: { children: ReactNode }) {
  return <div className="p-3 text-muted">{children}</div>;
}

/** 処理の失敗を伝える一文 */
export function ErrorNote({ children }: { children: ReactNode }) {
  return <div className="text-sm text-danger">{children}</div>;
}

/** 読み込み中・応答待ちの印 */
export function Pending() {
  return <span className="text-muted">…</span>;
}

/** 折りたたみ欄。中身は大きくなりうるので、開いている間だけ描画する */
export function Disclosure({ className, summary, children }: { className?: string; summary: ReactNode; children: () => ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <details className={className} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary className="cursor-pointer text-muted select-none">{summary}</summary>
      {open && children()}
    </details>
  );
}

/** JSON などの整形済みテキスト。長い行は折り返す */
export function CodeBlock({ text }: { text: string }) {
  return <pre className="my-1 max-h-[400px] overflow-auto rounded bg-surface-sub p-1.5 text-sm break-all whitespace-pre-wrap">{text}</pre>;
}
