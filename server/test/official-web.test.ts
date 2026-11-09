/**
 * Официальные сайты для агента (lib/officialWeb.ts): только белый список,
 * переадресация наружу — отказ, разбор поиска и страниц lex.uz.
 */
import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';

const { isOfficialHost, officialUrl, fetchOfficial, parseLexSearch, parseLexPage, pageText, excerpt, replyLanguage, officialSourceNote, shortActName, lexDocId, officialActRef, mentionsOfficialAct } = await import('../src/lib/officialWeb.ts');

describe('белый список официальных сайтов', () => {
  it('разрешены базы законов и госорганы, запрещено всё остальное', () => {
    for (const h of ['lex.uz', 'www.lex.uz', 'cbu.uz', 'soliq.uz', 'my.gov.uz', 'parliament.gov.uz', 'adilet.zan.kz', 'www.legislation.gov.uk']) assert.ok(isOfficialHost(h), h);
    for (const h of ['evil.com', 'lex.uz.evil.com', 'notlex.uz', 'gov.uz.attacker.net', '127.0.0.1', 'localhost', '169.254.169.254']) assert.ok(!isOfficialHost(h), h);
  });

  it('URL: http → https; пароль, чужой порт и чужой хост — отказ', () => {
    assert.equal(officialUrl('http://lex.uz/ru/docs/10872')?.toString(), 'https://lex.uz/ru/docs/10872');
    assert.equal(officialUrl('https://user:pass@lex.uz/'), null);
    assert.equal(officialUrl('https://lex.uz:8443/'), null);
    assert.equal(officialUrl('https://example.com/'), null);
    assert.equal(officialUrl('file:///etc/passwd'), null);
    assert.equal(officialUrl('not a url'), null);
  });
});

describe('переадресация', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it('наружу из белого списка — отказ, внутри — следуем', async () => {
    globalThis.fetch = (async (input: string | URL) => {
      const u = String(input);
      if (u.includes('/out')) return new Response(null, { status: 302, headers: { location: 'https://evil.com/x' } });
      if (u.includes('/in')) return new Response(null, { status: 302, headers: { location: '/ru/docs/1' } });
      return new Response('<html>ok</html>', { status: 200 });
    }) as typeof fetch;
    await assert.rejects(fetchOfficial('https://lex.uz/out'), /outside/);
    const ok = await fetchOfficial('https://lex.uz/in');
    assert.equal(ok.url, 'https://lex.uz/ru/docs/1');
  });
});

describe('разбор lex.uz', () => {
  it('поиск: вид акта, статус, ссылка', () => {
    const html = `<table><tr class="dd-table__main-item"><td>1</td><td><span class="lx_act_state"><i class="fa fa-check-circle status_code_y"></i></span>
      <div><a class="lx_link " href="/ru/docs/6511830?query=x#sr-1" target="_blank">О внесении изменений в постановление № 683</a></div>
      <div><span class="badge badge-pill badge-nine">Постановление Кабинета Министров Республики Узбекистан, от 21.06.2023 г. № 253</span></div></td></tr>
      <tr class="dd-table__main-item"><td>2</td><td><span class="lx_act_state"><i class="fa fa-times-circle status_code_r"></i></span>
      <div><a class="lx_link " href="/docs/123?query=x#sr-1">Старый акт</a></div></td></tr></table>`;
    const hits = parseLexSearch(html);
    assert.deepEqual(hits, [
      { title: 'О внесении изменений в постановление № 683', act: 'Постановление Кабинета Министров Республики Узбекистан, от 21.06.2023 г. № 253', inForce: true, url: 'https://lex.uz/ru/docs/6511830' },
      { title: 'Старый акт', act: '', inForce: false, url: 'https://lex.uz/ru/docs/123' },
    ]);
  });

  it('страница акта: заголовок, текст без панелей кнопок, предупреждение и ссылка на оригинал', () => {
    const block = (cls: string, id: number, text: string) =>
      `<div class="${cls} lx_elem"><div class="lx_elem2"><span>Предложения по документу</span><span>Прослушать аудио</span></div><div name="${id}" id="${id}">${text}</div></div>`;
    const html =
      block('ACT_TITLE', 1, 'О порядке &laquo;регистрации&raquo;') +
      `<div class="COMMENT_FOR_WARNING"><div name="2" id="2">Текст акта приводится на <a href="/ru/docs/555">узбекском языке</a>.</div></div>` +
      block('ACT_TEXT', 3, '1. Утвердить порядок.') +
      block('SIGNATURE', 4, 'Премьер-министр');
    const page = parseLexPage(html);
    assert.equal(page.title, 'О порядке «регистрации»');
    assert.equal(page.originalUrl, 'https://lex.uz/ru/docs/555');
    assert.match(page.warnings[0], /узбекском/u);
    assert.ok(page.text.includes('1. Утвердить порядок.'));
    assert.ok(!page.text.includes('Прослушать аудио'));
  });

  it('страница госоргана: основной текст без меню; выдержка по запросу', () => {
    const { title, text } = pageText('<html><head><title>ЦБ — ставка</title></head><body><nav>Меню Главная</nav><main><h1>Ставка рефинансирования</h1><p>Ставка составляет 13,5% годовых.</p></main><footer>©</footer></body></html>');
    assert.equal(title, 'ЦБ — ставка');
    assert.ok(text.includes('13,5%') && !text.includes('Меню'));
    assert.match(excerpt('a'.repeat(20) + '\nСтавка рефинансирования 13,5%\n' + 'b'.repeat(20), 'ставка рефинансирования', 200), /13,5%/u);
  });
});

describe('пометка об источнике в ответе', () => {
  it('язык ответа по тексту', () => {
    assert.equal(replyLanguage('Ставка рефинансирования — 14% годовых.'), 'ru');
    assert.equal(replyLanguage('The policy rate is 14% per annum.'), 'en');
    assert.equal(replyLanguage('Asosiy stavka yillik 14% va u 16.09.2026 dan amal qiladi.'), 'uz');
    assert.equal(replyLanguage('Негізгі мөлшерлеме — жылдық 14%.'), 'kk');
    assert.equal(replyLanguage('Der Leitzins beträgt 14 % und gilt ab September.'), 'de');
    assert.equal(replyLanguage('سعر الفائدة الأساسي 14٪ سنويًا.'), 'ar');
  });

  it('строка с хостами на языке ответа; без хостов — пусто', () => {
    assert.match(officialSourceNote('Ставка — 14%.', ['cbu.uz', 'lex.uz', 'cbu.uz']), /официальных сайтов \(cbu\.uz, lex\.uz\).*не из проверенной базы Lexab/u);
    assert.match(officialSourceNote('The rate is 14%.', ['cbu.uz']), /not from Lexab's verified database/);
    assert.equal(officialSourceNote('Ставка — 14%.', []), '');
  });
});

describe('акты с официальных сайтов в Sources (как нормы из базы)', () => {
  it('подпись акта из строки поиска lex.uz (строки — с живого lex.uz 09.11.2026)', () => {
    const label = (a: string) => shortActName(a)?.label;
    assert.equal(label('Постановление Кабинета Министров Республики Узбекистан, от 31.08.2023 г. № 428'), 'ПКМ № 428 от 31.08.2023');
    assert.equal(label('Указ Президента Республики Узбекистан, от 08.09.2025 г. № УП-157'), 'УП-157 от 08.09.2025');
    assert.equal(label('Постановление Президента Республики Узбекистан, от 11.09.2023 г. № ПП-300'), 'ПП-300 от 11.09.2023');
    assert.equal(label('Закон Республики Узбекистан, от 29.09.2022 г. № ЗРУ-792'), 'ЗРУ-792 от 29.09.2022');
    assert.equal(label('Постановление пленума Верховного суда Республики Узбекистан, от 20.11.2023 г. № 26'), 'Пленум ВС № 26 от 20.11.2023');
    assert.equal(label('Приказ министра внутренних дел Республики Узбекистан, зарегистрировано 23.12.2024 г., рег. номер 2303-7'), 'Приказ, рег. № 2303-7 от 23.12.2024');
    assert.equal(label('Постановление Правления Центрального банка Республики Узбекистан, зарегистрировано 17.07.2026 г., рег. номер 3042-7'), 'ЦБ, рег. № 3042-7 от 17.07.2026');
    assert.equal(label('Ўзбекистон Республикаси Президентининг қарори, 23.11.2023 йилдаги ПҚ-373-сон'), 'ПҚ-373 от 23.11.2023');
    assert.equal(shortActName(''), null);
    assert.equal(shortActName('Без номера и даты'), null);
  });

  it('строка Sources: подпись + название + ссылка; id страницы lex.uz', () => {
    const ref = officialActRef({ title: 'О мерах по дальнейшему совершенствованию регулирования отношений в сфере внешней рекламы', act: 'Постановление Кабинета Министров Республики Узбекистан, от 31.08.2023 г. № 428', inForce: true, url: 'https://lex.uz/ru/docs/6591660' });
    assert.equal(ref.label, 'ПКМ № 428 от 31.08.2023');
    assert.ok(ref.doc.startsWith('О мерах по дальнейшему') && ref.doc.length <= 60);
    assert.equal(ref.url, 'https://lex.uz/ru/docs/6591660');
    assert.equal(ref.number, '428');
    // Вид акта не разобран — подпись из названия, как раньше.
    assert.deepEqual(officialActRef({ title: 'Старый акт', act: '', inForce: false, url: 'https://lex.uz/ru/docs/123' }), { label: 'Старый акт', doc: 'lex.uz', url: 'https://lex.uz/ru/docs/123', number: null });
    assert.equal(lexDocId('https://lex.uz/ru/docs/6591660'), '6591660');
    assert.equal(lexDocId('https://lex.uz/docs/-123'), '-123');
    assert.equal(lexDocId('https://cbu.uz/ru/'), null);
  });

  it('ответ называет акт: номер, узбекский код или ссылка; чужой номер — нет', () => {
    const pkm = { url: 'https://lex.uz/ru/docs/6591660', number: '428' };
    assert.ok(mentionsOfficialAct('Это регулирует постановление Кабмина от 31.08.2023 № 428.', pkm));
    assert.ok(mentionsOfficialAct('См. ПКМ-428.', pkm));
    assert.ok(mentionsOfficialAct('Текст: https://lex.uz/ru/docs/6591660', pkm));
    assert.ok(!mentionsOfficialAct('Статья 428 ГК и постановление № 4281.', pkm));
    assert.ok(!mentionsOfficialAct('Постановление № 428-1.', pkm));
    const up = { url: 'https://lex.uz/ru/docs/7719581', number: 'УП-157' };
    assert.ok(mentionsOfficialAct('Указ УП-157 от 08.09.2025', up));
    assert.ok(mentionsOfficialAct('Prezidentning PF-157-son farmoni', up));
    assert.ok(mentionsOfficialAct('Указ № УП–157', up));
    assert.ok(!mentionsOfficialAct('Постановление ПП-157', up));
    assert.ok(!mentionsOfficialAct('Указ УП-1570', up));
    const reg = { url: 'https://lex.uz/ru/docs/7271585', number: '2303-7' };
    assert.ok(mentionsOfficialAct('приказ МВД (рег. № 2303-7)', reg));
    assert.ok(!mentionsOfficialAct('приказ № 2303-8', reg));
    assert.ok(!mentionsOfficialAct('Без номеров', { url: 'https://cbu.uz/ru/', number: null }));
  });

  it('шапка страницы lex.uz: вид и орган + номер из ACT_NUM или из заголовка вкладки', () => {
    const block = (cls: string, id: number, text: string) =>
      `<div class="${cls} lx_elem"><div class="lx_elem2"><span>Предложения по документу</span></div><div name="${id}" id="${id}">${text}</div></div>`;
    // Как на живой странице lex.uz/ru/docs/6591660: номер только в <title>.
    const live =
      '<html><head><title>&nbsp;428-сон 31.08.2023.&nbsp;О мерах по дальнейшему совершенствованию</title></head><body>' +
      block('ACT_FORM', 1, 'Постановление') +
      block('ACCEPTING_BODY', 2, 'Кабинета Министров Республики Узбекистан') +
      block('ACT_TITLE', 3, 'О мерах по дальнейшему совершенствованию') +
      block('ACT_TEXT', 4, '1. Утвердить.') +
      '</body></html>';
    const page = parseLexPage(live);
    assert.equal(page.act, 'Постановление Кабинета Министров Республики Узбекистан, от 31.08.2023 г. № 428');
    assert.equal(shortActName(page.act)?.label, 'ПКМ № 428 от 31.08.2023');
    assert.equal(page.title, 'О мерах по дальнейшему совершенствованию');
    // Номер в шапке (ACT_NUM), как в образце указа.
    const decree = '<div class="ACT_FORM"><div name="1" id="1">Указ</div></div><div class="ACCEPTING_BODY"><div name="2" id="2">Президента Республики Узбекистан</div></div><div class="ACT_NUM" id="lx_lact_num_top">от 05.10.2020 г. № УП-9999</div>';
    assert.equal(shortActName(parseLexPage(decree).act)?.label, 'УП-9999 от 05.10.2020');
    assert.equal(parseLexPage(block('ACT_TEXT', 1, 'Только текст')).act, '');
  });

  it('строка-пометка получает ссылки на акты (Markdown), без ссылок — как раньше', () => {
    const note = officialSourceNote('Регулирует ПКМ № 428.', ['lex.uz'], [{ label: 'ПКМ № 428 от 31.08.2023', url: 'https://lex.uz/ru/docs/6591660' }]);
    assert.match(note, /не из проверенной базы Lexab\. Сверьте по ссылке перед использованием: \[ПКМ № 428 от 31\.08\.2023\]\(https:\/\/lex\.uz\/ru\/docs\/6591660\)\.$/u);
    assert.match(officialSourceNote('The act is PKM 428.', ['lex.uz'], [{ label: 'ПКМ [№] 428', url: 'https://lex.uz/a(b)' }]), /before relying on it: \[ПКМ № 428\]\(https:\/\/lex\.uz\/a%28b%29\)\.$/);
    assert.match(officialSourceNote('Ставка — 14%.', ['cbu.uz']), /Сверьте по ссылке перед использованием\.$/u);
  });
});
