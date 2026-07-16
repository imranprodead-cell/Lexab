// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import type { DocSegment } from '@/types/domain';
import { htmlToSegments, sanitizeHref, segmentsToHtml, segmentsToPlainText } from './richText';

const resolve = (id: string) => `[${id}]`;

/** Parse an HTML string into a container node the way the editor would hold it. */
function parse(html: string): HTMLElement {
  const div = document.createElement('div');
  div.innerHTML = html;
  return div;
}

/** Full editor round-trip: model → HTML → model. */
function roundTrip(segments: DocSegment[]): DocSegment[] {
  return htmlToSegments(parse(segmentsToHtml(segments, resolve)));
}

describe('richText — HTML escaping', () => {
  it('escapes dangerous characters so contract text can never inject markup', () => {
    const html = segmentsToHtml(['a <script>x</script> & "b"'], resolve);
    // The raw tag must be neutralised (no live <script> element in the string).
    expect(html).not.toMatch(/<script>/);
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&amp;');
    expect(html).toContain('&quot;');
    // And it survives the round-trip as the original text.
    expect(roundTrip(['5 < 6 & "x" > 4'])).toEqual(['5 < 6 & "x" > 4']);
  });
});

describe('richText — link safety', () => {
  it('drops javascript: and data: schemes, keeps http(s)/mailto/relative', () => {
    expect(sanitizeHref('javascript:alert(1)')).toBeUndefined();
    expect(sanitizeHref('  JAVASCRIPT:alert(1)')).toBeUndefined();
    expect(sanitizeHref('data:text/html,<script>')).toBeUndefined();
    expect(sanitizeHref('https://example.com')).toBe('https://example.com');
    expect(sanitizeHref('mailto:a@b.com')).toBe('mailto:a@b.com');
    expect(sanitizeHref('/docs/2')).toBe('/docs/2');
    expect(sanitizeHref('example.com/x')).toBe('https://example.com/x');
  });

  it('a stored javascript: href never reaches the editor HTML or the model', () => {
    const html = segmentsToHtml([{ text: 'click', href: 'javascript:alert(1)' }], resolve);
    expect(html).not.toContain('javascript:');
    expect(html).toBe('click'); // no anchor at all
    const back = htmlToSegments(parse('<a href="javascript:alert(1)">click</a>'));
    expect(back).toEqual(['click']); // href stripped, plain text kept
  });
});

describe('richText — non-breaking spaces and line breaks', () => {
  it('preserves non-breaking spaces (meaningful in legal text)', () => {
    const nbsp = ' ';
    const back = htmlToSegments(parse(`art.${nbsp}5`));
    expect(back).toEqual([`art.${nbsp}5`]);
  });

  it('a line break before/after a block element is preserved (not glued)', () => {
    // Chrome's first-Enter pattern: a bare text node followed by a <div>.
    expect(htmlToSegments(parse('Payment due:<div>within 30 days</div>'))).toEqual(['Payment due:\nwithin 30 days']);
    expect(htmlToSegments(parse('<div>a</div><div>b</div>'))).toEqual(['a\nb']);
  });
});

describe('richText — explicit un-formatting is honored', () => {
  it('nested font-weight:normal inside bold clears bold on the inner text', () => {
    const node = parse('<span style="font-weight:700">Payment <span style="font-weight:400">optional</span></span>');
    expect(htmlToSegments(node)).toEqual([{ text: 'Payment ', marks: ['b'] }, 'optional']);
  });

  it('text-decoration:none inside a struck run clears strikethrough', () => {
    const node = parse('<s>gone <span style="text-decoration:none">kept</span></s>');
    expect(htmlToSegments(node)).toEqual([{ text: 'gone ', marks: ['s'] }, 'kept']);
  });
});

describe('richText — round-trip of formatting', () => {
  it('plain text stays a bare string (backward-compatible with old documents)', () => {
    expect(roundTrip(['Just plain wording.'])).toEqual(['Just plain wording.']);
  });

  it('bold / italic / underline / strikethrough survive', () => {
    const segs: DocSegment[] = [
      'The ',
      { text: 'Company', marks: ['b'] },
      ' shall ',
      { text: 'not', marks: ['i', 'u'] },
      ' be ',
      { text: 'liable', marks: ['s'] },
      '.',
    ];
    expect(roundTrip(segs)).toEqual(segs);
  });

  it('a hyperlink survives with its href', () => {
    const segs: DocSegment[] = ['See ', { text: 'Schedule 2', href: 'https://example.com/s2' }, '.'];
    expect(roundTrip(segs)).toEqual(segs);
  });

  it('reads formatting from inline styles too (execCommand may emit styles, not tags)', () => {
    const node = parse('normal <span style="font-weight:700">heavy</span> <span style="text-decoration: line-through">gone</span>');
    expect(htmlToSegments(node)).toEqual(['normal ', { text: 'heavy', marks: ['b'] }, ' ', { text: 'gone', marks: ['s'] }]);
  });

  it('merges adjacent runs with identical formatting', () => {
    const node = parse('<b>Ab</b><b>cd</b> e');
    expect(htmlToSegments(node)).toEqual([{ text: 'Abcd', marks: ['b'] }, ' e']);
  });

  it('normalizes mark order deterministically', () => {
    const node = parse('<u><b>x</b></u>'); // authored u-outside-b
    expect(htmlToSegments(node)).toEqual([{ text: 'x', marks: ['b', 'u'] }]);
  });
});

describe('richText — redline slots are preserved through editing (legal core)', () => {
  it('a paragraph with a redline slot survives a format-and-save round trip with the slot intact', () => {
    const segs: DocSegment[] = ['The Company ', { redlineId: 'r1' }, ' the Services within ', { text: '30 days', marks: ['b'] }, '.'];
    const out = roundTrip(segs);
    // The slot is still there, in place, unchanged…
    expect(out).toContainEqual({ redlineId: 'r1' });
    expect(out[1]).toEqual({ redlineId: 'r1' });
    // …and the surrounding formatting is preserved.
    expect(out).toContainEqual({ text: '30 days', marks: ['b'] });
    // Full shape is stable.
    expect(out).toEqual(segs);
  });

  it('editing text around a redline never descends into or splits the atom', () => {
    // The atom carries resolved text, but serialization ignores its inner text.
    const html = segmentsToHtml([{ redlineId: 'r9' }], (id) => `resolved ${id} text`);
    const node = parse(html);
    // Simulate the user typing bold text right after the atom.
    node.insertAdjacentHTML('beforeend', '<b>added</b>');
    expect(htmlToSegments(node)).toEqual([{ redlineId: 'r9' }, { text: 'added', marks: ['b'] }]);
  });
});

describe('richText — plain text helper', () => {
  it('flattens marks and resolves slots', () => {
    const segs: DocSegment[] = ['a ', { text: 'b', marks: ['b'] }, { redlineId: 'r1' }];
    expect(segmentsToPlainText(segs, resolve)).toBe('a b[r1]');
  });
});
