/**
 * Граф документов фирмы (lib/docGraph.ts): допсоглашения, приложения и версии
 * узнаются по шапке; при сомнении связи нет.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const { docIdentity, buildDocGraph, normalizeDate, relatedLines } = await import('../src/lib/docGraph.ts');

const doc = (id: string, name: string, counterparty: string, status: string, text = '') => ({ id, name, counterparty, status, updated: '2025-06-01', text });

describe('что за документ', () => {
  it('даты: цифрами и словами', () => {
    assert.equal(normalizeDate('12.03.2025'), '2025-03-12');
    assert.equal(normalizeDate('«5» мая 2025 года'), '2025-05-05');
    assert.equal(normalizeDate('20 апреля 2025 г.'), '2025-04-20');
  });

  it('договор, допсоглашение, приложение', () => {
    assert.deepEqual(docIdentity('Договор поставки № 45 от 12.03.2025.docx', ''), { kind: 'contract', number: '45', date: '2025-03-12' });
    assert.deepEqual(docIdentity('ДС2.docx', 'ДОПОЛНИТЕЛЬНОЕ СОГЛАШЕНИЕ № 2 к Договору поставки № 45 от 12 марта 2025 г.\nг. Ташкент'), {
      kind: 'amendment',
      number: '2',
      ref: { number: '45', date: '2025-03-12' },
    });
    assert.deepEqual(docIdentity('Спецификация.pdf', 'Приложение № 1 (Спецификация) к договору № 45 от 12.03.2025'), {
      kind: 'annex',
      number: '1',
      ref: { number: '45', date: '2025-03-12' },
    });
    assert.equal(docIdentity('Договор оказания услуг № 45-У от 15.03.2025', '').number, '45-У');
  });

  it('упоминание приложения в теле договора не делает договор приложением', () => {
    const body = `ДОГОВОР ПОСТАВКИ № 45\nг. Ташкент 12.03.2025\n${'Поставщик обязуется поставить товар. '.repeat(10)}Приложение № 1 к Договору № 45 от 12.03.2025 является его неотъемлемой частью.`;
    assert.equal(docIdentity('Договор поставки (проект).docx', body).kind, 'contract');
  });
});

describe('связи между документами', () => {
  const docs = [
    doc('d45draft', 'Договор поставки № 45 от 12.03.2025 (проект)', 'ООО «Альфа Трейд»', 'Draft'),
    doc('d45', 'Договор поставки № 45 от 12.03.2025', 'ООО «Альфа Трейд»', 'Signed'),
    doc('ds1', 'Дополнительное соглашение № 1 к договору поставки № 45 от 12.03.2025', 'ООО «Альфа Трейд»', 'Signed'),
    doc('ds2', 'Дополнительное соглашение № 2 к договору поставки № 45 от 12.03.2025', 'ООО «Альфа Трейд»', 'Signed'),
    doc('pr1', 'Приложение № 1 к договору № 45 от 12.03.2025', 'ООО «Альфа Трейд»', 'Signed'),
    doc('d45u', 'Договор оказания услуг № 45-У от 15.03.2025', 'ООО «Альфа Трейд»', 'Signed'),
    doc('d7a', 'Договор аренды № 7', 'ИП Каримов', 'Signed'),
    doc('d7b', 'Договор хранения № 7', 'ООО «Бета»', 'Signed'),
    doc('ds7', 'Дополнительное соглашение № 1 к договору № 7', 'ИП Каримов', 'Signed'),
    doc('ds7x', 'Дополнительное соглашение № 3 к договору № 7', '', 'Signed'),
  ];
  const g = buildDocGraph(docs);
  const rel = (id: string) => g.relations.get(id)!;

  it('проект и подписанный — версии одного договора; допсоглашения — по порядку, к обеим версиям', () => {
    assert.deepEqual(rel('d45').versions, ['d45draft']);
    assert.deepEqual(rel('d45').amendments, ['ds1', 'ds2']);
    assert.deepEqual(rel('d45').annexes, ['pr1']);
    assert.deepEqual(rel('d45draft').amendments, ['ds1', 'ds2']);
    assert.equal(rel('ds2').base, 'd45', 'основа — подписанная версия');
  });

  it('«45-У» — другой договор', () => {
    assert.ok(!rel('d45').versions.includes('d45u'));
    assert.equal(rel('d45u').amendments.length, 0);
  });

  it('одинаковый номер у разных контрагентов: без даты решает контрагент, без контрагента — связи нет', () => {
    assert.equal(rel('ds7').base, 'd7a');
    assert.equal(rel('ds7x').base, undefined);
    assert.ok(!rel('d7b').amendments.includes('ds7'));
  });

  it('строки для модели и выключатель DOC_GRAPH=off', () => {
    const byId = new Map(docs.map((d) => [d.id, d]));
    const lines = relatedLines('d45', g, byId);
    assert.ok(lines.some((l) => l.startsWith('amendments') && l.indexOf('ds1') < l.indexOf('ds2')));
    process.env.DOC_GRAPH = 'off';
    try {
      assert.equal(buildDocGraph(docs).relations.get('d45')!.amendments.length, 0);
    } finally {
      delete process.env.DOC_GRAPH;
    }
  });
});
