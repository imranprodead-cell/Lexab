import { memo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import styles from './chat.module.css';

/**
 * Markdown body of an ASSISTANT message (chat + workspace Q&A). User bubbles
 * stay plain text on purpose: pasted contract fragments full of `#`/`_` must
 * be echoed literally, not reinterpreted as markup.
 *
 * Safety: no rehype-raw — raw HTML in the model's output is never turned into
 * DOM, and react-markdown's default URL transform drops javascript: links.
 * Markdown IMAGES are neutralized too (alt text only): a live <img> would GET
 * an arbitrary host — an IP leak and the classic markdown-image exfiltration
 * channel for prompt-injected replies.
 * remark-breaks: a single \n renders as a line break (ChatGPT behaviour) —
 * also keeps pre-markdown-era saved replies from collapsing into run-on text.
 * memo: while one message streams, the finished siblings never re-parse.
 */
export const MarkdownMessage = memo(function MarkdownMessage({ text }: { text: string }) {
  return (
    <div className={styles.markdown} dir="auto">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks]}
        components={{
          a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer" />,
          img: (p) => (p.alt ? <span>{p.alt}</span> : null),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
});
