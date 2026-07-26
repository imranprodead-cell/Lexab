import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';

/**
 * Скачивание ответа ИИ «как в чате»: тот же markdown-конвейер, что в
 * MarkdownMessage (react-markdown + gfm + breaks), рендерится в статический
 * HTML и заворачивается в самодостаточный документ со светлой темой —
 * зашитые цвета из global.css, правила из .markdown в chat.module.css.
 *
 * Безопасность зеркалит MarkdownMessage: сырой HTML модели не исполняется
 * (нет rehype-raw — React экранирует весь текст), картинки нейтрализованы
 * до alt-текста, ссылки получают rel="noopener noreferrer".
 *
 * Модуль импортируется ТОЛЬКО динамически (по клику «Скачать») — иначе
 * react-dom/server попадёт в основной бандл.
 */

const CSS = `
body {
  margin: 0;
  background: #fff;
  color: #17171c;
  font: 15px/1.6 'Instrument Sans', system-ui, -apple-system, sans-serif;
}
.markdown {
  max-width: 720px;
  margin: 0 auto;
  padding: 32px 20px;
  word-break: break-word;
}
.markdown > :first-child { margin-top: 0; }
.markdown > :last-child { margin-bottom: 0; }
.markdown p, .markdown ul, .markdown ol, .markdown table, .markdown pre, .markdown blockquote {
  margin: 0 0 10px;
}
.markdown h1, .markdown h2, .markdown h3, .markdown h4, .markdown h5, .markdown h6 {
  margin: 14px 0 6px;
  font-weight: 650;
  line-height: 1.35;
}
.markdown h1 { font-size: 1.15em; }
.markdown h2 { font-size: 1.08em; }
.markdown h3, .markdown h4, .markdown h5, .markdown h6 { font-size: 1em; }
.markdown ul, .markdown ol { padding-inline-start: 22px; }
.markdown li { margin-bottom: 4px; }
.markdown li > ul, .markdown li > ol { margin: 4px 0 0; }
.markdown code {
  background: rgba(0, 0, 0, 0.05);
  border-radius: 5px;
  padding: 1px 5px;
  font-size: 0.92em;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
.markdown pre {
  background: #ededf1;
  border: 1px solid #e4e4ea;
  border-radius: 10px;
  padding: 10px 12px;
  overflow-x: auto;
}
.markdown pre code { background: none; padding: 0; }
.markdown table { border-collapse: collapse; max-width: 100%; }
.markdown th, .markdown td {
  border: 1px solid #e4e4ea;
  padding: 5px 10px;
  text-align: start;
  vertical-align: top;
}
.markdown th { background: rgba(0, 0, 0, 0.05); font-weight: 600; }
.markdown blockquote {
  border-inline-start: 3px solid #8b7cf6;
  padding-inline-start: 12px;
  color: #5a5a66;
}
.markdown a { color: #8b7cf6; }
.markdown hr { border: none; border-top: 1px solid #e4e4ea; margin: 12px 0; }
@media print {
  .markdown { padding: 0; max-width: none; }
}
`;

/** Полный самодостаточный HTML-документ одного ответа ассистента. */
export function renderMessageHtml(markdown: string): string {
  const body = renderToStaticMarkup(
    createElement(
      ReactMarkdown,
      {
        remarkPlugins: [remarkGfm, remarkBreaks],
        components: {
          a: ({ node: _node, ...rest }) => createElement('a', { ...rest, target: '_blank', rel: 'noopener noreferrer' }),
          img: (p) => (p.alt ? createElement('span', null, p.alt) : null),
        },
      },
      markdown,
    ),
  );
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Lexab</title>
<style>${CSS}</style>
</head>
<body>
<article class="markdown" dir="auto">${body}</article>
</body>
</html>
`;
}
