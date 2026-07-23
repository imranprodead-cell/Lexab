/**
 * Озвучка ответов ассистента — Gemini-TTS через Cloud Text-to-Speech API.
 * ЕДИНСТВЕННОЕ место настройки моделей, голоса и языковых кодов: меняете здесь —
 * меняется везде. Схема запроса сверена с документацией 2026-07:
 * https://docs.cloud.google.com/text-to-speech/docs/gemini-tts
 */

export type TtsLang = 'ru' | 'en' | 'de' | 'ar' | 'uz' | 'kk';

/** Один голос для всех языков — голоса Gemini-TTS языконезависимы.
 *  Charon («информативный», низкий уверенный) — выбор пользователя из живого
 *  прослушивания 7 образцов (2026-07-23); существует и в Chirp3-HD. */
export const TTS_VOICE = 'Charon';

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

/* ── Стриминг по предложениям (мгновенный старт) ─────────────────────────────
 * Первый кусок маленький — его синтез и есть время до первого звука;
 * остальные крупнее и синтезируются конвейером, пока первый уже играет. */
export const TTS_FIRST_CHUNK_MAX_CHARS = 160;
export const TTS_CHUNK_TARGET_CHARS = 500;
/** Потолок стоимости ОДНОГО нажатия: общий лимит байт текста на весь стрим
 *  (чанки сняли бы старый лимит 3800 — возвращаем его на уровне целого). */
export const TTS_MAX_TOTAL_BYTES = 10_000;
/** Жизнь записи стрима (реплей в этом окне — мгновенный и бесплатный). */
export const TTS_STREAM_TTL_MS = 10 * 60 * 1000;
/** Капы кэша стримов: по записям И по байтам (MP3 до ~4 МБ на запись).
 *  Пер-пользовательский кап не даёт спамом prepare выселить чужие стримы. */
export const TTS_STREAM_MAX_RECORDS = 50;
export const TTS_STREAM_MAX_TOTAL_BYTES = 64 * 1024 * 1024;
export const TTS_STREAM_MAX_PER_USER = 3;
/** Сколько кусков синтезируется одновременно (1 играет + 1 греется). */
export const TTS_PIPELINE_CONCURRENCY = 2;
/** Грейс до отмены синтеза после ухода всех слушателей: Safari шлёт пробный
 *  Range-запрос и рвёт его — мгновенная отмена убивала бы конвейер зря. */
export const TTS_ABORT_GRACE_MS = 5_000;
/** Негативный кэш languageCode: детерминированный 400 от Google (uz-UZ/kk-KZ
 *  не существуют) не переспрашиваем сутки — экономит ~1.5 с на каждом клике. */
export const TTS_LANG_NEG_CACHE_MS = 24 * 60 * 60 * 1000;

/** Стилевая инструкция (input.prompt) — поддерживается только Gemini-моделями. */
export const TTS_PROMPT = 'Speak in a warm, lively, natural tone — a confident, friendly legal advisor explaining things clearly to a client.';
