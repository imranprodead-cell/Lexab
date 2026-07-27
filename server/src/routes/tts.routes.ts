/**
 * Озвучка ответов ассистента (MP3, Gemini 3.1 Flash TTS через Cloud
 * Text-to-Speech, фолбэк 3.1 → 2.5 → Chirp3-HD; настройка — ../tts.config.ts).
 *
 * Два роута:
 *  - POST /tts        — весь текст одним ответом (фолбэк клиента для Safari
 *                       без MediaSource-поддержки MP3 и для старых сборок);
 *  - POST /tts/stream — мгновенный старт: конвейер по предложениям, MP3-байты
 *                       уходят прогрессивно (chunked) по мере синтеза; клиент
 *                       читает fetch-ом и играет через MediaSource. Первый
 *                       звук = синтез одного короткого куска (~90 символов).
 * ИИ-квоту тарифа не расходует; защита от прожига: rate-limit, дневной потолок
 * символов, общий лимит байт на нажатие (TTS_MAX_TOTAL_BYTES), отмена синтеза
 * при обрыве клиента.
 */
import { PassThrough } from 'node:stream';
import type { FastifyInstance } from 'fastify';
import { config } from '../config.ts';
import { HttpError } from '../lib/errors.ts';
import { googleAccessToken } from '../lib/googleAuth.ts';
import {
  runChunkPipeline,
  splitTtsChunks,
  stripMarkdownForSpeech,
  ensureSentenceBounds,
  normalizeLegalAbbrRu,
  normalizeDottedNumbersRu,
  isLangNegCached,
  isLanguageArgumentError,
  negCacheLang,
  TtsUpstreamError,
  type TtsAttempt,
} from '../lib/ttsStream.ts';
import { asObject, requireString } from '../lib/validate.ts';
import {
  TTS_ATTEMPT_TIMEOUT_MS,
  TTS_FIRST_ATTEMPT_TIMEOUT_MS,
  TTS_CHIRP_LOCALES,
  TTS_DAILY_CHARS_PER_USER,
  TTS_FAST_FIRST,
  TTS_LANGUAGE_CODES,
  TTS_MAX_TEXT_BYTES,
  TTS_MAX_TOTAL_BYTES,
  TTS_MODEL_CHAIN,
  TTS_PROMPT,
  TTS_TOTAL_DEADLINE_MS,
  TTS_VOICE,
  type TtsLang,
} from '../tts.config.ts';

const SYNTH_URL = 'https://texttospeech.googleapis.com/v1/text:synthesize';
export const TTS_OAUTH_SCOPE = 'https://www.googleapis.com/auth/cloud-platform';

/** Язык текста для обязательного voice.languageCode (сам голос один на все
 *  языки). Порядок проверок важен: специфичные буквы казахского/узбекской
 *  кириллицы ловятся ДО общего «похоже на русский», а узбекская латиница
 *  определяется по стоп-словам/букве ʻ — одиночное o'/g' даёт ложный узбекский
 *  на английских притяжательных ("nine o'clock", "Diego's"). */
export function detectTtsLanguage(s: string): TtsLang {
  const sample = s.slice(0, 2000);
  const arab = (sample.match(/[؀-ۿ]/g) ?? []).length;
  const cyr = (sample.match(/[а-яё]/gi) ?? []).length;
  const lat = (sample.match(/[a-z]/gi) ?? []).length;
  if (arab > 0 && arab >= cyr && arab >= lat) return 'ar';
  // Буквы әңөұү есть только в казахском, но одна буква в цитируемом названии
  // не должна перекрашивать весь текст — требуется вес или подтверждение қ/ғ.
  const kkLetters = (sample.match(/[әңөұү]/gi) ?? []).length;
  if (kkLetters >= 2 || (kkLetters >= 1 && /[қғ]/i.test(sample) && cyr > lat)) return 'kk';
  if (cyr > lat) {
    if (/[ўҳ]/i.test(sample)) return 'uz'; // буквы только узбекской кириллицы
    return 'ru';
  }
  const uzWords = (sample.match(/\b(?:va|yoki|uchun|bilan|shartnoma|tomonlar|majburiyat|qonun|ushbu|hamda|davlat|xizmat)\b/gi) ?? []).length;
  if (uzWords >= 2 || /ʻ/.test(sample)) return 'uz';
  if (/[äöüß]/.test(sample) || /\b(?:und|nicht|für|eine|werden|Vertrag|gemäß|Haftung)\b/i.test(sample)) return 'de';
  return 'en';
}

/** Обрезка до лимита БАЙТ UTF-8 (лимит Cloud TTS — байты, не символы),
 *  по возможности — по границе предложения. Суррогатные пары (эмодзи) не
 *  рвутся: одинокий хвостовой суррогат сломал бы JSON для Google и уронил бы
 *  ВСЕ шаги фолбэка одинаковым INVALID_ARGUMENT. */
export function clipTtsText(s: string, maxBytes: number): string {
  let out = s;
  while (Buffer.byteLength(out, 'utf8') > maxBytes) {
    out = out.slice(0, Math.floor(out.length * 0.9));
    if (/[\uD800-\uDBFF]$/.test(out)) out = out.slice(0, -1);
  }
  if (out === s) return out;
  const cut = Math.max(out.lastIndexOf('. '), out.lastIndexOf('! '), out.lastIndexOf('? '), out.lastIndexOf('\n'));
  if (cut > out.length * 0.5) out = out.slice(0, cut + 1);
  return out;
}

/** Режим аутентификации по форме значения GOOGLE_TTS_CREDENTIALS_JSON:
 *  JSON сервисного аккаунта → OAuth и полная цепочка Gemini→Chirp;
 *  простой API-ключ (AIza…) → только Chirp3-HD (Gemini-модели требуют
 *  IAM-роль aiplatform, которую API-ключ нести не может — живой 403). */
export function ttsAuthMode(cred: string): 'service-account' | 'api-key' {
  return cred.trim().startsWith('{') ? 'service-account' : 'api-key';
}

async function resolveTtsAuth(): Promise<Record<string, string>> {
  if (ttsAuthMode(config.googleTtsCredentialsJson) === 'service-account') {
    const { token, projectId } = await googleAccessToken(config.googleTtsCredentialsJson, TTS_OAUTH_SCOPE);
    return { authorization: `Bearer ${token}`, ...(projectId ? { 'x-goog-user-project': projectId } : {}) };
  }
  return { 'x-goog-api-key': config.googleTtsCredentialsJson.trim() };
}

/** Порядок попыток: каждая Gemini-модель × кандидаты languageCode (только при
 *  сервисном аккаунте), затем стабильный Chirp3-HD (если для языка существует). */
function buildAttempts(lang: TtsLang): TtsAttempt[] {
  const attempts: TtsAttempt[] = [];
  if (ttsAuthMode(config.googleTtsCredentialsJson) === 'service-account') {
    for (const model of TTS_MODEL_CHAIN) {
      for (const code of TTS_LANGUAGE_CODES[lang]) attempts.push({ model, voice: TTS_VOICE, languageCode: code });
    }
  }
  const chirpLocale = TTS_CHIRP_LOCALES[lang];
  if (chirpLocale) attempts.push({ voice: `${chirpLocale}-Chirp3-HD-${TTS_VOICE}`, languageCode: chirpLocale });
  return attempts;
}

async function synthesize(
  a: TtsAttempt,
  text: string,
  authHeaders: Record<string, string>,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<Buffer> {
  const timeout = AbortSignal.timeout(Math.max(1, timeoutMs));
  const res = await fetch(SYNTH_URL, {
    method: 'POST',
    headers: { ...authHeaders, 'content-type': 'application/json' },
    body: JSON.stringify({
      // prompt поддерживают только Gemini-модели — Chirp3-HD его не принимает.
      input: { text, ...(a.model && TTS_PROMPT ? { prompt: TTS_PROMPT } : {}) },
      voice: { languageCode: a.languageCode, name: a.voice, ...(a.model ? { model_name: a.model } : {}) },
      audioConfig: { audioEncoding: 'MP3' },
    }),
    signal: signal ? AbortSignal.any([timeout, signal]) : timeout,
  });
  if (!res.ok) throw new TtsUpstreamError(res.status, `HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = (await res.json()) as { audioContent?: string };
  if (!data.audioContent) throw new TtsUpstreamError(502, 'пустой audioContent в ответе');
  return Buffer.from(data.audioContent, 'base64');
}

/** synthesize с замером — распределение латентности моделей копится в логах
 *  (вход для настройки fast-first и цепочки). */
async function synthesizeTimed(
  a: TtsAttempt,
  text: string,
  authHeaders: Record<string, string>,
  timeoutMs: number,
  signal: AbortSignal | undefined,
  log: (obj: Record<string, unknown>, msg: string) => void,
): Promise<Buffer> {
  const t0 = Date.now();
  const buf = await synthesize(a, text, authHeaders, timeoutMs, signal);
  log({ model: a.model ?? a.voice, chars: text.length, ms: Date.now() - t0 }, 'tts: synthesize');
  return buf;
}

/* ── Дневной потолок символов на пользователя (в памяти процесса, дата UTC) ── */

const dailyUsage = new Map<string, { day: string; chars: number }>();

function usedToday(userId: string): number {
  const day = new Date().toISOString().slice(0, 10);
  if (dailyUsage.size > 5000) {
    for (const [k, v] of dailyUsage) if (v.day !== day) dailyUsage.delete(k);
  }
  const u = dailyUsage.get(userId);
  return u && u.day === day ? u.chars : 0;
}

function addDailyUsage(userId: string, chars: number): void {
  const day = new Date().toISOString().slice(0, 10);
  dailyUsage.set(userId, { day, chars: usedToday(userId) + chars });
}

/** Резерв бюджета СРАЗУ (проверка+списание в одном синхронном тике — гонка
 *  параллельного залпа закрыта, находка финального аудита); фактически
 *  несинтезированное возвращается refundDailyBudget-ом по завершении. */
function reserveDailyBudget(userId: string, chars: number): void {
  if (usedToday(userId) + chars > TTS_DAILY_CHARS_PER_USER) {
    throw new HttpError(429, 'Дневной лимит озвучки исчерпан — попробуйте завтра. / Daily text-to-speech limit reached, try again tomorrow.');
  }
  addDailyUsage(userId, chars);
}

function refundDailyBudget(userId: string, chars: number): void {
  if (chars > 0) {
    const day = new Date().toISOString().slice(0, 10);
    dailyUsage.set(userId, { day, chars: Math.max(0, usedToday(userId) - chars) });
  }
}

function requireConfigured(): void {
  if (!config.googleTtsCredentialsJson) {
    throw new HttpError(503, 'Озвучка не настроена на сервере. / Text-to-speech is not configured on this server.');
  }
}

function requireAttempts(lang: TtsLang): TtsAttempt[] {
  const attempts = buildAttempts(lang);
  if (attempts.length === 0) {
    // API-ключ + язык без Chirp-локали (uz/kk): честно объясняем, что нужно.
    throw new HttpError(502, 'Для озвучки этого языка нужен ключ сервисного аккаунта Google (см. server/.env.example). / This language needs a Google service-account key.');
  }
  return attempts;
}

export function ttsRoutes(app: FastifyInstance): void {
  /* Весь текст одним ответом — совместимость и клиентский фолбэк. */
  app.post(
    '/tts',
    { preHandler: [app.authenticateTts], config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req, reply) => {
      requireConfigured();
      const body = asObject(req.body);
      const raw = stripMarkdownForSpeech(requireString(body, 'text', { min: 1, max: 30_000 })).trim();
      if (!raw) throw new HttpError(400, 'Пустой текст. / Empty text.');
      const lang = detectTtsLanguage(raw);
      // «ст. 1142» → «статья 1142», «6.2» → «6 точка 2»: иначе Gemini угадывает.
      // ensureSentenceBounds — иначе Gemini 400 «sentences too long» на таблицах.
      const text = clipTtsText(
        ensureSentenceBounds(lang === 'ru' ? normalizeDottedNumbersRu(normalizeLegalAbbrRu(raw)) : raw),
        TTS_MAX_TEXT_BYTES,
      );
      // Обрыв клиента: слушаем reply.raw — req.raw эмитит 'close' уже при
      // дочитывании ТЕЛА запроса и фикс на нём был мёртв (доказано живым
      // сокетом в финальном аудите).
      const clientGone = new AbortController();
      reply.raw.on('close', () => {
        if (!reply.raw.writableEnded) clientGone.abort();
      });
      reserveDailyBudget(req.currentUser.id, text.length);
      const attempts = requireAttempts(lang);
      const authHeaders = await resolveTtsAuth();

      // Общий дедлайн: фолбэк не должен держать соединение минутами.
      const deadline = Date.now() + TTS_TOTAL_DEADLINE_MS;
      let audio: Buffer | null = null;
      let lastErr = '';
      passes: for (const includeSoft of [true, false]) {
        let anyTried = false;
        for (const a of attempts) {
          if (isLangNegCached(a.model, a.languageCode, includeSoft)) continue;
          if (clientGone.signal.aborted) throw new HttpError(499, 'Клиент отменил запрос. / Client cancelled.');
          const left = deadline - Date.now();
          if (left < 3_000) break passes;
          anyTried = true;
          try {
            audio = await synthesize(a, text, authHeaders, Math.min(TTS_ATTEMPT_TIMEOUT_MS, left), clientGone.signal);
            break passes;
          } catch (err) {
            lastErr = err instanceof Error ? err.message : String(err);
            if (isLanguageArgumentError(err)) negCacheLang(a.model, a.languageCode);
            req.log.warn({ step: a.model ?? a.voice, languageCode: a.languageCode, err: lastErr }, 'tts: шаг не сработал');
            if (clientGone.signal.aborted) break passes; // клиент ушёл — не жечь следующие шаги
          }
        }
        if (anyTried) break; // спасательный проход — только если всё скипнул кэш
      }
      if (!audio) {
        refundDailyBudget(req.currentUser.id, text.length); // ничего не синтезировано
        req.log.error({ lang, lastErr }, 'tts: все шаги фолбэка исчерпаны');
        throw new HttpError(502, 'Не удалось озвучить текст — сервис временно недоступен. / Text-to-speech is temporarily unavailable.');
      }
      return reply.header('content-type', 'audio/mpeg').header('cache-control', 'no-store').send(audio);
    },
  );

  /* Мгновенный старт: конвейер по предложениям внутри одного авторизованного
   * запроса. Первый кусок синтезируется ДО отправки заголовков (честные
   * 4xx/5xx, если не вышло), затем ответ становится chunked-стримом и куски
   * уходят по мере готовности. Обрыв клиента отменяет синтез (грейс не нужен —
   * клиент читает fetch-ом, у него нет Safari-probe-запросов). */
  app.post(
    '/tts/stream',
    { preHandler: [app.authenticateTts], config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req, reply) => {
      requireConfigured();
      const body = asObject(req.body);
      // Markdown → простой текст: иначе голос читает «решётка, звёздочка».
      const raw = stripMarkdownForSpeech(requireString(body, 'text', { min: 1, max: 30_000 })).trim();
      if (!raw) throw new HttpError(400, 'Пустой текст. / Empty text.');
      const lang = detectTtsLanguage(raw);
      // «ст. 1142» → «статья 1142», «6.2» → «6 точка 2»: иначе Gemini угадывает.
      // ensureSentenceBounds — иначе Gemini 400 «sentences too long» на таблицах.
      const text = clipTtsText(
        ensureSentenceBounds(lang === 'ru' ? normalizeDottedNumbersRu(normalizeLegalAbbrRu(raw)) : raw),
        TTS_MAX_TOTAL_BYTES,
      );
      // ВАЖНО (приватность): сам текст в логи НЕ пишем — дисциплина проекта
      // «метаданные без текста договора» (находка финального аудита).
      const userId = req.currentUser.id;
      const chunks = splitTtsChunks(text);
      if (chunks.length === 0) throw new HttpError(400, 'Пустой текст. / Empty text.');
      const attempts = requireAttempts(lang);
      // Обрыв клиента: reply.raw (см. комментарий в /tts — req.raw тут мёртв).
      const clientGone = new AbortController();
      reply.raw.on('close', () => {
        if (!reply.raw.writableEnded) clientGone.abort();
      });
      reserveDailyBudget(userId, text.length);
      const authHeaders = await resolveTtsAuth();

      const pt = new PassThrough();
      let firstChunkSent: ((ok: boolean) => void) | null = null;
      const firstChunk = new Promise<boolean>((resolve) => {
        firstChunkSent = resolve;
      });

      // Быстрый старт: первое предложение — мгновенный Chirp3-HD тем же именем
      // голоса (~1 с против ~4 с Gemini); остальной ролик — Gemini. Только при
      // сервисном аккаунте (в api-key-режиме основная цепочка и так Chirp).
      const chirpLocale = TTS_CHIRP_LOCALES[lang];
      // При коротком ответе (<3 кусков) fast-first выключен: иначе весь ответ
      // читал бы Chirp, а не основная модель.
      const fastFirstAttempt =
        TTS_FAST_FIRST && chunks.length >= 3 && chirpLocale && ttsAuthMode(config.googleTtsCredentialsJson) === 'service-account'
          ? { voice: `${chirpLocale}-Chirp3-HD-${TTS_VOICE}`, languageCode: chirpLocale }
          : undefined;

      let synthesizedChars = 0;
      const pipeline = runChunkPipeline(chunks, attempts, {
        synthesize: (a, chunkText, signal, timeoutMs) => synthesizeTimed(a, chunkText, authHeaders, timeoutMs, signal, (o, m) => req.log.info(o, m)),
        signal: clientGone.signal,
        attemptTimeoutMs: TTS_ATTEMPT_TIMEOUT_MS,
        firstAttemptTimeoutMs: TTS_FIRST_ATTEMPT_TIMEOUT_MS,
        totalDeadlineMs: TTS_TOTAL_DEADLINE_MS,
        fastFirstAttempt,
        emit: (buf) => {
          pt.write(buf);
          firstChunkSent?.(true);
          firstChunkSent = null;
        },
        onChunkDone: (chars) => {
          synthesizedChars += chars;
        },
        log: (obj, msg) => req.log.warn(obj, msg),
      });
      void pipeline.then((result) => {
        // Возврат неиспользованной части резерва (оплата = фактический синтез).
        refundDailyBudget(userId, Math.max(0, text.length - synthesizedChars));
        firstChunkSent?.(false);
        firstChunkSent = null;
        if (!result.complete && result.done > 0) {
          req.log.error({ done: result.done, total: result.total }, 'tts-stream: ролик отдан не целиком');
          // destroy, не end: у клиента read() упадёт, буфер доиграет, но
          // обрезанный ролик НЕ закэшируется как полный. Невычитанные байты
          // внутреннего буфера при этом теряются — ролик и так неполный.
          pt.destroy(new Error('incomplete'));
          return;
        }
        pt.end();
      });

      // Первый кусок ждём ДО заголовков: провал = честная HTTP-ошибка.
      const ok = await firstChunk;
      if (!ok) {
        pt.destroy();
        req.log.error({ lang }, 'tts-stream: первый кусок не синтезировался');
        throw new HttpError(502, 'Не удалось озвучить текст — сервис временно недоступен. / Text-to-speech is temporarily unavailable.');
      }
      return reply
        .header('content-type', 'audio/mpeg')
        .header('cache-control', 'no-store')
        .header('x-accel-buffering', 'no')
        .send(pt);
    },
  );
}
