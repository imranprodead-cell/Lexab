/**
 * Проверки контента публичного сайта.
 *
 * Тип Text6 требует шесть языков, но не умеет требовать, чтобы они были
 * РАЗНЫМИ и НЕПУСТЫМИ: `{ ru: '', en: 'x', de: 'x', … }` пройдёт компиляцию.
 * Именно так на лендинге и появились английские вставки вместо переводов.
 *
 * Второй тест — стоп-лист: список того, чего в продукте нет, а на сайте
 * появиться очень легко (электронная подпись, сертификации, судебная практика,
 * «полностью зашифровано», проценты точности). Он умеет отличать обещание от
 * честного отрицания: «электронной подписи нет» — можно, «подписывайте
 * документы электронной подписью» — нельзя.
 */
import { describe, expect, it } from 'vitest';
import type { PageContent, Text6 } from './types';
import { contractAnalysis } from './pages/contract-analysis';
import { pricing } from './pages/pricing';
import { legalBase } from './pages/legal-base';
import { documentChat } from './pages/document-chat';
import { versionCompare } from './pages/version-compare';
import { contractTemplates } from './pages/contract-templates';
import { clausePlaybooks } from './pages/clause-playbooks';
import { approvalsAndDeadlines } from './pages/approvals-and-deadlines';
import { bulkReview } from './pages/bulk-review';
import { teamAccess } from './pages/team-access';
import { security } from './pages/security';
import { integrations } from './pages/integrations';
import { forDevelopers } from './pages/for-developers';
import { HEADER_NAV, FOOTER_COLUMNS, LEGAL_LINKS } from './site/nav';
import registry from './site/routes.json';
import { PUBLIC_SLUGS } from '@/pages/public/registry';

const PAGES: PageContent[] = [
  contractAnalysis,
  pricing,
  legalBase,
  documentChat,
  versionCompare,
  contractTemplates,
  clausePlaybooks,
  approvalsAndDeadlines,
  bulkReview,
  teamAccess,
  security,
  integrations,
  forDevelopers,
];

const LANGS = ['ru', 'en', 'de', 'ar', 'kk', 'uz'] as const;

/** Похоже ли значение на Text6 (объект ровно с языковыми ключами). */
function isText6(v: unknown): v is Text6 {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  const keys = Object.keys(v as object);
  return keys.length === LANGS.length && LANGS.every((l) => l in (v as object));
}

/** Все Text6 страницы с путём, по которому их найти при падении теста. */
function collectTexts(node: unknown, path: string, out: { path: string; value: Text6 }[] = []) {
  if (isText6(node)) {
    out.push({ path, value: node });
    return out;
  }
  if (Array.isArray(node)) {
    node.forEach((item, i) => collectTexts(item, `${path}[${i}]`, out));
    return out;
  }
  if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) collectTexts(v, `${path}.${k}`, out);
  }
  return out;
}

describe('контент: шесть языков в каждой строке', () => {
  for (const page of PAGES) {
    it(`${page.slug}: все языки заполнены`, () => {
      const texts = collectTexts(page, page.slug);
      expect(texts.length).toBeGreaterThan(10);
      for (const { path, value } of texts) {
        for (const lang of LANGS) {
          expect(typeof value[lang], `${path}.${lang}: не строка`).toBe('string');
          expect(value[lang].trim().length, `${path}.${lang}: пусто`).toBeGreaterThan(0);
        }
      }
    });

    it(`${page.slug}: длинный текст переведён, а не скопирован из английского`, () => {
      // Короткие значения («83», «AES-256», «Dropbox») законно совпадают —
      // проверяем только фразы, где совпадение означает забытый перевод.
      // Строка из одной латиницы и знаков (перечень доменов-источников) тоже
      // законно одинакова: переводить адреса сайтов нечего и незачем.
      // Разделители (· — –) не делают строку переводимой: смотрим на буквы.
      const untranslatable = (s: string) => !/[\p{Script=Cyrillic}\p{Script=Arabic}]/u.test(s.replace(/[·—–]/g, ' '));
      const leaks = collectTexts(page, page.slug)
        .filter(({ value }) => value.en.length > 40 && !untranslatable(value.en))
        .flatMap(({ path, value }) =>
          LANGS.filter((l) => l !== 'en' && value[l].trim() === value.en.trim()).map((l) => `${path}.${l}`),
        );
      expect(leaks, `английский вместо перевода: ${leaks.join(', ')}`).toEqual([]);
    });
  }

  it('меню и правовые ссылки тоже переведены полностью', () => {
    const items = [...HEADER_NAV, ...FOOTER_COLUMNS.flatMap((c) => c.items), ...LEGAL_LINKS];
    for (const item of items) {
      for (const lang of LANGS) {
        expect(item.label[lang].trim().length, `${item.label.ru} → ${lang}`).toBeGreaterThan(0);
      }
    }
  });

  it('каждая ссылка внутри контента ведёт на существующий адрес', () => {
    // Аудит 06.08.2026: поле `to` не проверялось ничем. Опечатка «/legal_base»
    // или ссылка на приватный раздел прошла бы типы, линт и сборку и всплыла
    // бы страницей «не найдено» у читателя.
    const allowed = new Set([...registry.routes.map((r) => r.url), '/login']);
    const bad: string[] = [];
    for (const page of PAGES) {
      const walk = (node: unknown, path: string) => {
        if (Array.isArray(node)) return node.forEach((v, i) => walk(v, `${path}[${i}]`));
        if (!node || typeof node !== 'object') return;
        for (const [k, v] of Object.entries(node)) {
          if (k === 'to' && typeof v === 'string') {
            const target = v.split('#')[0] || '/';
            const external = /^https?:\/\//.test(v);
            // Приватность считаем ПО СЕГМЕНТАМ, а не по префиксу строки:
            // «/team-access» не является частью кабинетного «/team», хотя и
            // начинается с него. (В robots.txt семантика префиксная — там нас
            // спасает более длинный Allow, см. routes.test.ts.)
            const priv = registry.privatePaths.some(
              (p) => target === p || target.startsWith(p.endsWith('/') ? p : `${p}/`),
            );
            if (!external && (!allowed.has(target) || priv)) bad.push(`${path}.to = ${v}`);
          } else {
            walk(v, `${path}.${k}`);
          }
        }
      };
      walk(page, page.slug);
    }
    expect(bad, `ссылки в никуда или в кабинет: ${bad.join(', ')}`).toEqual([]);
  });

  it('каждая страница контента есть в реестре маршрутов', () => {
    for (const page of PAGES) {
      expect(PUBLIC_SLUGS, `страница ${page.slug} не подключена`).toContain(page.slug);
    }
    expect(PAGES.length, 'реестр и список контента разошлись').toBe(PUBLIC_SLUGS.length);
  });
});

/**
 * Стоп-лист. Каждая запись — то, чего в продукте НЕТ или что нельзя обещать.
 * `allowNegated: true` — упоминание разрешено, если в том же предложении есть
 * отрицание («нет», «не», «без», «no», «not»…): честно сказать «подписи нет»
 * не только можно, но и нужно.
 */
/**
 * `except` — контекст, в котором упоминание законно. Единственный такой случай:
 * НАЗВАНИЕ ЗАКОНА. В корпусе США лежит акт об электронных подписях (E-SIGN),
 * и назвать его по имени — не обещание функции, а описание содержимого базы.
 */
const ACT_NAME =
  /E-?SIGN|FAA|арбитраж|arbitration|arbitraj|төрелік|التحكيم|закон[а-яё]*\s+об\s+электронн|electronic\s+signatures?\s+act/i;

const BANNED: { re: RegExp; why: string; allowNegated?: boolean; except?: RegExp }[] = [
  { re: /электронн[а-яё]*\s+подпис/i, why: 'раздел электронных подписей выключен', allowNegated: true, except: ACT_NAME },
  { re: /(?<!\p{L})ЭЦП(?!\p{L})/iu, why: 'электронных подписей в продукте нет', allowNegated: true },
  { re: /\be-?sign(ature)?\b/i, why: 'e-signature is switched off', allowNegated: true, except: ACT_NAME },
  { re: /электрон[а-яё]*\s+қолтаңба|elektron\s+imzo/i, why: 'подписей нет', allowNegated: true, except: ACT_NAME },
  { re: /\bSOC\s*2\b/i, why: 'сертификации SOC 2 нет' },
  { re: /\bISO\s*270\d\d\b/i, why: 'сертификации ISO нет' },
  { re: /сертифиц(ирован|ированы|ирована)/i, why: 'сертификаций нет', allowNegated: true },
  { re: /судебн[а-яё]*\s+практик/i, why: 'в корпусе 0 судебных дел', allowNegated: true },
  { re: /(?<!\p{L})прецедент/iu, why: 'практики в корпусе нет', allowNegated: true },
  { re: /(?<!\p{L})case\s*law(?!\p{L})/iu, why: 'no case law in the corpus', allowNegated: true },
  { re: /полностью\s+зашифрован/i, why: 'часть полей открыта намеренно', allowNegated: true },
  { re: /zero[-\s]?knowledge/i, why: 'сервер читает документ, чтобы его разобрать', allowNegated: true },
  { re: /полн[а-яё]*\s+баз[ауые]\s+закон/i, why: 'корпус ограничен, границы показаны в таблице' },
  { re: /обновляется\s+ежедневн/i, why: 'обновление не ежедневное' },
  { re: /точност[ьи]\s+\d+\s*%/i, why: 'замеров точности для маркетинга нет' },
  { re: /экономи[а-яё]*\s+\d+\s*(час|hour)/i, why: 'замеров экономии времени нет' },
  { re: /тысяч[аи]?\s+юрист/i, why: 'числа клиентов не публикуем' },
  { re: /неограниченн[а-яё]*\s+(запрос|обращен)/i, why: 'безлимита по обращениям к ИИ нет ни на одном тарифе' },
  { re: /гарантиру[ею]м/i, why: 'юридических гарантий результата не даём', allowNegated: true },
];

/**
 * Границы слова заданы через \p{L}, а НЕ через \b.
 * JS-овый \b не видит границ кириллицы и арабицы: «нет» внутри русской фразы
 * им не находится, и честное «электронной подписи нет» выглядело бы обещанием.
 * На тех же граблях в этом проекте уже стоял резолвер цитат.
 */
const NEGATIONS = new RegExp(
  '(?<!\\p{L})(нет|не|без|никогда|нельзя|no|not|never|without|kein|keine|ohne|nicht|жоқ|емес|' +
    "yo'q|yoʻq|emas|لا|ليس|بلا)(?!\\p{L})",
  'iu',
);

describe('контент: стоп-лист формулировок', () => {
  for (const page of PAGES) {
    it(`${page.slug}: нет запрещённых обещаний`, () => {
      const problems: string[] = [];
      for (const { path, value } of collectTexts(page, page.slug)) {
        for (const lang of LANGS) {
          // Предложения — чтобы отрицание считалось только рядом, а не где-то на странице.
          for (const sentence of value[lang].split(/(?<=[.!?…])\s+/)) {
            for (const rule of BANNED) {
              if (!rule.re.test(sentence)) continue;
              if (rule.allowNegated && NEGATIONS.test(sentence)) continue;
              if (rule.except?.test(sentence)) continue;
              problems.push(`${path}.${lang}: «${sentence.trim().slice(0, 90)}» — ${rule.why}`);
            }
          }
        }
      }
      expect(problems, problems.join('\n')).toEqual([]);
    });
  }
});
