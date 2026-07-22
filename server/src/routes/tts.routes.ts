/**
 * POST /tts — озвучка ответа ассистента (MP3).
 * Gemini 3.1 Flash TTS через Cloud Text-to-Speech с фолбэком:
 * 3.1-preview → 2.5-stable → Chirp3-HD (для локалей, где он существует).
 * Модели/голос/языковые коды/лимиты настраиваются в ../tts.config.ts.
 * ИИ-квоту тарифа НЕ расходует; только авторизованным (401 без токена);
 * от прожига платного API защищают rate-limit и дневной потолок символов.
 */
import type { FastifyInstance } from 'fastify';
import { config } from '../config.ts';
import { HttpError } from '../lib/errors.ts';
import { googleAccessToken } from '../lib/googleAuth.ts';
import { asObject, requireString } from '../lib/validate.ts';
import {
  TTS_ATTEMPT_TIMEOUT_MS,
  TTS_CHIRP_LOCALES,
  TTS_DAILY_CHARS_PER_USER,
  TTS_LANGUAGE_CODES,
  TTS_MAX_TEXT_BYTES,
  TTS_MODEL_CHAIN,
  TTS_PROMPT,
  TTS_TOTAL_DEADLINE_MS,
  TTS_VOICE,
  type TtsLang,
} from '../tts.config.ts';

const SYNTH_URL = 'https://texttospeech.googleapis.com/v1/text:synthesize';
const OAUTH_SCOPE = 'https://www.googleapis.com/auth/cloud-platform';

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

interface TtsAttempt {
  /** Gemini-модель; отсутствует у шага Chirp3-HD (там модель зашита в имя голоса). */
  model?: string;
  voice: string;
  languageCode: string;
}

/** Режим аутентификации по форме значения GOOGLE_TTS_CREDENTIALS_JSON:
 *  JSON сервисного аккаунта → OAuth и полная цепочка Gemini→Chirp;
 *  простой API-ключ (AIza…) → только Chirp3-HD (Gemini-модели требуют
 *  IAM-роль aiplatform, которую API-ключ нести не может — живой 403). */
export function ttsAuthMode(cred: string): 'service-account' | 'api-key' {
  return cred.trim().startsWith('{') ? 'service-account' : 'api-key';
}

async function synthesize(a: TtsAttempt, text: string, authHeaders: Record<string, string>, timeoutMs: number): Promise<Buffer> {
  const res = await fetch(SYNTH_URL, {
    method: 'POST',
    headers: {
      ...authHeaders,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      // prompt поддерживают только Gemini-модели — Chirp3-HD его не принимает.
      input: { text, ...(a.model && TTS_PROMPT ? { prompt: TTS_PROMPT } : {}) },
      voice: { languageCode: a.languageCode, name: a.voice, ...(a.model ? { model_name: a.model } : {}) },
      audioConfig: { audioEncoding: 'MP3' },
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = (await res.json()) as { audioContent?: string };
  if (!data.audioContent) throw new Error('пустой audioContent в ответе');
  return Buffer.from(data.audioContent, 'base64');
}

// Дневной счётчик символов на пользователя (в памяти процесса, дата UTC).
const dailyUsage = new Map<string, { day: string; chars: number }>();

export function ttsRoutes(app: FastifyInstance): void {
  app.post(
    '/tts',
    { preHandler: [app.authenticate], config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req, reply) => {
      if (!config.googleTtsCredentialsJson) {
        throw new HttpError(503, 'Озвучка не настроена на сервере. / Text-to-speech is not configured on this server.');
      }
      const body = asObject(req.body);
      const raw = requireString(body, 'text', { min: 1, max: 30_000 }).trim();
      if (!raw) throw new HttpError(400, 'Пустой текст. / Empty text.');
      const text = clipTtsText(raw, TTS_MAX_TEXT_BYTES);
      const lang = detectTtsLanguage(text);

      // Дневной потолок считается по фактически озвучиваемому (обрезанному) тексту.
      const day = new Date().toISOString().slice(0, 10);
      if (dailyUsage.size > 5000) {
        for (const [k, v] of dailyUsage) if (v.day !== day) dailyUsage.delete(k);
      }
      const usage = dailyUsage.get(req.currentUser.id);
      const used = usage && usage.day === day ? usage.chars : 0;
      if (used + text.length > TTS_DAILY_CHARS_PER_USER) {
        throw new HttpError(429, 'Дневной лимит озвучки исчерпан — попробуйте завтра. / Daily text-to-speech limit reached, try again tomorrow.');
      }

      const mode = ttsAuthMode(config.googleTtsCredentialsJson);
      let authHeaders: Record<string, string>;
      if (mode === 'service-account') {
        const { token, projectId } = await googleAccessToken(config.googleTtsCredentialsJson, OAUTH_SCOPE);
        authHeaders = { authorization: `Bearer ${token}`, ...(projectId ? { 'x-goog-user-project': projectId } : {}) };
      } else {
        authHeaders = { 'x-goog-api-key': config.googleTtsCredentialsJson.trim() };
      }

      // Порядок попыток: каждая Gemini-модель × кандидаты languageCode (только
      // при сервисном аккаунте), затем стабильный Chirp3-HD (если существует).
      const attempts: TtsAttempt[] = [];
      if (mode === 'service-account') {
        for (const model of TTS_MODEL_CHAIN) {
          for (const code of TTS_LANGUAGE_CODES[lang]) attempts.push({ model, voice: TTS_VOICE, languageCode: code });
        }
      }
      const chirpLocale = TTS_CHIRP_LOCALES[lang];
      if (chirpLocale) attempts.push({ voice: `${chirpLocale}-Chirp3-HD-${TTS_VOICE}`, languageCode: chirpLocale });
      if (attempts.length === 0) {
        // API-ключ + язык без Chirp-локали (uz/kk): честно объясняем, что нужно.
        throw new HttpError(502, 'Для озвучки этого языка нужен ключ сервисного аккаунта Google (см. server/.env.example). / This language needs a Google service-account key.');
      }

      // Общий дедлайн: фолбэк не должен держать соединение минутами.
      const deadline = Date.now() + TTS_TOTAL_DEADLINE_MS;
      let audio: Buffer | null = null;
      let lastErr = '';
      for (const a of attempts) {
        const left = deadline - Date.now();
        if (left < 3_000) break;
        try {
          audio = await synthesize(a, text, authHeaders, Math.min(TTS_ATTEMPT_TIMEOUT_MS, left));
          break;
        } catch (err) {
          lastErr = err instanceof Error ? err.message : String(err);
          req.log.warn({ step: a.model ?? a.voice, languageCode: a.languageCode, err: lastErr }, 'tts: шаг не сработал');
        }
      }
      if (!audio) {
        req.log.error({ lang, mode, lastErr }, 'tts: все шаги фолбэка исчерпаны');
        throw new HttpError(502, 'Не удалось озвучить текст — сервис временно недоступен. / Text-to-speech is temporarily unavailable.');
      }
      // Дневной счётчик — только за фактически синтезированное.
      dailyUsage.set(req.currentUser.id, { day, chars: used + text.length });
      return reply.header('content-type', 'audio/mpeg').header('cache-control', 'no-store').send(audio);
    },
  );
}
