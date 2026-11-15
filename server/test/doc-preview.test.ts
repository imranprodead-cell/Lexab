import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PREVIEW_CHARS, previewFromBlocks, previewFromText, redlineIdsIn } from '../src/lib/docPreview.ts';
import type { DocBlock } from '../src/types.ts';

describe('docPreview', () => {
  it('blocks: heading becomes the title, redlines show the ORIGINAL wording', () => {
    const blocks: DocBlock[] = [
      { type: 'heading', text: 'ДОГОВОР ПОСТАВКИ № 14' },
      { type: 'paragraph', segments: ['г. Ташкент   ', { text: '01.11.2026', marks: ['b'] }] },
      { type: 'paragraph', segments: ['Срок оплаты — ', { redlineId: 'r1' }, ' дней.'] },
    ];
    assert.deepEqual(redlineIdsIn(blocks), ['r1']);
    const p = previewFromBlocks(blocks, new Map([['r1', '90']]));
    assert.equal(p.title, 'ДОГОВОР ПОСТАВКИ № 14');
    assert.equal(p.text, 'г. Ташкент 01.11.2026\nСрок оплаты — 90 дней.');
  });

  it('blocks: an ordinary first sentence is not taken for a title', () => {
    const p = previewFromBlocks([{ type: 'paragraph', segments: ['Стороны договорились о следующем, а именно: поставщик передаёт товар покупателю в срок.'] }], new Map());
    assert.equal(p.title, undefined);
    assert.ok(p.text.startsWith('Стороны'));
  });

  it('text: capped at PREVIEW_CHARS on a word boundary with an ellipsis', () => {
    const long = `Договор аренды\n\n${'слово '.repeat(400)}`;
    const p = previewFromText(long);
    assert.equal(p.title, 'Договор аренды');
    assert.ok(p.text.length <= PREVIEW_CHARS);
    assert.ok(p.text.endsWith('…'));
    assert.ok(!p.text.includes('слов…'), 'cut on a word boundary');
  });

  it('empty input → empty preview', () => {
    assert.deepEqual(previewFromText('  \n  '), { text: '' });
    assert.deepEqual(previewFromBlocks([], new Map()), { text: '' });
  });
});
