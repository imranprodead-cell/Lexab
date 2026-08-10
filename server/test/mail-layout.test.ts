/**
 * Оболочка писем: держит фирменный вид и не ломается в почтовых клиентах.
 *
 * Зачем тест. Письма уже один раз молча отстали от редизайна интерфейса на
 * целую тему: приложение перешло в «тёплый графит», а письма ещё год ходили
 * фиолетовыми — человек получал письмо как будто от другого продукта, и
 * заметить это можно было только открыв почту. Проверки ниже падают, а не
 * напоминают: и на чужие цвета, и на приёмы вёрстки, которые в Gmail/Outlook
 * дают невидимую кнопку или кракозябры вместо кириллицы.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.DATABASE_URL = '';
process.env.JWT_SECRET = 'test-secret-that-is-definitely-long-enough-32+';
process.env.DATA_ENCRYPTION_KEY = 'mail-test-master-key-0123456789abcdef!!!!';

const { mailLayout, biBody, biLine } = await import('../src/mail.ts');

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src');

/** Палитра темы (src/styles/global.css) + служебные цвета баннера тестового
 *  режима. Любой другой цвет в письме — след старой темы или самодеятельность. */
const ALLOWED = new Set(
  [
    // светлая тема
    '#fafaf9', '#ffffff', '#f5f4f2', '#e8e6e3', '#232120', '#3a3734', '#6f6b65', '#a3a09a', '#fbfaf9',
    // тёмная тема
    '#0b0b0a', '#121110', '#1a1918', '#282623', '#f8f7f5', '#cbc7c1', '#9c9892', '#6e6a64', '#161514',
    // баннер «тестовый режим» (жёлтая плашка, живёт только до подключения домена)
    '#fbf7ee', '#ece0c8', '#7a6428',
  ].map((c) => c.toLowerCase()),
);

/** Цвета, но НЕ html-мнемоники вроде `&#8203;` (там `#` идёт после `&`). */
const HEX = /(?<!&)#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})\b/g;

const sample = () =>
  mailLayout(
    biLine('Подтвердите почту', 'Confirm your email'),
    biBody('<p>Здравствуйте, <strong>Имя</strong>!</p><ul><li>пункт</li></ul>', '<p>Hello, <strong>Name</strong>!</p>'),
    biLine('Подтвердить', 'Confirm'),
    'https://lexabai.com/verify-email?token=abc',
  );

describe('оболочка писем', () => {
  it('использует только цвета темы приложения', () => {
    const found = [...sample().matchAll(HEX)].map((m) => m[0].toLowerCase());
    const alien = [...new Set(found)].filter((c) => !ALLOWED.has(c));
    assert.deepEqual(alien, [], `чужие цвета в письме: ${alien.join(', ')} — палитра в src/mail.ts (const M)`);
  });

  it('объявляет кодировку — иначе часть клиентов рисует кириллицу кракозябрами', () => {
    assert.match(sample(), /<meta charset="utf-8"\/?>/i);
  });

  it('кнопка залита ПЛОСКИМ цветом и цвет продублирован атрибутом bgcolor', () => {
    const html = sample();
    // Outlook выбрасывает background-image: остаётся белый текст на белом фоне,
    // то есть невидимая кнопка в письме про подтверждение почты.
    assert.ok(!/linear-gradient/i.test(html), 'в письме не должно быть градиентов');
    assert.match(html, /<td class="lx-btn"[^>]*bgcolor="#232120"/);
  });

  it('ширину держит таблица, а не div с max-width (Outlook про max-width не знает)', () => {
    assert.match(sample(), /<table[^>]*width="560"/);
  });

  it('не полагается на SVG и внешние картинки — Gmail их не покажет', () => {
    const html = sample();
    assert.ok(!/<svg/i.test(html), 'Gmail вырезает SVG');
    assert.ok(!/<img/i.test(html), 'внешняя картинка до подключения домена = «сломанный файл»');
  });

  it('задаёт тёмную тему явно, а не отдаёт её на инверсию клиенту', () => {
    const html = sample();
    assert.match(html, /@media \(prefers-color-scheme: dark\)/);
    assert.match(html, /name="color-scheme" content="light dark"/);
  });

  it('оставляет <body …> для вставки баннера тестового режима из sendMail', () => {
    // sendMail подставляет баннер через html.replace(/<body[^>]*>/…): если тег
    // изменится, письма в тестовом режиме молча потеряют пометку получателя.
    assert.match(sample(), /<body[^>]*>/);
  });

  it('строка предпросмотра не даёт Gmail подтянуть начало письма', () => {
    assert.match(sample(), /mso-hide:all[^"]*"[^>]*>[^<]*&#847;/);
  });

  it('CTA не рисуется, когда ссылки нет', () => {
    const html = mailLayout('Заголовок', '<p>Текст</p>');
    assert.ok(!/<td class="lx-btn"/.test(html), 'без ссылки кнопки быть не должно');
  });
});

describe('тела писем', () => {
  // Каждое письмо собирается в вызывающем коде, и туда легко занести цвет
  // «на глаз». Ловим это по всему серверу, а не только в оболочке.
  const files = fs
    .readdirSync(path.join(SRC, 'routes'))
    .map((f) => path.join(SRC, 'routes', f))
    .concat([path.join(SRC, 'lib', 'weeklyDigest.ts')])
    .filter((f) => f.endsWith('.ts'));

  it('не содержат цветов вне палитры темы', () => {
    const bad: string[] = [];
    for (const file of files) {
      const src = fs.readFileSync(file, 'utf8');
      for (const line of src.split('\n')) {
        // Только строки, которые собирают письмо (inline-стиль внутри разметки).
        if (!/style="/.test(line)) continue;
        for (const m of line.matchAll(HEX)) {
          if (!ALLOWED.has(m[0].toLowerCase())) bad.push(`${path.basename(file)}: ${m[0]}`);
        }
      }
    }
    assert.deepEqual(bad, [], `цвета вне палитры в письмах: ${bad.join(', ')}`);
  });
});
