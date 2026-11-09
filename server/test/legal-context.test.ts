/**
 * Контекст норм для модели (rag/context.ts, этап 3): вид акта у нормы УЗ и
 * правила выбора нормы перед списком; LEGAL_RULES=off — прежний вид.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const { formatLegalContext, uzActKind, UZ_PRIORITY_RULES } = await import('../src/rag/context.ts');
type Hit = Parameters<typeof formatLegalContext>[0][number];

const hit = (unitId: string, breadcrumb: string, actKind?: string): Hit => ({
  chunkId: `ch_${unitId}`,
  unitId,
  documentId: 'd',
  jurisdiction: 'UZ',
  breadcrumb,
  contextSummary: '',
  body: 'Текст нормы.',
  validFrom: null,
  validTo: null,
  sourceUrl: 'https://lex.uz/x',
  score: 1,
  actKind,
});

describe('контекст норм для модели', () => {
  it('вид акта по типу документа', () => {
    assert.equal(uzActKind('code', 'Трудовой кодекс Республики Узбекистан'), 'кодекс');
    assert.equal(uzActKind('act', 'Конституция Республики Узбекистан'), 'Конституция — высшая юридическая сила');
    assert.equal(uzActKind('plenum', 'Постановление Пленума ВС № 26'), 'постановление Пленума — разъяснение судебной практики');
    assert.equal(uzActKind('decree', 'УП-6079'), 'указ Президента');
  });

  it('УЗ: правила перед нормами, у каждой нормы — вид акта', () => {
    const ctx = formatLegalContext([hit('lu_uz_6257291_st-333', 'UZ / Трудовой кодекс / ст.333', 'кодекс')], 'UZ');
    assert.ok(ctx.startsWith('КАК ВЫБИРАТЬ НОРМУ'));
    assert.match(ctx, /\[lu_uz_6257291_st-333\] \(кодекс\) UZ \/ Трудовой кодекс/u);
  });

  it('другие страны — без правил УЗ; LEGAL_RULES=off — прежний вид', () => {
    assert.ok(!formatLegalContext([hit('lu_uk_x', 'UK / Act / s.1')], 'UK').includes('КАК ВЫБИРАТЬ'));
    process.env.LEGAL_RULES = 'off';
    try {
      assert.equal(formatLegalContext([hit('lu_uz_1', 'UZ / ГК / ст.1', 'кодекс')], 'UZ'), '[lu_uz_1] UZ / ГК / ст.1\nТекст нормы.');
    } finally {
      delete process.env.LEGAL_RULES;
    }
  });

  it('каждое правило ссылается на конкретную статью базы', () => {
    const ids = UZ_PRIORITY_RULES.match(/\[lu_uz_[^\]]+\]/g) ?? [];
    assert.deepEqual(
      [...new Set(ids)].sort(),
      ['[lu_uz_111181_st-2]', '[lu_uz_111181_st-3]', '[lu_uz_14643_st-2]', '[lu_uz_5378968_st-18]', '[lu_uz_5378968_st-6]', '[lu_uz_5378968_st-8]', '[lu_uz_5534928_st-25]'],
    );
  });
});
