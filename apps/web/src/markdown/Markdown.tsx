import { createElement } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

/** Markdown のテキストを GFM（表・チェックリストなど）込みで表示する */
export function Markdown({ text, className }: { text: string; className?: string }) {
  return (
    <div className={`*:first:mt-0 *:last:mb-0 ${className ?? ''}`}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  );
}

const heading = 'mt-3 mb-1.5 font-bold';

// Tailwind が要素の既定の見た目（見出しの大きさ・箇条書きの記号など）を消すため、要素ごとに付け直す
const components: Components = {
  p:styled('p', 'my-1.5'),
  h1: styled('h1', `${heading} text-xl`),
  h2: styled('h2', `${heading} text-lg`),
  h3: styled('h3', `${heading} text-md`),
  h4: styled('h4', `${heading} text-md`),
  h5: styled('h5', heading),
  h6: styled('h6', heading),
  ul: styled('ul', 'my-1.5 list-disc pl-5'),
  ol: styled('ol', 'my-1.5 list-decimal pl-5'),
  blockquote: styled('blockquote', 'my-1.5 border-l-3 pl-2.5 text-muted'),
  hr: styled('hr', 'my-2'),
  code: styled('code', 'rounded-[3px] bg-surface-sub px-1 py-px text-sm'),
  pre: styled('pre', 'my-1.5 overflow-x-auto rounded bg-surface-sub p-2 [&>code]:bg-transparent [&>code]:p-0'),
  table: styled('table', 'my-1.5'),
  th: styled('th', 'border px-2 py-0.75'),
  td: styled('td', 'border px-2 py-0.75'),
  // 会話を見失わないよう、リンクは別タブで開く
  a: ({ node: _, ...props }) => <a {...props} className="text-accent underline" target="_blank" rel="noreferrer" />,
};

/** tag の要素に classes を付けて描画するコンポーネント。Markdown 由来のクラス（コードの言語など）は残す */
function styled(tag: string, classes: string) {
  return ({ node: _, className, ...props }: { node?: unknown; className?: string }) =>
    createElement(tag, { ...props, className: className ? `${classes} ${className}` : classes });
}
