import { memo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import styles from './chat.module.css';

/**
 * Markdown body of an ASSISTANT message (chat + workspace Q&A). User bubbles
 * stay plain text on purpose: pasted contract fragments full of `#`/`_` must
 * be echoed literally, not reinterpreted as markup.
 *
 * Safety: no rehype-raw — raw HTML in the model's output is never turned into
 * DOM, and react-markdown's default URL transform drops javascript: links.
 * memo: while one message streams, the finished siblings never re-parse.
 */
export const MarkdownMessage = memo(function MarkdownMessage({ text }: { text: string }) {
  return (
    <div className={styles.markdown} dir="auto">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer" />,
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
});
