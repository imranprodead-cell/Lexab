/**
 * Типы контента публичного сайта.
 *
 * ЗАЧЕМ ОТДЕЛЬНЫЙ ТИП, А НЕ pickText-литерал. Существующий `pickText` принимает
 * `{ ru, en } & Partial<Record<Language, string>>` и при отсутствии перевода
 * МОЛЧА отдаёт английский. Из-за этого /terms и /privacy двуязычны при шести
 * заявленных языках, а часть заголовков лендинга уже без ar/kk/uz — и сборка
 * об этом не сообщает. `Text6` требует все шесть языков на уровне типов, а
 * тест (src/content/content.test.ts) добивает то, что тип не ловит: пустые
 * строки и копии английского.
 *
 * ЗАЧЕМ КОНТЕНТ — ДАННЫЕ, А НЕ JSX. Страница описывается массивом блоков,
 * поэтому: контент едет ленивым чанком своей страницы (главный чанк не растёт
 * ни на байт), один рендерер даёт 13 страницам общий каркас и единое поведение
 * в RTL и тёмной теме, а полнота языков проверяется обходом данных.
 */
import type { Language } from '@/i18n/messages';

/** Строка на ВСЕХ шести языках — без необязательных ключей. */
export type Text6 = Record<Language, string>;

/** Выбрать язык. Фолбэка нет намеренно: тип гарантирует наличие значения. */
export function text(value: Text6, lang: Language): string {
  return value[lang];
}

/** Первый экран: заголовок, подзаголовок, строка тарифа и кнопки. */
export interface HeroBlock {
  kind: 'hero';
  /** H1 — не длиннее 8 слов, содержит имя модуля. */
  title: Text6;
  /** Что делает — на каком входе — что на выходе — с какой проверяемостью. */
  lead: Text6;
  /** «Доступно с тарифа Pro» — ставится, только если у модуля есть гейт. */
  planNote?: Text6;
  cta: CtaLink[];
}

/** Полоса проверяемых фактов: цифра + чем доказывается. */
export interface FactsBlock {
  kind: 'facts';
  title?: Text6;
  items: { value: Text6; label: Text6; proof: Text6 }[];
}

/** Нумерованные шаги: механика, а не выгода. */
export interface StepsBlock {
  kind: 'steps';
  title: Text6;
  items: { title: Text6; body: Text6 }[];
}

/** Список: «что именно вы получаете», «границы модуля» и т.п. */
export interface ListBlock {
  kind: 'list';
  title: Text6;
  /** 'limits' рисуется приглушённо — это блок «чего модуль не делает». */
  tone?: 'default' | 'limits';
  intro?: Text6;
  items: { title: Text6; body?: Text6 }[];
}

/** Таблица (юрисдикции, лимиты тарифов, скоупы API). */
export interface TableBlock {
  kind: 'table';
  title: Text6;
  intro?: Text6;
  columns: Text6[];
  rows: Text6[][];
  /** Подпись под таблицей — например дата замера данных. */
  note?: Text6;
}

/**
 * Таблица тарифов. ЧИСЕЛ В КОНТЕНТЕ НЕТ НАМЕРЕННО: цены, лимиты и места
 * рендерер берёт из src/content/site/plans.ts, а тот сцеплен тестом с
 * серверными PLAN_LIMITS. Так страница физически не может обещать больше,
 * чем сервер даёт: цифру негде разойтись, её просто некуда вписать руками.
 * В блоке живут только слова — заголовки колонок и подписи, на шести языках.
 */
export interface PlansBlock {
  kind: 'plans';
  title: Text6;
  intro?: Text6;
  columns: { plan: Text6; price: Text6; ai: Text6; docs: Text6; storage: Text6; seats: Text6 };
  labels: { perMonth: Text6; unlimited: Text6; custom: Text6; yearlyNote: Text6 };
  note?: Text6;
}

/** Абзацы обычного текста с необязательным заголовком. */
export interface ProseBlock {
  kind: 'prose';
  title?: Text6;
  paragraphs: Text6[];
}

/** Честное примечание об ограничении — визуально выделено, но не тревожно. */
export interface NoteBlock {
  kind: 'note';
  title?: Text6;
  body: Text6;
}

/** Вопросы и ответы. Минимум один вопрос обязан быть про ограничение. */
export interface FaqBlock {
  kind: 'faq';
  title: Text6;
  items: { q: Text6; a: Text6 }[];
}

/** Ссылки вглубь сайта: читатель должен уходить в сайт, а не отскакивать. */
export interface RelatedBlock {
  kind: 'related';
  title: Text6;
  items: { title: Text6; body: Text6; to: string }[];
}

/** Финальный призыв. */
export interface CtaBlock {
  kind: 'cta';
  title: Text6;
  body?: Text6;
  cta: CtaLink[];
}

export interface CtaLink {
  label: Text6;
  /** Внутренний путь ('/pricing') либо внешний адрес ('https://…'). */
  to: string;
  variant?: 'primary' | 'secondary';
}

export type Block =
  | HeroBlock
  | FactsBlock
  | StepsBlock
  | ListBlock
  | TableBlock
  | PlansBlock
  | ProseBlock
  | NoteBlock
  | FaqBlock
  | RelatedBlock
  | CtaBlock;

/** Описание одной публичной страницы целиком. */
export interface PageContent {
  /** Латинский слаг: он же путь и имя каталога в dist. Не переводится. */
  slug: string;
  /** Заголовок вкладки браузера (по языкам). */
  pageTitle: Text6;
  blocks: Block[];
}
