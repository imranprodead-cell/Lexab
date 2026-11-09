/**
 * Карта связей между нормами (rag/links.ts): связь пишется только по явной
 * ссылке в официальном тексте и только если цель есть в базе.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const { expandNumbers, findArticleRefs, isInternalTail, findAbbreviations, abbreviationFromTitle, expandAbbreviation, LinkResolver, linksFromUnit, cocitedLinks, sentenceAround } =
  await import('../src/rag/links.ts');

describe('цитата-основание', () => {
  it('в длинном предложении цитата — окно вокруг ссылки, ссылка в него попадает', () => {
    const long = `${'Обратить внимание судов на то, что вопросы регулируются '.repeat(12)}статьей 527 Трудового кодекса, а также иными актами.`;
    const at = long.indexOf('статьей 527');
    const q = sentenceAround(long, at, at + 11);
    assert.ok(q.length <= 302);
    assert.match(q, /статьей 527 Трудового кодекса/u);
    assert.ok(q.startsWith('…'));
  });
});

const DOCS = [
  { id: 'gk1', title: 'Гражданский кодекс Республики Узбекистан (часть первая)', docType: 'code' },
  { id: 'gk2', title: 'Гражданский кодекс Республики Узбекистан (часть вторая)', docType: 'code' },
  { id: 'gpk', title: 'Гражданский процессуальный кодекс Республики Узбекистан', docType: 'code' },
  { id: 'tk', title: 'Трудовой кодекс Республики Узбекистан', docType: 'code' },
  { id: 'dpb', title: '670-I-сон 29.08.1998. О договорно-правовой базе деятельности хозяйствующих субъектов', docType: 'act' },
  { id: 'pl', title: 'Постановление Пленума ВХС № 163', docType: 'plenum' },
];
const UNITS = [
  ...['263', '326', '327', '333', '356'].map((n) => ({ id: `gk1_st-${n}`, documentId: 'gk1', number: n })),
  ...['416', '420', '434', '451', '736'].map((n) => ({ id: `gk2_st-${n}`, documentId: 'gk2', number: n })),
  { id: 'gpk_st-327', documentId: 'gpk', number: '327' },
  { id: 'tk_st-333', documentId: 'tk', number: '333' },
  ...['24', '25', '26', '27', '28'].map((n) => ({ id: `dpb_st-${n}`, documentId: 'dpb', number: n })),
  { id: 'dpb_st-383-1', documentId: 'dpb', number: '383-1' },
];
const resolver = new LinkResolver(DOCS, UNITS);

describe('номера статей в ссылке', () => {
  it('список «12, 13 и 15», диапазон «25 — 32», вставная статья «383-1»', () => {
    assert.deepEqual(expandNumbers('12, 13 и 15'), ['12', '13', '15']);
    assert.deepEqual(expandNumbers('25 — 28'), ['25', '26', '27', '28']);
    assert.deepEqual(expandNumbers('383-1'), ['383-1']);
    assert.deepEqual(expandNumbers('10 - 12'), ['10', '11', '12']);
    assert.deepEqual(expandNumbers('5 — 400'), ['5', '400'], 'слишком длинный диапазон не разворачиваем');
  });

  it('находит ссылки и обрезает хвост до следующей ссылки', () => {
    const refs = findArticleRefs('В соответствии со статьей 26 Закона и статьей 434 ГК покупатель вправе.');
    assert.equal(refs.length, 2);
    assert.deepEqual(refs[0].numbers, ['26']);
    assert.match(refs[0].tail, /^\s*Закона и\s*$/u);
    assert.deepEqual(refs[1].numbers, ['434']);
    assert.match(refs[1].tail, /ГК покупатель вправе/u);
  });

  it('«ст.» и «статьями … настоящего Закона»', () => {
    const [a] = findArticleRefs('законную неустойку (ст. 263 ГК РУз), а также убытки');
    assert.deepEqual(a.numbers, ['263']);
    const [b] = findArticleRefs('Меры ответственности, предусмотренные статьями 25 — 28 настоящего Закона, применяются');
    assert.deepEqual(b.numbers, ['25', '26', '27', '28']);
    assert.equal(isInternalTail(b.tail), true);
  });
});

describe('сокращения документа', () => {
  it('«Закона "О договорно-правовой базе…" (далее — Закон)» → полное название', () => {
    const ab = findAbbreviations('применения Закона Республики Узбекистан «О договорно-правовой базе деятельности хозяйствующих субъектов» (далее — Закон) судам');
    assert.equal(ab.get('Закон'), 'О договорно-правовой базе деятельности хозяйствующих субъектов');
    assert.equal(expandAbbreviation(' Закона применяются', ab), '«О договорно-правовой базе деятельности хозяйствующих субъектов»');
    assert.equal(expandAbbreviation(' ГК', ab), ' ГК', 'чужое сокращение не трогаем');
  });

  it('«Закон» из названия Пленума — только если закон в названии один', () => {
    assert.equal(
      abbreviationFromTitle('Постановление Пленума ВХС № 103 «О некоторых вопросах практики применения экономическими судами Закона Республики Узбекистан «О договорно-правовой базе деятельности хозяйствующих субъектов»»'),
      'О договорно-правовой базе деятельности хозяйствующих субъектов',
    );
    assert.equal(abbreviationFromTitle('Постановление Пленума ВХС № 174 «О порядке разрешения споров, связанных с поставкой продукции»'), null);
    assert.equal(abbreviationFromTitle('… Закона «О залоге» и Закона «Об ипотеке»'), null);
  });
});

describe('резолвер связей', () => {
  it('ГК: номер выбирает часть; «ГК» не уезжает в ГПК; ТК ≠ ГК', () => {
    assert.equal(resolver.external('327', 'ГК', 'UZ'), 'gk1_st-327');
    assert.equal(resolver.external('434', 'Гражданского кодекса', 'UZ'), 'gk2_st-434');
    assert.equal(resolver.external('327', 'Гражданского процессуального кодекса', 'UZ'), 'gpk_st-327');
    assert.equal(resolver.external('333', 'ТК', 'UZ'), 'tk_st-333');
    assert.equal(resolver.external('999', 'ГК', 'UZ'), null, 'статьи нет в базе — связи нет');
    assert.equal(resolver.external('26', 'Закона', 'UZ'), null, 'безымянный «Закон» не угадываем');
  });

  it('«настоящего Кодекса» из части второй ГК находит статью части первой', () => {
    assert.equal(resolver.internal('gk2', '327'), 'gk1_st-327');
    assert.equal(resolver.internal('gk2', '416'), 'gk2_st-416');
    assert.equal(resolver.internal('dpb', '999'), null);
  });

  it('статья → статья (refers), пункт Пленума → статья (interprets) + совместное упоминание', () => {
    const art = linksFromUnit(
      { id: 'gk2_st-736', documentId: 'gk2', docType: 'code', text: 'проценты в размере, предусмотренном частями первой и второй статьи 327 настоящего Кодекса, со дня' },
      resolver,
      new Map(),
      'UZ',
    );
    assert.deepEqual(art.map((l) => [l.to, l.kind]), [['gk1_st-327', 'refers']]);
    assert.match(art[0].quote, /статьи 327 настоящего Кодекса/u);

    const point = {
      id: 'pl_p-11',
      documentId: 'pl',
      docType: 'plenum',
      text: 'Кредитор вправе взыскивать законную неустойку (ст. 263 ГК РУз), а также пеню по статье 25 Закона.',
    };
    const ab = new Map([['Закон', 'О договорно-правовой базе деятельности хозяйствующих субъектов']]);
    const own = linksFromUnit(point, resolver, ab, 'UZ');
    assert.deepEqual(own.map((l) => [l.to, l.kind]), [['gk1_st-263', 'interprets'], ['dpb_st-25', 'interprets']]);
    const co = cocitedLinks(point, own);
    assert.deepEqual(co.map((l) => [l.from, l.to, l.via]), [['gk1_st-263', 'dpb_st-25', 'pl_p-11'], ['dpb_st-25', 'gk1_st-263', 'pl_p-11']]);
  });

  it('ссылка на саму себя и пункт-перечень (больше 6 статей) не дают связей', () => {
    const self = linksFromUnit({ id: 'dpb_st-25', documentId: 'dpb', docType: 'act', text: 'см. статью 25 настоящего Закона' }, resolver, new Map(), 'UZ');
    assert.equal(self.length, 0);
    const many = Array.from({ length: 7 }, (_, i) => ({ from: 'p', to: `t${i}`, kind: 'interprets' as const, quote: 'q', via: null }));
    assert.equal(cocitedLinks({ id: 'p', documentId: 'pl', docType: 'plenum', text: 'x' }, many).length, 0);
  });
});
