/**
 * Закрытые карточки над полем ввода чата — уточняющие вопросы ИИ и «Продолжить
 * с этим планом?»: помним id ответа, у которого карточку закрыли.
 *
 * Раньше пометка жила в состоянии страницы чата, а «Новый чат» (/chat) и
 * старый чат (/chat/:id) — разные маршруты: страница создавалась заново, и
 * закрытая карточка возвращалась при каждом заходе в чат (замечание владельца
 * 14.11). Теперь — в localStorage: переживает и переход между чатами, и
 * перезагрузку. Хранилище недоступно (приватный режим, запрет сайта) — помним
 * до закрытия вкладки. Id ответов — серверные и уникальные, поэтому общий
 * список на браузер не путает пользователей и чаты.
 */
const STORAGE_KEY = 'lexab.dismissedCards';
/** Нужны только свежие ответы — старые пометки вытесняются. */
const LIMIT = 300;

export type CardKind = 'ask' | 'plan';

let cache: string[] | null = null;

function load(): string[] {
  if (cache) return cache;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    cache = Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    cache = [];
  }
  return cache;
}

export function isCardDismissed(kind: CardKind, replyId: string): boolean {
  return load().includes(`${kind}:${replyId}`);
}

export function dismissCard(kind: CardKind, replyId: string): void {
  const key = `${kind}:${replyId}`;
  cache = [...load().filter((k) => k !== key), key].slice(-LIMIT);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cache));
  } catch {
    // нет хранилища — пометка останется в памяти вкладки
  }
}

/** Только для тестов: забыть кэш (как новая вкладка). */
export function resetDismissedCardsCache(): void {
  cache = null;
}
