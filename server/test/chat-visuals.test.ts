import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeChart, normalizeSteps, normalizeTimeline, numbersIn, placeVisuals, unverifiedValues, visualBlock, VisualInputError, type Visual } from '../src/lib/chatVisuals.ts';

const iso = (s: string) => s;
const parseDate = (s: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s) ?? /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(s);
  if (!m) throw new Error('bad date');
  return s.includes('-') ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : new Date(Date.UTC(+m[3], +m[2] - 1, +m[1]));
};
const addPeriod = (d: Date, y: number, mo: number, days: number) => {
  const x = new Date(d);
  x.setUTCFullYear(x.getUTCFullYear() + y, x.getUTCMonth() + mo, x.getUTCDate() + days);
  return x;
};

describe('chatVisuals: placement', () => {
  const chart: Visual = { kind: 'chart', data: { title: 'Пеня', kind: 'bar', labels: ['a', 'b'], series: [{ name: '', values: [1, 2] }] } };
  const steps: Visual = { kind: 'steps', data: { steps: [{ title: 'Претензия' }, { title: 'Иск' }] } };

  it('a marker is replaced by its block as a separate paragraph; text around stays as written', () => {
    const out = placeVisuals('До графика.\n[[lexab:1]]\nПосле графика.\n\n```\nДОГОВОР\n\n\n1. Пункт\n```', [chart]);
    assert.ok(out.startsWith('До графика.\n\n```lexab-chart\n'));
    assert.ok(out.includes('```\n\nПосле графика.'));
    assert.ok(out.includes('ДОГОВОР\n\n\n1. Пункт'), 'blank lines inside a document are untouched');
  });

  it('a block without a marker goes to the end; stray and repeated markers vanish', () => {
    const out = placeVisuals('Текст [[lexab:2]] и [[lexab:9]] дальше. [[lexab:2]]', [chart, steps]);
    assert.equal((out.match(/```lexab-steps/g) ?? []).length, 1);
    assert.ok(!out.includes('[[lexab'));
    assert.ok(out.endsWith(visualBlock(chart)), 'unplaced chart appended at the end');
  });

  it('no visuals and no markers — reply untouched', () => {
    assert.equal(placeVisuals('a\n\n\n\nb', []), 'a\n\n\n\nb');
  });

  it('backticks inside data cannot close the block early', () => {
    const v: Visual = { kind: 'steps', data: { steps: [{ title: 'шаг ```x' }, { title: 'два' }] } };
    assert.equal((visualBlock(v).match(/```/g) ?? []).length, 2);
  });
});

describe('chatVisuals: numbers of a chart must be known', () => {
  it('reads grouped, decimal and comma numbers', () => {
    const ns = numbersIn('240 000 000 * 0.5/100 * 30 = 36000000 (36 000 000); ставка 12,5%; 1,234');
    for (const n of [240000000, 0.5, 100, 30, 36000000, 12.5, 1234, 1.234]) assert.ok(ns.includes(n), String(n));
  });

  it('accepts exact, rounded (0.5%) and rescaled values (thousands, millions, percent); rejects invented ones', () => {
    const known = [36000000, 1200000, 0.05];
    assert.deepEqual(unverifiedValues([36000000, 36.0, 1.2, 1200, 5, 0], known), []);
    assert.deepEqual(unverifiedValues([36100000, 777], known), [36100000, 777]);
  });
});

describe('chatVisuals: input normalization', () => {
  it('timeline: dates computed from anchors, sorted by date', () => {
    const t = normalizeTimeline(
      {
        title: 'Сроки',
        events: [
          { label: 'Поставка', date: '01.11.2026' },
          { label: 'Срок оплаты', after: 1, days: 30 },
          { label: 'Ответ на претензию', after: 2, days: 10 },
          { label: 'Подписание', date: '2026-10-15' },
        ],
      },
      parseDate,
      addPeriod,
    );
    assert.deepEqual(
      t.events.map((e) => `${e.date} ${e.label}`),
      ['2026-10-15 Подписание', '2026-11-01 Поставка', '2026-12-01 Срок оплаты', '2026-12-11 Ответ на претензию'],
    );
  });

  it('timeline: «after» must point to an EARLIER event', () => {
    assert.throws(() => normalizeTimeline({ events: [{ label: 'a', after: 2, days: 1 }, { label: 'b', date: '2026-01-01' }] }, parseDate, addPeriod), VisualInputError);
    assert.throws(() => normalizeTimeline({ events: [{ label: 'a' }, { label: 'b', date: '2026-01-01' }] }, parseDate, addPeriod), VisualInputError);
  });

  it('steps: 2–10, title required, dates normalized', () => {
    const s = normalizeSteps({ steps: [{ title: ' Претензия ', date: '25.11.2026', docs: ['Договор'] }, { title: 'Иск' }] }, (d) => iso(parseDate(d).toISOString().slice(0, 10)));
    assert.deepEqual(s.steps[0], { title: 'Претензия', date: '2026-11-25', docs: ['Договор'] });
    assert.throws(() => normalizeSteps({ steps: [{ title: 'один' }] }, (d) => d), VisualInputError);
    assert.throws(() => normalizeSteps({ steps: [{ detail: 'x' }, { title: 'y' }] }, (d) => d), VisualInputError);
  });

  it('chart: bar has one series, line up to three; value count matches labels', () => {
    assert.throws(() => normalizeChart({ title: 'x', kind: 'bar', labels: ['a', 'b'], series: [{ values: [1, 2] }, { values: [3, 4] }] }), VisualInputError);
    assert.throws(() => normalizeChart({ title: 'x', kind: 'line', labels: ['a', 'b'], series: [{ values: [1] }] }), VisualInputError);
    assert.throws(() => normalizeChart({ title: 'x', kind: 'pie', labels: ['a', 'b'], series: [{ values: [1, 2] }] }), VisualInputError);
    const c = normalizeChart({ title: 'Долг', kind: 'line', unit: 'сум', labels: ['янв', 'фев'], series: [{ name: 'A', values: [1, 2] }, { name: 'B', values: [3, 4] }] });
    assert.equal(c.series.length, 2);
  });
});
