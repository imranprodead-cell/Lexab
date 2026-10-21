/**
 * Модели Claude — в одном месте. Следующее обновление поколения = правка здесь
 * (плюс прогон `npm run eval` до и после, правило №5 CLAUDE.md).
 *
 * Переход 2026-10-21: Fable 5 → Opus 5.5 (Business/Enterprise), Sonnet 5 →
 * Sonnet 5.5 (Standard/Pro), Haiku 4.5 → Haiku 5.5 (служебные вызовы),
 * Opus 4.8 → Opus 5.5 (модель по умолчанию).
 */
export const MODELS = {
  /** Business/Enterprise и модель по умолчанию для неизвестного тарифа. */
  opus: 'claude-opus-5-5',
  /** Standard/Pro; запасная модель для платных тарифов. */
  sonnet: 'claude-sonnet-5-5',
  /** Служебные микрозапросы (переписчик поиска, судья цитат, сводка чата,
   *  «улучшить запрос», OCR) и запасная модель для Free при сбое DeepSeek. */
  haiku: 'claude-haiku-5-5',
} as const;

/**
 * Параметры «без размышлений» для короткого запроса. У моделей поколения 5.5
 * размышления включены по умолчанию и считаются в max_tokens: на микрозапросе
 * (сводка на 500 токенов, вердикт судьи на 100) они съедают весь бюджет, и
 * ответ приходит пустым. Выключаются они у каждой модели по-своему:
 *  - Haiku: `{type: 'disabled'}` (допустимо при effort не выше high);
 *  - Sonnet 5.5: только `{type: 'between_tools'}` — `disabled` там даёт 400;
 *  - Opus 5.5 и Fable: выключить нельзя вовсе (любая попытка — 400), поэтому
 *    им ничего не шлём.
 * Объект без точного типа: в установленной версии SDK ещё нет `between_tools`.
 */
export function noThinking(model: string): Record<string, unknown> {
  if (/haiku/.test(model)) return { thinking: { type: 'disabled' } };
  if (/sonnet-5-5/.test(model)) return { thinking: { type: 'between_tools' } };
  return {};
}

/**
 * Страховка от ложного отказа фильтров безопасности: если модель отклонила
 * запрос (договор иногда задевает фильтры на безобидной юридической работе),
 * Anthropic сам переигрывает его на рекомендованной модели в том же вызове.
 * Форма `'default'` — список запасных моделей ведёт Anthropic, нам не нужно
 * держать в коде старые id. Есть у Opus 5.5, Sonnet 5.5 и Fable 5.1; у Haiku
 * 5.5 серверной страховки нет (с ней запрос отклоняется 400).
 */
export function serverFallback(model: string): Record<string, unknown> {
  return /opus-5-5|sonnet-5-5|fable-5-1|mythos-5-1/.test(model)
    ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' }
    : {};
}
