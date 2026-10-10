import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

/** Markdown のテキストを GFM（表・チェックリストなど）込みで表示する */
export function Markdown({ text, className }: { text: string; className?: string }) {
  return (
    <div className={`markdown ${className ?? ''}`}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  );
}

const components: Components = {
  // 会話を見失わないよう、リンクは別タブで開く
  a: ({ node: _, ...props }) => <a {...props} target="_blank" rel="noreferrer" />,
};
