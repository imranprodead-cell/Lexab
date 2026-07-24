import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MarkdownMessage } from './MarkdownMessage';

const render = (text: string) => renderToStaticMarkup(<MarkdownMessage text={text} />);

describe('MarkdownMessage', () => {
  it('renders bold and GFM tables as elements', () => {
    const html = render('**важно**\n\n| Пункт | Риск |\n| --- | --- |\n| 6.2 | высокий |');
    expect(html).toContain('<strong>важно</strong>');
    expect(html).toContain('<table>');
    expect(html).toContain('<th>Пункт</th>');
    expect(html).toContain('<td>высокий</td>');
  });

  it('renders headings and lists', () => {
    const html = render('### Раздел\n\n- пункт один\n- пункт два');
    expect(html).toContain('<h3>Раздел</h3>');
    expect(html).toContain('<li>пункт один</li>');
    // Markdown symbols themselves must not leak through as text.
    expect(html).not.toContain('###');
    expect(html).not.toContain('- пункт');
  });

  it('never turns raw HTML from the model into DOM (XSS)', () => {
    const html = render('до <script>alert(1)</script> после <img src=x onerror=alert(2)>');
    // Raw HTML must come out as escaped TEXT, never as real elements/attributes.
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&lt;img');
  });

  it('sanitizes javascript: links and hardens external links', () => {
    const html = render('[кликни](javascript:alert(1)) и [сайт](https://example.com)');
    expect(html).not.toContain('javascript:');
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain('target="_blank"');
  });
});
