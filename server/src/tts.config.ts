/**
 * Озвучка ответов ассистента — Gemini-TTS через Cloud Text-to-Speech API.
 * ЕДИНСТВЕННОЕ место настройки моделей, голоса и языковых кодов: меняете здесь —
 * меняется везде. Схема запроса сверена с документацией 2026-07:
 * https://docs.cloud.google.com/text-to-speech/docs/gemini-tts
 */

export type TtsLang = 'ru' | 'en' | 'de' | 'ar' | 'uz' | 'kk';

/** Один голос для всех языков — голоса Gemini-TTS языконезависимы. */
export const TTS_VOICE = 'Kore';

/** Цепочка Gemini-моделей: preview → stable. Порядок = порядок попыток. */
export const TTS_MODEL_CHAIN = ['gemini-3.1-flash-tts-preview', 'gemini-2.5-flash-tts'];

/** Кандидаты обязательного voice.languageCode по языку текста (это карта
 *  язык→код, НЕ язык→голос). Узбекского и казахского нет в официальных
 *  таблицах Cloud TTS: первый кандидат — честный код (вдруг принимает),
 *  второй — запасной; подбирается по живому тесту. */
export const TTS_LANGUAGE_CODES: Record<TtsLang, string[]> = {
  ru: ['ru-RU'],
  en: ['en-US'],
  de: ['de-DE'],
  ar: ['ar-001', 'ar-EG'],
  uz: ['uz-UZ', 'en-US'],
  kk: ['kk-KZ', 'ru-RU'],
};

/** Финальный фолбэк — голоса Chirp3-HD (стабильные, без model_name).
 *  Существуют только для этих локалей; uz/kk у Chirp3-HD нет. */
export const TTS_CHIRP_LOCALES: Partial<Record<TtsLang, string>> = {
  ru: 'ru-RU',
  en: 'en-US',
  de: 'de-DE',
  ar: 'ar-XA',
};

/** Лимит Cloud TTS — 4000 байт UTF-8 на input.text; режем с запасом. */
export const TTS_MAX_TEXT_BYTES = 3800;

/** Дневной потолок озвучиваемых символов на пользователя — защита от прожига
 *  платного Google-API с бесплатных аккаунтов (счётчик в памяти процесса,
 *  сброс по дате UTC; при рестарте обнуляется — потолок страховочный). */
export const TTS_DAILY_CHARS_PER_USER = 100_000;

/** Общий дедлайн запроса озвучки и таймаут одного шага фолбэка. */
export const TTS_TOTAL_DEADLINE_MS = 90_000;
export const TTS_ATTEMPT_TIMEOUT_MS = 45_000;

/** Стилевая инструкция (input.prompt) — поддерживается только Gemini-моделями. */
export const TTS_PROMPT = 'Read the text aloud in a calm, clear, professional voice.';
