import { describe, expect, it } from 'vitest';
import { previewFromMarkdown } from './docPreviews';

describe('previewFromMarkdown', () => {
  it('first heading becomes the title, markup is stripped', () => {
    const p = previewFromMarkdown(
      '# ДОГОВОР О СОВМЕСТНОЙ ДЕЯТЕЛЬНОСТИ\n\n**г. Ташкент**\n\n- Срок: [12 месяцев](https://x.uz)\n1. Стороны — `ООО «Навбахор»`',
    );
    expect(p.title).toBe('ДОГОВОР О СОВМЕСТНОЙ ДЕЯТЕЛЬНОСТИ');
    expect(p.text).toBe('г. Ташкент\nСрок: 12 месяцев\n1. Стороны — ООО «Навбахор»');
  });

  it('tables: separators dropped, cells kept', () => {
    const p = previewFromMarkdown('| Пункт | Срок |\n|---|---|\n| Оплата | 30 дней |');
    expect(p.title).toBeUndefined();
    expect(p.text).toBe('Пункт  Срок\nОплата  30 дней');
  });

  it('long text is capped at 600 chars with an ellipsis', () => {
    const p = previewFromMarkdown(`# Акт\n\n${'текст '.repeat(300)}`);
    expect(p.text.length).toBeLessThanOrEqual(600);
    expect(p.text.endsWith('…')).toBe(true);
  });

  it('empty content → empty preview', () => {
    expect(previewFromMarkdown('   \n\n')).toEqual({ text: '' });
  });
});
