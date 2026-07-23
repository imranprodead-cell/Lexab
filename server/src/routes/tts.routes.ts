/**
 * Озвучка ответов ассистента (MP3, Gemini 3.1 Flash TTS через Cloud
 * Text-to-Speech, фолбэк 3.1 → 2.5 → Chirp3-HD; настройка — ../tts.config.ts).
 *
 * Три роута:
 *  - POST /tts          — весь текст одним ответом (совместимость + фолбэк
 *                         клиента для Safari/старых сборок);
 *  - POST /tts/prepare  — мгновенный старт: режет текст на куски, создаёт
 *                         запись стрима, возвращает {url};
 *  - GET  /tts/stream/:id — прогрессивный MP3-стрим: куски синтезируются
 *                         конвейером и уходят клиенту по мере готовности;
 *                         первый звук = синтез одного короткого предложения.
 * ИИ-квоту тарифа не расходует; защита от прожига: rate-limit, дневной потолок
 * символов, общий лимит байт на нажатие (TTS_MAX_TOTAL_BYTES).
 */
import { PassThrough } from 'node:stream';
import type { FastifyInstance } from 'fastify';
import { config } from '../config.ts';
import { HttpError, notFound } from '../lib/errors.ts';
import { googleAccessToken } from '../lib/googleAuth.ts';
import {
  createStreamRecord,
  getStreamRecord,
  addReader,
  removeReader,
  startPipeline,
  splitTtsChunks,
  isLangNegCached,
  negCacheLang,
  TtsUpstreamError,
  type TtsAttempt,
} from '../lib/ttsStream.ts';
import { asObject, requireString } from '../lib/validate.ts';
import {
  TTS_ATTEMPT_TIMEOUT_MS,
  TTS_CHIRP_LOCALES,
  TTS_DAILY_CHARS_PER_USER,
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

function ensureDailyBudget(userId: string, chars: number): void {
  if (usedToday(userId) + chars > TTS_DAILY_CHARS_PER_USER) {
    throw new HttpError(429, 'Дневной лимит озвучки исчерпан — попробуйте завтра. / Daily text-to-speech limit reached, try again tomorrow.');
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
    { preHandler: [app.authenticate], config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req, reply) => {
      requireConfigured();
      const body = asObject(req.body);
      const raw = requireString(body, 'text', { min: 1, max: 30_000 }).trim();
      if (!raw) throw new HttpError(400, 'Пустой текст. / Empty text.');
      const text = clipTtsText(raw, TTS_MAX_TEXT_BYTES);
      const lang = detectTtsLanguage(text);
      ensureDailyBudget(req.currentUser.id, text.length);
      const attempts = requireAttempts(lang);
      const authHeaders = await resolveTtsAuth();

      // Обрыв клиента (стоп/закрытая вкладка) отменяет запрос к Google —
      // синтез в закрытый сокет всё равно оплачивается (находка ломателя).
      const clientGone = new AbortController();
      req.raw.on('close', () => {
        if (req.raw.destroyed && !reply.raw.writableEnded) clientGone.abort();
      });

      // Общий дедлайн: фолбэк не должен держать соединение минутами.
      const deadline = Date.now() + TTS_TOTAL_DEADLINE_MS;
      let audio: Buffer | null = null;
      let lastErr = '';
      for (const a of attempts) {
        if (isLangNegCached(a.model, a.languageCode)) continue;
        if (clientGone.signal.aborted) throw new HttpError(499, 'Клиент отменил запрос. / Client cancelled.');
        const left = deadline - Date.now();
        if (left < 3_000) break;
        try {
          audio = await synthesize(a, text, authHeaders, Math.min(TTS_ATTEMPT_TIMEOUT_MS, left), clientGone.signal);
          break;
        } catch (err) {
          lastErr = err instanceof Error ? err.message : String(err);
          if (err instanceof TtsUpstreamError && err.status === 400) negCacheLang(a.model, a.languageCode);
          req.log.warn({ step: a.model ?? a.voice, languageCode: a.languageCode, err: lastErr }, 'tts: шаг не сработал');
          if (clientGone.signal.aborted) break; // клиент ушёл — не жечь следующие шаги
        }
      }
      if (!audio) {
        req.log.error({ lang, lastErr }, 'tts: все шаги фолбэка исчерпаны');
        throw new HttpError(502, 'Не удалось озвучить текст — сервис временно недоступен. / Text-to-speech is temporarily unavailable.');
      }
      // Дневной счётчик — только за фактически синтезированное.
      addDailyUsage(req.currentUser.id, text.length);
      return reply.header('content-type', 'audio/mpeg').header('cache-control', 'no-store').send(audio);
    },
  );

  /* Мгновенный старт: создать запись стрима, вернуть url. Синтез стартует на
   * первом GET — осиротевшие записи (стоп/двойной клик) не стоят ни цента. */
  app.post(
    '/tts/prepare',
    { preHandler: [app.authenticate], config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req) => {
      requireConfigured();
      const body = asObject(req.body);
      const raw = requireString(body, 'text', { min: 1, max: 30_000 }).trim();
      if (!raw) throw new HttpError(400, 'Пустой текст. / Empty text.');
      const text = clipTtsText(raw, TTS_MAX_TOTAL_BYTES);
      const lang = detectTtsLanguage(text);
      ensureDailyBudget(req.currentUser.id, text.length);
      const chunks = splitTtsChunks(text);
      if (chunks.length === 0) throw new HttpError(400, 'Пустой текст. / Empty text.');
      const rec = createStreamRecord(req.currentUser.id, chunks, requireAttempts(lang));
      // Путь БЕЗ префикса /api: клиентский BASE_URL уже кончается на /api.
      return { url: `/tts/stream/${rec.id}` };
    },
  );

  /* Прогрессивный MP3-стрим. Без Bearer: <audio> не умеет заголовки — модель
   * доверия как у публичных ссылок /sign/:token: невыводимый uuid (capability
   * URL) + TTL 10 мин + id вычищается из access-логов (redactUrl). Утечка id
   * даёт максимум прослушивание этого ролика в TTL: синтез и списание
   * происходят один раз, реплеи идут из кэша.
   * Range игнорируем (честный 200 + Accept-Ranges: none) — так Safari
   * воспринимает ответ как live-поток и играет прогрессивно. */
  app.get(
    '/tts/stream/:id',
    { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (req, reply) => {
      requireConfigured();
      const { id } = req.params as { id: string };
      const rec = getStreamRecord(id);
      if (!rec) throw notFound('Стрим озвучки не найден или истёк / Audio stream not found or expired');

      reply
        .header('content-type', 'audio/mpeg')
        .header('cache-control', 'no-store')
        .header('accept-ranges', 'none')
        .header('x-accel-buffering', 'no');

      // Готовый результат: цельный Buffer с Content-Length (Safari-реплей).
      if (rec.complete) return reply.send(Buffer.concat(rec.buffers));

      addReader(rec);
      const pt = new PassThrough();
      let sent = 0;
      const push = () => {
        while (sent < rec.buffers.length) pt.write(rec.buffers[sent++]);
      };
      const finish = () => {
        push();
        if (!pt.writableEnded) pt.end();
      };
      const onChunk = () => push();
      rec.events.on('chunk', onChunk);
      rec.events.on('end', finish);
      reply.raw.on('close', () => {
        rec.events.off('chunk', onChunk);
        rec.events.off('end', finish);
        removeReader(rec);
      });

      if (!rec.running && !rec.complete) {
        const authHeaders = await resolveTtsAuth(); // до первого байта — ошибки уходят обычным HttpError-путём
        startPipeline(rec, {
          synthesize: (a, chunkText, signal, timeoutMs) => synthesize(a, chunkText, authHeaders, timeoutMs, signal),
          attemptTimeoutMs: TTS_ATTEMPT_TIMEOUT_MS,
          totalDeadlineMs: TTS_TOTAL_DEADLINE_MS,
          onChunkDone: (chars) => addDailyUsage(rec.userId, chars),
          log: (obj, msg) => req.log.warn(obj, msg),
        });
      }
      push();
      // Гонка: конвейер мог завершиться между getStreamRecord и подпиской.
      if (!rec.running && (rec.complete || rec.incomplete)) finish();
      return reply.send(pt);
    },
  );
}
