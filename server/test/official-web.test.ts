/**
 * Официальные сайты для агента (lib/officialWeb.ts): только белый список,
 * переадресация наружу — отказ, разбор поиска и страниц lex.uz.
 */
import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';

const { isOfficialHost, officialUrl, fetchOfficial, parseLexSearch, parseLexPage, pageText, excerpt, replyLanguage, officialSourceNote } = await import('../src/lib/officialWeb.ts');

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
