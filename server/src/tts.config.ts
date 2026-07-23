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

/** Общий дедлайн запроса озвучки и таймаут одного шага фолбэка. Здоровая
 *  Gemini отвечает за 3–8 с; 15 с отсекают её деградацию (перегруженная
 *  preview-модель временами думает 45+ с) и быстро уступают ход Chirp3-HD. */
export const TTS_TOTAL_DEADLINE_MS = 90_000;
export const TTS_ATTEMPT_TIMEOUT_MS = 10_000;
/** Попытки ПЕРВОГО куска короче: больная модель не должна держать первый звук
 *  10+ секунд (критично для коротких ответов, где fast-first выключен). */
export const TTS_FIRST_ATTEMPT_TIMEOUT_MS = 6_000;
/** «Кэш деградации»: модель, ответившая таймаутом, пропускается эти N мс —
 *  хвост ролика сразу читает Chirp вместо повторных ожиданий по 10 с. */
export const TTS_SLOW_CACHE_MS = 3 * 60 * 1000;

/* ── Стриминг по предложениям (мгновенный старт) ─────────────────────────────
 * Первый кусок маленький — его синтез и есть время до первого звука;
 * остальные крупнее и синтезируются конвейером, пока первый уже играет. */
export const TTS_FIRST_CHUNK_MAX_CHARS = 90;
/** Крупнее куски → меньше стыков независимых синтезов → цельнее интонация
 *  (потолок байт на кусок всё равно держит hardSplitByBytes). */
export const TTS_CHUNK_TARGET_CHARS = 700;
/** Быстрый первый кусок: первое предложение читает Chirp3-HD (классический
 *  TTS, ~1 с вместо ~4 с у Gemini) тем же именем голоса; остальной ролик —
 *  Gemini. Цена — лёгкая смена тембра после первой фразы. false = весь ролик
 *  одним движком (медленнее старт, идеальная однородность). */
export const TTS_FAST_FIRST = true;
/** Потолок стоимости ОДНОГО нажатия: общий лимит байт текста на весь стрим
 *  (чанки сняли бы старый лимит 3800 — возвращаем его на уровне целого). */
export const TTS_MAX_TOTAL_BYTES = 10_000;
/** Сколько кусков синтезируется одновременно (1 играет + 1 греется). */
export const TTS_PIPELINE_CONCURRENCY = 2;
/** Негативный кэш languageCode: детерминированный 400 от Google (uz-UZ/kk-KZ
 *  не существуют) не переспрашиваем сутки — экономит ~1.5 с на каждом клике. */
export const TTS_LANG_NEG_CACHE_MS = 24 * 60 * 60 * 1000;

/** Стилевая инструкция (input.prompt) — поддерживается только Gemini-моделями.
 *  Вторая фраза обязательна: Gemini-TTS — языковая модель и без неё порой
 *  «дочитывает своё» или заменяет слова. */
export const TTS_PROMPT =
  'Speak in a warm, lively, natural tone — a confident, friendly legal advisor explaining things clearly to a client. ' +
  'Speak with natural, unhurried pacing: brief pauses at commas, clear pauses at sentence ends, a longer breath between paragraphs; give questions a natural rising intonation. ' +
  'Read the text EXACTLY as written: never add, skip, replace or paraphrase words; read numbers and citations plainly.';
