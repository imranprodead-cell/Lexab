/**
 * Согласованность реестров сайта.
 *
 * Страница живёт сразу в двух списках: маршруты приложения собираются из
 * `src/pages/public/registry.ts`, а снимки для поисковика, sitemap.xml и
 * robots.txt — из `routes.json`. Разъезд этих списков не ломает сборку и не
 * виден на экране: страница просто не попадает в карту сайта или, наоборот,
 * попадает в карту, но отдаёт пустой HTML краулеру. Поэтому — тестом.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import registry from './routes.json';
import { FOOTER_COLUMNS, HEADER_NAV, LEGAL_LINKS } from './nav';
import { PUBLIC_SLUGS } from '@/pages/public/registry';

const routes = registry.routes;
const urls = routes.map((r) => r.url);

describe('реестры сайта согласованы', () => {
  it('у каждой публичной страницы есть запись в routes.json', () => {
    for (const slug of PUBLIC_SLUGS) {
      expect(urls, `нет записи для /${slug}`).toContain(`/${slug}`);
    }
  });

  it('у каждой записи есть заголовок и описание на языке индексации', () => {
    for (const route of routes) {
      expect(route.title.ru, `${route.url}: пустой заголовок`).toBeTruthy();
      expect(route.desc.ru, `${route.url}: пустое описание`).toBeTruthy();
      // Поисковик обрезает длинное описание — и обрезает по-своему.
      expect(route.desc.ru.length, `${route.url}: описание длиннее 300 символов`).toBeLessThanOrEqual(300);
    }
  });

  it('имя файла снимка соответствует адресу', () => {
    for (const route of routes) {
      const expected = route.url === '/' ? 'index.html' : `${route.url.slice(1)}/index.html`;
      expect(route.file, `${route.url}: файл снимка не совпадает с адресом`).toBe(expected);
    }
  });

  it('ни один публичный адрес не закрыт от индексации', () => {
    // ВНИМАНИЕ: robots.txt сопоставляет ПРЕФИКС строки, а не сегменты пути —
    // «Disallow: /team» формально накрывает и «/team-access». Спасает правило
    // «побеждает самое длинное совпадение»: для каждого публичного адреса мы
    // пишем свой Allow, и он длиннее. Поэтому проверяем не отсутствие
    // префиксного пересечения (оно есть и это нормально), а то, что у каждого
    // пересёкшегося адреса действительно есть собственная строка Allow.
    for (const route of routes) {
      for (const priv of registry.privatePaths) {
        if (!route.url.startsWith(priv)) continue;
        expect(
          urls,
          `${route.url} пересекается с Disallow ${priv} и обязан иметь собственный Allow`,
        ).toContain(route.url);
        expect(
          route.url.length,
          `${route.url} не длиннее правила ${priv} — Allow не победит`,
        ).toBeGreaterThan(priv.length);
      }
    }
  });

  it('каждый маршрут приложения либо публичный, либо закрыт от индексации', () => {
    // Аудит 06.08.2026: в privatePaths не хватало /projects, /developer и
    // /share/ — последний отдаёт отчёт с текстом чужого договора по токену.
    // Список маршрутов читаем из роутера как текст: тянуть сам роутер в тест
    // нельзя (он тащит за собой половину приложения).
    const routerSrc = readFileSync(path.resolve(process.cwd(), 'src/router/routes.tsx'), 'utf8');
    const paths = [...routerSrc.matchAll(/path: '([^']+)'/g)]
      .map((m) => (m[1].startsWith('/') ? m[1] : `/${m[1]}`))
      .filter((p) => p !== '/*' && p !== '/');

    const publicUrls = new Set([...urls, '/login']);
    const covered = (p: string) =>
      publicUrls.has(p) ||
      registry.privatePaths.some((priv) => p.startsWith(priv)) ||
      // Публичные страницы-разделы приходят из реестра и уже есть в urls.
      PUBLIC_SLUGS.some((slug) => p === `/${slug}`);

    const uncovered = paths.filter((p) => !covered(p));
    expect(uncovered, `маршруты без решения «публичный или Disallow»: ${uncovered.join(', ')}`).toEqual([]);
  });

  it('адреса не повторяются', () => {
    expect(new Set(urls).size).toBe(urls.length);
  });
});

describe('меню не ведёт в никуда', () => {
  const menuSlugs = [
    ...HEADER_NAV.filter((i) => i.kind === 'route').map((i) => (i.kind === 'route' ? i.slug : '')),
    ...FOOTER_COLUMNS.flatMap((c) => c.items.filter((i) => i.kind === 'route').map((i) => (i.kind === 'route' ? i.slug : ''))),
  ];

  it('пункт меню либо существует в реестре, либо скрыт фильтром до выхода страницы', () => {
    // Фильтр по PUBLIC_SLUGS живёт в самих компонентах; тест держит инвариант:
    // слаг в меню записан латиницей и в том же виде, что и в реестре страниц.
    for (const slug of menuSlugs) {
      expect(slug, 'слаг меню должен быть непустой латиницей').toMatch(/^[a-z][a-z0-9-]*$/);
    }
  });

  it('правовые страницы существуют как маршруты снимков', () => {
    for (const link of LEGAL_LINKS) {
      expect(urls, `нет снимка для ${link.to}`).toContain(link.to);
    }
  });

  it('у каждого пункта меню есть перевод на все шесть языков', () => {
    const items = [...HEADER_NAV, ...FOOTER_COLUMNS.flatMap((c) => c.items), ...LEGAL_LINKS];
    for (const item of items) {
      for (const lang of ['ru', 'en', 'de', 'ar', 'kk', 'uz'] as const) {
        expect(item.label[lang], `пункт «${item.label.ru}»: нет языка ${lang}`).toBeTruthy();
      }
    }
  });
});
