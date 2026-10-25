import { memo, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import { tStandalone } from '@/i18n/messages';
import {
  docKey,
  docTitle,
  headingBefore,
  isBigTable,
  isDocBlock,
  parseMarkdownTable,
  tableKey,
  type Artifact,
} from '@/lib/artifacts';
import { DocArtifactCard, TableArtifactCard } from './ArtifactCards';
import styles from './chat.module.css';

interface MarkdownMessageProps {
  text: string;
  /** С ним длинные блоки ```…``` и большие таблицы становятся карточками,
   *  открывающимися в боковой панели (только в чате). */
  messageId?: string;
  onOpenArtifact?: (a: Artifact) => void;
}

interface Positioned {
  position?: { start: { offset?: number }; end: { offset?: number } };
}

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
 * memo: while one message streams, the finished siblings never re-parse
 * (onOpenArtifact must therefore be a stable callback).
 */
export const MarkdownMessage = memo(function MarkdownMessage({ text, messageId, onOpenArtifact }: MarkdownMessageProps) {
  // Без хука переводов: компонент рендерится и вне I18nProvider (тесты,
  // встраивания); подписи-заглушки берутся из сохранённого языка.
  const t = tStandalone;
  const withArtifacts = Boolean(messageId && onOpenArtifact);
  // Исходный Markdown узла — по позициям, которые react-markdown даёт каждому
  // элементу: так карточка получает ровно тот текст, что и разбор для панели.
  const source = (node: Positioned | undefined): { raw: string; before: string } | null => {
    const start = node?.position?.start.offset;
    const end = node?.position?.end.offset;
    if (start === undefined || end === undefined) return null;
    return { raw: text.slice(start, end), before: text.slice(0, start) };
  };

  return (
    <div className={styles.markdown} dir="auto">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks]}
        components={{
          a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer" />,
          img: (p) => (p.alt ? <span>{p.alt}</span> : null),
          pre: ({ node, children, ...props }): ReactNode => {
            const src = withArtifacts ? source(node as Positioned) : null;
            if (src) {
              const lines = src.raw.split('\n');
              const lang = /^\s*(?:```+|~~~+)\s*([\w-]*)/.exec(lines[0])?.[1] ?? '';
              const closed = lines.length > 1 && /^\s*(```+|~~~+)\s*$/.test(lines[lines.length - 1]);
              const content = lines.slice(1, closed ? -1 : undefined).join('\n');
              if (isDocBlock(content, lang)) {
                const title = docTitle(content, src.before, t('artifact.document'));
                return (
                  <DocArtifactCard
                    title={title}
                    content={content.trim()}
                    onOpen={() =>
                      onOpenArtifact?.({ kind: 'doc', key: docKey(messageId as string, content), title, content: content.trim() })
                    }
                  />
                );
              }
            }
            return <pre {...props}>{children}</pre>;
          },
          table: ({ node, children, ...props }): ReactNode => {
            const src = withArtifacts ? source(node as Positioned) : null;
            const parsed = src ? parseMarkdownTable(src.raw) : null;
            if (src && parsed && isBigTable(parsed)) {
              const title = headingBefore(src.before) ?? t('artifact.table');
              return (
                <TableArtifactCard
                  title={title}
                  header={parsed.header}
                  rows={parsed.rows}
                  onOpen={() =>
                    onOpenArtifact?.({ kind: 'table', key: tableKey(messageId as string, parsed), title, ...parsed })
                  }
                />
              );
            }
            return <table {...props}>{children}</table>;
          },
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
});
