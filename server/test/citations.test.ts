/* Юнит-тесты чистого разбора русских цитат (parseRuCitation, retrieve.ts):
   алиасы актов УЗ, юникод-границы аббревиатур, fail-closed, KZ без изменений.
   Плюс parseUzDecreeCitation («п. 5 УП-6079») и normalizeUzDocNumber. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRuCitation, parseUzDecreeCitation, parseUzPlenumCitation } from '../src/rag/retrieve.ts';
import { normalizePlenumNumber, normalizeUzDocNumber, plenumDocNumber } from '../src/rag/uz-doc-number.ts';

const uz = (c: string) => parseRuCitation(c, 'UZ');
const kz = (c: string) => parseRuCitation(c, 'KZ');
const dec = (c: string) => parseUzDecreeCitation(c);

test('ГК: аббревиатура и развёрнуто', () => {
  assert.deepEqual(uz('ст. 260 ГК'), { number: '260', titlePattern: 'Гражданский кодекс%' });
  assert.deepEqual(uz('статья 386 Гражданского кодекса'), { number: '386', titlePattern: 'Гражданский кодекс%' });
});

test('аббревиатура не ловится внутри слова', () => {
  assert.equal(uz('ст. 5 ЗГКО'), null);
  assert.equal(uz('ст. 10 устава ЗАО'), null); // АО внутри ЗАО не считается
});

test('ТК: аббревиатура и развёрнуто', () => {
  assert.deepEqual(uz('ст. 130 ТК'), { number: '130', titlePattern: '%Трудовой кодекс%' });
  assert.deepEqual(uz('статья 160 Трудового кодекса РУз'), { number: '160', titlePattern: '%Трудовой кодекс%' });
});

test('ЭПК: аббревиатура и развёрнуто', () => {
  assert.equal(uz('ст. 94 ЭПК')?.titlePattern, '%Экономический процессуальный кодекс%');
  assert.equal(uz('ст. 34 Экономического процессуального кодекса')?.titlePattern, '%Экономический процессуальный кодекс%');
});

test('кавычки выигрывают у алиасов', () => {
  assert.deepEqual(uz('ст. 36 Закона «Об ипотеке»'), { number: '36', titlePattern: '%Об ипотеке%' });
  assert.deepEqual(uz('ст. 14 Закона "О защите прав потребителей"'), { number: '14', titlePattern: '%О защите прав потребителей%' });
});

test('ипотека специфичнее залога', () => {
  assert.equal(uz('ст. 6 закона об ипотеке (залог недвижимости)')?.titlePattern, '%Об ипотеке%');
  assert.equal(uz('ст. 19 закона о залоге')?.titlePattern, '%О залоге%');
});

test('ООО и АО', () => {
  assert.equal(uz('ст. 21 Закона об ООО')?.titlePattern, '%с ограниченной ответственностью%');
  assert.equal(uz('ст. 21 закона об обществах с ограниченной ответственностью')?.titlePattern, '%с ограниченной ответственностью%');
  assert.equal(uz('ст. 28 закона об акционерных обществах')?.titlePattern, '%Об акционерных обществах%');
  assert.equal(uz('ст. 28 АО')?.titlePattern, '%Об акционерных обществах%');
});

test('аренда, ЭЦП, ЗоЗПП, договорно-правовая база', () => {
  assert.equal(uz('ст. 16 закона об аренде')?.titlePattern, '%Об аренде%');
  assert.equal(uz('ст. 4 закона об ЭЦП')?.titlePattern, '%Об электронной цифровой подписи%');
  assert.equal(uz('ст. 4 об электронной цифровой подписи')?.titlePattern, '%Об электронной цифровой подписи%');
  assert.equal(uz('ст. 5 ЗоЗПП')?.titlePattern, '%О защите прав потребителей%');
  assert.equal(uz('ст. 11 о договорно-правовой базе')?.titlePattern, '%О договорно-правовой базе%');
});

test('составные номера статей', () => {
  assert.equal(uz('ст. 183-1 ЭПК')?.number, '183-1');
  assert.equal(uz('статья 974.2 ГК')?.number, '974.2');
});

test('M13: составной номер в суффиксной форме (modda/бап)', () => {
  // Узбекская суффиксная форма с дефисным составным номером + алиас акта.
  assert.deepEqual(uz('FKning 183-1-moddasi'), { number: '183-1', titlePattern: 'Гражданский кодекс%' });
  // Казахская суффиксная форма с дефисным составным номером + алиас акта.
  assert.deepEqual(kz('115-1-бап ҚР АК'), { number: '115-1', titlePattern: 'Гражданский кодекс%' });
  // Суффикс modda/бап по-прежнему обязателен: голый номер без акта → fail-closed.
  assert.equal(uz('183-1-modda'), null);
});

test('fail-closed: нет статьи или нет акта → null', () => {
  assert.equal(uz('Закон об ипотеке'), null); // нет «ст. N»
  assert.equal(uz('ст. 5 неизвестного акта'), null); // ни один алиас
  assert.equal(parseRuCitation('ст. 5 ГК', 'XX'), null); // неизвестная юрисдикция
});

test('УП/ПП: базовые формы «п. N <номер акта>»', () => {
  assert.deepEqual(dec('п. 5 УП-6079'), { number: '5', docNumber: 'УП-6079' });
  assert.deepEqual(dec('пункт 5 Указа Президента Республики Узбекистан от 05.10.2020 г. № УП-6079'), { number: '5', docNumber: 'УП-6079' });
  assert.deepEqual(dec('пунктом 3 постановления Президента № ПП-3724'), { number: '3', docNumber: 'ПП-3724' });
  assert.deepEqual(dec('в соответствии с п. 2 ПП-3724'), { number: '2', docNumber: 'ПП-3724' });
});

test('УП/ПП: латиница и узбекские префиксы номера', () => {
  assert.deepEqual(dec('п. 1 PF-184'), { number: '1', docNumber: 'УП-184' });
  assert.deepEqual(dec('п. 3 PP-3724'), { number: '3', docNumber: 'ПП-3724' });
  assert.deepEqual(dec('п. 7 ПҚ-4996'), { number: '7', docNumber: 'ПП-4996' });
});

test('УП/ПП: суб-ссылки берут номер ПУНКТА, не части/подпункта', () => {
  assert.equal(dec('ч. 2 п. 5 УП-6079')?.number, '5');
  assert.equal(dec('пп. 3 п. 5 УП-6079')?.number, '5');
  assert.equal(dec('подпункт «а» пункта 5 УП-6079')?.number, '5');
  // Дата в развёрнутой цитате не ловится как номер пункта.
  assert.equal(dec('Указ Президента от 26.10.2020 № УП-6079, п. 4')?.number, '4');
});

test('УП/ПП: fail-closed', () => {
  assert.equal(dec('п. 4'), null); // нет номера акта
  assert.equal(dec('УП-6079'), null); // нет пункта
  assert.equal(dec('согласно УП-6079 и стратегии'), null);
  assert.equal(dec('п. 5 приложения № 1 к УП-6079'), null); // пункты приложений не резолвим
  assert.equal(dec('5-band 1-ilova УП-6079'), null);
  assert.equal(dec('п. 5 договора'), null);
  assert.equal(dec('пп. 3'), null); // «пп.» не превращается в ПП-3
  assert.equal(dec('п. 5 ПКМ-127'), null); // Кабмин — вне охвата
});

test('УП/ПП: статейные цитаты остаются на старом пути (нерегресс)', () => {
  // «п.» внутри статейной цитаты — подпункт статьи; parseRuCitation ловит их
  // ПЕРВЫМ (резолвер пробует decree-ветку только при null от parseRuCitation).
  assert.deepEqual(uz('п. 2 ст. 260 ГК'), { number: '260', titlePattern: 'Гражданский кодекс%' });
  assert.equal(uz('п. 3 ст. 15 Закона "О защите прав потребителей"')?.number, '15');
  assert.equal(uz('п. 3 ст. 15 Закона "О защите прав потребителей"')?.titlePattern, '%О защите прав потребителей%');
  // И сама decree-ветка на такой цитате не находит номера акта.
  assert.equal(dec('п. 2 ст. 260 ГК'), null);
});

test('normalizeUzDocNumber: канонизация форм номера', () => {
  assert.equal(normalizeUzDocNumber('УП-6079'), 'УП-6079');
  assert.equal(normalizeUzDocNumber('№ УП 6079'), 'УП-6079');
  assert.equal(normalizeUzDocNumber('уп—6079'), 'УП-6079');
  assert.equal(normalizeUzDocNumber('UP-6079'), 'УП-6079');
  assert.equal(normalizeUzDocNumber('ПФ-60'), 'УП-60');
  assert.equal(normalizeUzDocNumber('pq-4996'), 'ПП-4996');
  assert.equal(normalizeUzDocNumber('ПКМ-127'), null); // Кабмин не матчится
  assert.equal(normalizeUzDocNumber('ЗРУ-850'), null); // законы — не сюда
  assert.equal(normalizeUzDocNumber('УП-'), null);
  assert.equal(normalizeUzDocNumber(null), null);
});

test('KZ: базовые формы — кавычки, «Гражданск…», ГК/ЭЦП-аббревиатуры', () => {
  assert.deepEqual(kz('статья 401 Гражданского кодекса РК'), { number: '401', titlePattern: 'Гражданский кодекс%' });
  assert.equal(kz('ст. 401 ГК РК')?.titlePattern, 'Гражданский кодекс%');
  assert.equal(kz('ст. 10 закона об ЭЦП')?.titlePattern, '%электронной цифровой подписи%');
  assert.equal(kz('ст. 7 Закона «О защите прав потребителей»')?.titlePattern, '%О защите прав потребителей%');
  assert.equal(kz('ст. 5 неизвестного закона'), null); // fail-closed сохранён
});

test('KZ: казахские формы — АК/Азаматтық/бап/тұтынушы/ЭЦП', () => {
  assert.deepEqual(kz('359-бап ҚР АК'), { number: '359', titlePattern: 'Гражданский кодекс%' });
  assert.equal(kz('ст. 401 ГК РК')?.titlePattern, 'Гражданский кодекс%');
  assert.equal(kz('Азаматтық кодекстің 682-бабы туралы 682-бап')?.titlePattern, 'Гражданский кодекс%');
  assert.equal(kz('тұтынушы құқықтарын қорғау туралы 7-бап')?.titlePattern, '%О защите прав потребителей%');
  assert.equal(kz('электрондық цифрлық қолтаңба туралы 10-бап')?.titlePattern, '%электронной цифровой подписи%');
  assert.equal(kz('ст. 10 об электронной цифровой подписи')?.titlePattern, '%электронной цифровой подписи%');
});

test('UZ: узбекские формы — FK/modda/fuqarolik/mehnat', () => {
  assert.deepEqual(uz('FKning 706-moddasi'), { number: '706', titlePattern: 'Гражданский кодекс%' });
  assert.equal(uz('Fuqarolik kodeksining 386-moddasi')?.titlePattern, 'Гражданский кодекс%');
  assert.equal(uz('Mehnat kodeksining 130-moddasi')?.titlePattern, '%Трудовой кодекс%');
  assert.equal(uz('706-modda'), null); // номер без акта → fail-closed
});

test('UZ: узбекская КИРИЛЛИЦА — модда/Фуқаролик/Меҳнат/гаров/ижара/истеъмолчи', () => {
  // Живой кейс: узбекоязычный договор → модель цитирует по-узбекски.
  assert.deepEqual(uz('Ўзбекистон Республикаси Фуқаролик Кодексининг 260-моддаси'), {
    number: '260',
    titlePattern: 'Гражданский кодекс%',
  });
  assert.equal(uz('Фуқаролик кодексининг 382-моддасида')?.titlePattern, 'Гражданский кодекс%');
  assert.equal(uz('Меҳнат кодексининг 130-моддаси')?.titlePattern, '%Трудовой кодекс%');
  assert.equal(uz('Солиқ кодексининг 65-моддаси')?.titlePattern, '%Налоговый кодекс%');
  assert.equal(uz('Ер кодексининг 20-моддаси')?.titlePattern, '%Земельный кодекс%');
  assert.equal(uz('Иқтисодий процессуал кодексининг 31-моддаси')?.titlePattern, '%Экономический процессуальный кодекс%');
  assert.equal(uz('«Гаров тўғрисида»ги қонуннинг 12-моддаси')?.titlePattern, '%Гаров тўғрисида%'); // кавычки выигрывают
  assert.equal(uz('гаров тўғрисидаги қонуннинг 12-моддаси')?.titlePattern, '%О залоге%');
  assert.equal(uz('ижара тўғрисидаги қонуннинг 5-моддаси')?.titlePattern, '%Об аренде%');
  assert.equal(uz('истеъмолчилар ҳуқуқларини ҳимоя қилиш тўғрисидаги қонуннинг 14-моддаси')?.titlePattern, '%О защите прав потребителей%');
  assert.equal(uz('масъулияти чекланган жамиятлар тўғрисидаги қонуннинг 8-моддаси')?.titlePattern, '%с ограниченной ответственностью%');
  assert.equal(uz('акциядорлик жамиятлари тўғрисидаги қонуннинг 9-моддаси')?.titlePattern, '%Об акционерных обществах%');
  assert.equal(uz('электрон рақамли имзо тўғрисидаги қонуннинг 4-моддаси')?.titlePattern, '%Об электронной цифровой подписи%');
  // «Фуқаролик процессуал кодекси» (ГПК) — с волны 6 В корпусе; алиас ГК
  // при этом не должен хватать процессуальный кодекс (порядок алиасов).
  assert.equal(uz('Фуқаролик процессуал кодексининг 31-моддаси')?.titlePattern, '%Гражданский процессуальный кодекс%');
  assert.equal(uz('260-модда'), null); // номер без акта → fail-closed
});

test('волна 6: ГПК выше ГК, новые алиасы законов', () => {
  assert.deepEqual(uz('ст. 45 Гражданского процессуального кодекса'), { number: '45', titlePattern: '%Гражданский процессуальный кодекс%' });
  assert.equal(uz('ст. 45 ГПК')?.titlePattern, '%Гражданский процессуальный кодекс%');
  assert.deepEqual(uz('ст. 260 ГК'), { number: '260', titlePattern: 'Гражданский кодекс%' }); // нерегресс
  assert.equal(uz('ст. 5 Закона о коммерческой тайне')?.titlePattern, '%О коммерческой тайне%');
  assert.equal(uz('ст. 7 Закона об электронном документообороте')?.titlePattern, '%Об электронном документообороте%');
  assert.equal(uz('ст. 10 Закона об оценочной деятельности')?.titlePattern, '%Об оценочной деятельности%');
  assert.equal(uz('ст. 12 Закона о биржах и биржевой деятельности')?.titlePattern, '%О биржах и биржевой деятельности%');
  assert.equal(uz('ст. 20 Закона о специальных экономических зонах')?.titlePattern, '%О специальных экономических зонах%');
  assert.equal(uz('ст. 8 Закона об экспортном контроле')?.titlePattern, '%Об экспортном контроле%');
  assert.equal(uz('ст. 14 Закона о защите частной собственности')?.titlePattern, '%О защите частной собственности%');
  assert.equal(uz('ст. 30 Закона об административных процедурах')?.titlePattern, '%Об административных процедурах%');
  assert.equal(uz('ст. 16 Закона о медиации')?.titlePattern, '%О медиации%');
});

test('Конституция и Закон о НПА: ловятся, но не перебивают прежние алиасы', () => {
  assert.deepEqual(uz('ст. 15 Конституции Республики Узбекистан'), { number: '15', titlePattern: 'Конституция Республики Узбекистан%' });
  assert.equal(uz('статья 53 Конституции')?.titlePattern, 'Конституция Республики Узбекистан%');
  assert.equal(uz('Konstitutsiyaning 20-moddasi')?.titlePattern, 'Конституция Республики Узбекистан%');
  assert.deepEqual(uz('ст. 18 Закона о нормативно-правовых актах'), { number: '18', titlePattern: '%О нормативно-правовых актах%' });
  assert.equal(uz('ст. 18 Закона «О нормативно-правовых актах»')?.titlePattern, '%О нормативно-правовых актах%');
  // «Конституционный закон» и узб. «конституциявий» — не Конституция.
  assert.equal(uz('ст. 5 Конституционного закона о Кабинете Министров'), null);
  assert.equal(uz('5-модда конституциявий қонун'), null);
  // Алиасы в конце списка: смешанная цитата остаётся за прежним алиасом.
  assert.equal(uz('ст. 164 ГК (в свете ст. 53 Конституции)')?.titlePattern, 'Гражданский кодекс%');
});

const pl = (c: string) => parseUzPlenumCitation(c);

test('Пленум: суд, номер постановления, пункт, год', () => {
  assert.deepEqual(pl('п. 6 постановления Пленума ВХС № 163 от 15.06.2007'), { number: '6', court: 'ВХС', actNumber: '163', year: '2007' });
  assert.deepEqual(pl('пункт 3 постановления Пленума Верховного суда от 22 декабря 2006 года № 17'), { number: '3', court: 'ВС', actNumber: '17', year: '2006' });
  assert.deepEqual(pl('п. 12 постановления Пленума Высшего хозяйственного суда Республики Узбекистан № 269'), { number: '12', court: 'ВХС', actNumber: '269', year: null });
  // Совместные: по «/» в номере или по обоим судам.
  assert.deepEqual(pl('п. 5 совместного постановления Пленумов ВС и ВХС № 13/150 от 22.12.2006'), { number: '5', court: 'ВС+ВХС', actNumber: '13/150', year: '2006' });
  assert.equal(pl('п. 2 постановления Пленума ВС № 06/196')?.actNumber, '6/196');
  // Подпункты вида 19.8 и вставные 4-1.
  assert.equal(pl('п. 19.8 постановления Пленума ВХС № 234')?.number, '19.8');
});

test('Пленум: fail-closed', () => {
  assert.equal(pl('п. 6 УП-6079'), null); // не Пленум
  assert.equal(pl('постановление Пленума ВХС № 163'), null); // нет пункта
  assert.equal(pl('п. 6 постановления Пленума ВХС'), null); // нет номера
  assert.equal(pl('п. 6 постановления Пленума № 163'), null); // нет суда
  assert.equal(pl('п. 3 приложения к постановлению Пленума ВС № 17'), null);
  // Указная ветка Пленум не перехватывает: номер не УП/ПП.
  assert.equal(dec('п. 6 постановления Пленума ВХС № 163'), null);
  // Статейная цитата остаётся на старом пути.
  assert.equal(uz('п. 6 постановления Пленума ВХС № 163'), null);
});

test('Пленум: канонический номер', () => {
  assert.equal(normalizePlenumNumber('06/196'), '6/196');
  assert.equal(normalizePlenumNumber(' 05 '), '5');
  assert.equal(normalizePlenumNumber('5А'), '5а');
  assert.equal(normalizePlenumNumber('УП-60'), null);
  assert.equal(normalizePlenumNumber('1/2/3'), null);
  assert.equal(plenumDocNumber('ВХС', '163', '2007'), 'ПВХС-163-2007');
  assert.equal(plenumDocNumber('ВС', '05', 2011), 'ПВС-5-2011');
  assert.equal(plenumDocNumber('ВС+ВХС', '13/150', '2006'), 'ПВС-ПВХС-13/150-2006');
  assert.equal(plenumDocNumber('ВС', '17', '206'), null);
});

test('волна 7: новые кодексы и законы, приоритет над общими алиасами', () => {
  assert.equal(uz('ст. 175 КоАО')?.titlePattern, '%об административной ответственности%');
  assert.equal(uz('статья 98 Кодекса об административной ответственности')?.titlePattern, '%об административной ответственности%');
  assert.equal(uz('ст. 27 Кодекса об административном судопроизводстве')?.titlePattern, '%об административном судопроизводстве%');
  assert.equal(uz('ст. 29 Семейного кодекса')?.titlePattern, 'Семейный кодекс%');
  assert.equal(uz('ст. 29 СК')?.titlePattern, 'Семейный кодекс%');
  assert.equal(uz('ст. 5 Закона о семейном предпринимательстве')?.titlePattern, '%О семейном предпринимательстве%');
  // Специфичные — выше общих: залоговый реестр не уходит в «О залоге», ОСАГО — не в «О страховой деятельности».
  assert.equal(uz('ст. 7 Закона о залоговом реестре')?.titlePattern, '%О залоговом реестре%');
  assert.equal(uz('ст. 7 Закона о залоге')?.titlePattern, '%О залоге%');
  assert.equal(uz('ст. 16 Закона об обязательном страховании гражданской ответственности владельцев транспортных средств')?.titlePattern, '%Об обязательном страховании гражданской ответственности%');
  assert.equal(uz('ст. 10 Закона о страховой деятельности')?.titlePattern, '%О страховой деятельности%');
  assert.equal(uz('ст. 5 Закона о Центральном банке')?.titlePattern, '%О Центральном банке%');
  assert.equal(uz('ст. 5 Закона о банках и банковской деятельности')?.titlePattern, '%О банках и банковской деятельности%');
  assert.equal(uz('ст. 3 Закона о судах')?.titlePattern, '%О судах%');
  assert.equal(uz('ст. 3 Закона о третейских судах')?.titlePattern, '%О третейских судах%');
  assert.equal(uz('ст. 9 Закона об охране труда')?.titlePattern, '%Об охране труда%');
  assert.equal(uz('ст. 9 ТК')?.titlePattern, '%Трудовой кодекс%');
  assert.equal(uz('ст. 20 ОСАГО')?.titlePattern, '%Об обязательном страховании гражданской ответственности%');
  assert.equal(uz('ст. 333 Гражданского кодекса')?.titlePattern, 'Гражданский кодекс%');
});

test('вставные статьи: надстрочный номер → «N-k»', () => {
  assert.deepEqual(uz('ст. 383¹ ГК'), { number: '383-1', titlePattern: 'Гражданский кодекс%' });
  assert.equal(uz('статья 27² Кодекса об административном судопроизводстве')?.number, '27-2');
  assert.deepEqual(uz('ст. 24-4 Земельного кодекса'), { number: '24-4', titlePattern: 'Земельный кодекс%' });
  assert.equal(uz('ст. 100 НК')?.titlePattern, 'Налоговый кодекс%');
  assert.equal(uz('ст. 100 Налогового кодекса')?.titlePattern, 'Налоговый кодекс%');
  assert.equal(uz('ст. 12¹⁰ ЭПК')?.number, '12-10');
});

test('акты волны 2: ссылки без кавычек', () => {
  assert.equal(uz('ст. 11 Закона о валютном регулировании')?.titlePattern, '%О валютном регулировании%');
  assert.equal(uz('ст. 5 Закона об инвестициях и инвестиционной деятельности')?.titlePattern, '%Об инвестициях и инвестиционной деятельности%');
  assert.equal(uz('ст. 20 Закона о государственных закупках')?.titlePattern, '%О государственных закупках%');
  assert.equal(uz('ст. 3 Закона о лицензировании')?.titlePattern, '%О лицензировании%');
  assert.equal(uz('ст. 7 Закона о неплатежеспособности')?.titlePattern, '%О неплатежеспособности%');
  assert.equal(uz('ст. 12 Закона о конкуренции')?.titlePattern, '%О конкуренции%');
  // Прежние не задеты.
  assert.equal(uz('ст. 5 Закона о государственной пошлине')?.titlePattern, '%О государственной пошлине%');
  assert.equal(uz('ст. 5 Закона о государственно-частном партнерстве')?.titlePattern, '%О государственно-частном партнерстве%');
});
