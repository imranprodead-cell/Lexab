/**
 * Ядро стриминговой озвучки: резка текста на куски, склейка MP3, конвейер
 * синтеза и негативный кэш languageCode.
 *
 * Конвейер живёт внутри ОДНОГО авторизованного POST-запроса (клиент читает
 * поток через fetch и играет через MediaSource): куски синтезируются
 * последовательно с префетчем и отдаются наружу через emit по мере готовности.
 * Оплата (onChunkDone) — в момент фактического обращения к Google, а не при
 * выпуске куска. Вся логика чистая и экспортирована для тестов; сетевой вызов
 * synthesize передаётся снаружи — модуль не знает про Fastify и fetch.
 */
import {
  TTS_CHUNK_TARGET_CHARS,
  TTS_FIRST_CHUNK_MAX_CHARS,
  TTS_LANG_NEG_CACHE_MS,
  TTS_MAX_TEXT_BYTES,
  TTS_PIPELINE_CONCURRENCY,
  TTS_SLOW_CACHE_MS,
} from '../tts.config.ts';

/** Комбинация модель/голос/languageCode одной попытки синтеза. */
export interface TtsAttempt {
  /** Gemini-модель; отсутствует у шага Chirp3-HD (модель зашита в имя голоса). */
  model?: string;
  voice: string;
  languageCode: string;
}

/** Типизированная ошибка Google-синтеза — негативный кэш матчится по статусу,
 *  не по подстроке сообщения. */
export class TtsUpstreamError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/* ── Негативный кэш languageCode ────────────────────────────────────────────── */

const negLangCache = new Map<string, number>(); // `${model}|${code}` → истекает-в

function negKey(model: string | undefined, code: string): string {
  return `${model ?? 'chirp'}|${code}`;
}

export function isLangNegCached(model: string | undefined, code: string): boolean {
  const exp = negLangCache.get(negKey(model, code));
  if (exp === undefined) return false;
  if (Date.now() > exp) {
    negLangCache.delete(negKey(model, code));
    return false;
  }
  return true;
}

/** Кэшируются детерминированные отказы (HTTP 400 — кода не существует; сутки)
 *  и — с коротким ttl — деградация модели (таймаут: пропускаем её пару минут,
 *  чтобы хвост ролика не ждал по 10 с на каждом куске). */
export function negCacheLang(model: string | undefined, code: string, ttlMs = TTS_LANG_NEG_CACHE_MS): void {
  negLangCache.set(negKey(model, code), Date.now() + ttlMs);
}

/** Таймаут от AbortSignal.timeout (не путать с отменой клиента — AbortError). */
export function isTimeoutError(err: unknown): boolean {
  return err instanceof Error && err.name === 'TimeoutError';
}

/** Markdown → простой текст для синтеза: без этого голос читает «решётка,
 *  звёздочка звёздочка» на заголовках и жирном тексте ИИ-ответов. */
export function stripMarkdownForSpeech(s: string): string {
  return (
    s
      .replace(/```[\s\S]*?```/g, ' ') // код-блоки не начитываем
      .replace(/`([^`]*)`/g, '$1')
      .replace(/^#{1,6}[ \t]*/gm, '') // заголовки
      .replace(/^[ \t]*(?=.*-)[|:\s-]+$/gm, ' ') // разделители таблиц (| --- |:---:|) — ДО замены |
      .replace(/^[ \t]*[-*+•][ \t]+/gm, '') // маркеры списков
      .replace(/^[ \t]*>[ \t]?/gm, '') // цитаты
      .replace(/\*\*([^*]+)\*\*/g, '$1') // жирный
      .replace(/__([^_]+)__/g, '$1')
      .replace(/\*([^*\n]+)\*/g, '$1') // курсив
      .replace(/_([^_\n]+)_/g, '$1')
      .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1') // ссылки/картинки → их текст
      .replace(/\|/g, ' ') // таблицы
      .replace(/^[ \t]*[-=]{3,}[ \t]*$/gm, ' ') // горизонтальные линии
      .replace(/[*#_`~\\]+/g, ' ') // осиротевшие маркеры разметки и \-экранирование
      .replace(/[ \t]{2,}/g, ' ')
      .trim()
  );
}

/** «6.2»/«6.2.1»/«346.11» → «6 точка 2 …» — юристы произносят номера норм
 *  через «точка», Gemini иначе читает «шесть два». Токенный регекс с гвардами:
 *  даты dd.mm.yy(yy) не трогаем (модель читает их правильно сама), разрядные
 *  точки «1.000.000» не трогаем. ТОЛЬКО для русского текста. */
export function normalizeDottedNumbersRu(s: string): string {
  return s.replace(/\d+(?:\.\d+)+/g, (m) => {
    if (/^\d{1,2}\.\d{1,2}\.(?:\d{2}|\d{4})$/.test(m)) return m; // дата
    if (/^\d{1,3}(?:\.\d{3})+$/.test(m)) return m; // разряды тысяч
    return m.replace(/\./g, ' точка ');
  });
}

/** Русские юридические сокращения → полные слова. Gemini-TTS — языковая
 *  модель: сокращения она УГАДЫВАЕТ («ст.» читала как «стакан»), поэтому
 *  разворачиваем детерминированно до синтеза. Кодексы — побуквенно («гэ ка»),
 *  как их произносят юристы: полные названия требовали бы склонения, которое
 *  без разбора предложения не угадать. */
export function normalizeLegalAbbrRu(s: string): string {
  // ВАЖНО: JS \b не считает кириллицу «словом» — границы задаём lookaround-ами
  // (грабли уже задокументированы в CLAUDE.md на резолвере цитат).
  const B = '(?<![а-яёА-ЯЁa-zA-Z0-9])'; // левая граница слова
  const E = '(?![а-яёА-ЯЁa-zA-Z])'; // правая граница слова
  const rules: [RegExp, string][] = [
    [new RegExp(`${B}ст\\.\\s*(?=\\d)`, 'g'), 'статья '],
    [new RegExp(`${B}ч\\.\\s*(?=\\d)`, 'g'), 'часть '],
    [new RegExp(`${B}пп\\.\\s*(?=\\d)`, 'g'), 'подпункт '],
    [new RegExp(`${B}п\\.\\s*(?=\\d)`, 'g'), 'пункт '],
    [new RegExp(`${B}абз\\.\\s*(?=\\d)`, 'g'), 'абзац '],
    [new RegExp(`${B}гл\\.\\s*(?=\\d)`, 'g'), 'глава '],
    [new RegExp(`${B}т\\.\\s?е\\.`, 'g'), 'то есть'],
    [new RegExp(`${B}т\\.\\s?д\\.`, 'g'), 'так далее'],
    [new RegExp(`${B}т\\.\\s?ч\\.`, 'g'), 'том числе'],
    [new RegExp(`${B}т\\.\\s?п\\.`, 'g'), 'тому подобное'],
    [new RegExp(`${B}ЭПК${E}`, 'g'), 'э пэ ка'],
    [new RegExp(`${B}ГПК${E}`, 'g'), 'гэ пэ ка'],
    [new RegExp(`${B}ГК${E}`, 'g'), 'гэ ка'],
    [new RegExp(`${B}ТК${E}`, 'g'), 'тэ ка'],
    [new RegExp(`${B}НК${E}`, 'g'), 'эн ка'],
    [new RegExp(`${B}ЗК${E}`, 'g'), 'зэ ка'],
    [new RegExp(`${B}РУз${E}`, 'g'), 'эр уз'],
    [new RegExp(`${B}ЗРУ-(?=\\d)`, 'g'), 'зэ эр у '],
  ];
  let out = s;
  for (const [re, repl] of rules) out = out.replace(re, repl);
  return out;
}

/* ── Резка текста на куски ──────────────────────────────────────────────────── */

/** Первый кусок — маленький (начало первого предложения): его синтез = время
 *  до первого звука. Остальные — по границам предложений до ~target символов.
 *  Каждый кусок ≤ TTS_MAX_TEXT_BYTES байт (лимит Cloud TTS) — предложение без
 *  знаков препинания иначе падало бы детерминированным 400.
 *  Суррогатные пары не рвутся. */
export function splitTtsChunks(
  text: string,
  firstMax = TTS_FIRST_CHUNK_MAX_CHARS,
  target = TTS_CHUNK_TARGET_CHARS,
): string[] {
  const clean = text.trim();
  if (!clean) return [];
  const rawSentences = clean.match(/[^.!?؟\n]+[.!?؟]*\s*/g) ?? [clean];
  // Склейка ложных разрывов внутри чисел: «…6.» + «2 Закона» (точка БЕЗ
  // пробела в хвосте — у настоящей границы \s* уже съел пробел). Без этого
  // «6.2» рвётся между кусками синтеза и звучит «шесть [пауза] два».
  const sentences: string[] = [];
  for (const s of rawSentences) {
    const prev = sentences[sentences.length - 1];
    if (prev && /\d\.$/.test(prev) && /^\d/.test(s)) sentences[sentences.length - 1] = prev + s;
    else sentences.push(s);
  }
  const chunks: string[] = [];
  const first = sentences[0] ?? clean;
  let rest: string[];
  if (first.length > firstMax) {
    let cut = first.lastIndexOf(', ', firstMax);
    if (cut < firstMax * 0.4) cut = first.lastIndexOf(' ', firstMax);
    if (cut < firstMax * 0.4) cut = firstMax;
    if (/[\uD800-\uDBFF]$/.test(first.slice(0, cut))) cut -= 1; // не рвём эмодзи
    chunks.push(first.slice(0, cut).trim());
    rest = [first.slice(cut), ...sentences.slice(1)];
  } else {
    chunks.push(first.trim());
    rest = sentences.slice(1);
  }
  let cur = '';
  for (const s of rest) {
    if (cur && cur.length + s.length > target) {
      chunks.push(cur.trim());
      cur = s;
    } else {
      cur += s;
    }
  }
  if (cur.trim()) chunks.push(cur.trim());
  return chunks
    .flatMap((c) => hardSplitByBytes(c, TTS_MAX_TEXT_BYTES))
    .filter((c) => c.length > 0);
}

/** Резка строки на части ≤ maxBytes UTF-8, по пробелу где возможно,
 *  суррогат-безопасно. Гарантированно завершается. */
export function hardSplitByBytes(s: string, maxBytes: number): string[] {
  if (Buffer.byteLength(s, 'utf8') <= maxBytes) return [s];
  const parts: string[] = [];
  let restStr = s;
  while (Buffer.byteLength(restStr, 'utf8') > maxBytes) {
    // байты → символы: худший случай 4 байта на символ, потом добираем
    let cut = Math.max(1, Math.floor(maxBytes / 4));
    while (cut < restStr.length && Buffer.byteLength(restStr.slice(0, cut + 1), 'utf8') <= maxBytes) cut++;
    const space = restStr.lastIndexOf(' ', cut);
    if (space > cut * 0.5) cut = space;
    if (/[\uD800-\uDBFF]$/.test(restStr.slice(0, cut))) cut -= 1;
    parts.push(restStr.slice(0, cut).trim());
    restStr = restStr.slice(cut).trim();
  }
  if (restStr) parts.push(restStr);
  return parts;
}

/* ── MP3-склейка: срезка ID3-тегов у нефинальных кусков ────────────────────── */

/** ID3v2-заголовок: "ID3" + версия(2) + флаги(1) + synchsafe-размер(4);
 *  флаг 0x10 = footer ещё +10 байт. Срезаем у кусков 2+, чтобы декодеры
 *  не спотыкались на теге посреди потока. */
export function stripLeadingId3(buf: Buffer): Buffer {
  if (buf.length < 10 || buf.toString('latin1', 0, 3) !== 'ID3') return buf;
  const flags = buf[5];
  const size = ((buf[6] & 0x7f) << 21) | ((buf[7] & 0x7f) << 14) | ((buf[8] & 0x7f) << 7) | (buf[9] & 0x7f);
  const total = 10 + size + ((flags & 0x10) !== 0 ? 10 : 0);
  return total <= buf.length ? buf.subarray(total) : buf;
}

/** Хвостовой ID3v1 ("TAG", 128 байт) у нефинальных кусков. */
export function stripTrailingId3v1(buf: Buffer): Buffer {
  if (buf.length >= 128 && buf.toString('latin1', buf.length - 128, buf.length - 125) === 'TAG') {
    return buf.subarray(0, buf.length - 128);
  }
  return buf;
}

/* ── Конвейер синтеза ───────────────────────────────────────────────────────── */

export interface ChunkPipelineDeps {
  synthesize: (a: TtsAttempt, text: string, signal: AbortSignal, timeoutMs: number) => Promise<Buffer>;
  signal: AbortSignal;
  attemptTimeoutMs: number;
  totalDeadlineMs: number;
  /** Кусок готов к отправке клиенту (ID3 уже срезан, порядок строгий). */
  emit: (buf: Buffer, index: number) => void;
  /** Списание дневного счётчика — за каждый ФАКТИЧЕСКИ синтезированный кусок. */
  onChunkDone?: (chars: number) => void;
  /** Быстрый движок ТОЛЬКО для первого куска (Chirp ~1 с против ~4 с Gemini);
   *  НЕ замораживается — остальные куски идут основной цепочкой attempts. */
  fastFirstAttempt?: TtsAttempt;
  log?: (obj: Record<string, unknown>, msg: string) => void;
}

export interface ChunkPipelineResult {
  done: number;
  total: number;
  complete: boolean;
}

/** Последовательный конвейер с префетчем: первый кусок пробует цепочку
 *  attempts (рабочая комбинация замораживается — смена модели посреди ролика
 *  дала бы слышимую смену тембра), куски 2+ идут замороженной комбинацией с
 *  одним ретраем. Ошибка куска N — чистая остановка на границе предложения. */
export async function runChunkPipeline(chunkTexts: string[], attempts: TtsAttempt[], deps: ChunkPipelineDeps): Promise<ChunkPipelineResult> {
  const total = chunkTexts.length;
  const deadline = Date.now() + deps.totalDeadlineMs;
  const left = () => deadline - Date.now();
  const signal = deps.signal;
  let attempt: TtsAttempt | null = null;
  let done = 0;
  const inflight = new Map<number, Promise<Buffer>>();

  const synthFrozen = async (idx: number): Promise<Buffer> => {
    const a = attempt!;
    try {
      return await deps.synthesize(a, chunkTexts[idx], signal, Math.min(deps.attemptTimeoutMs, left()));
    } catch (err) {
      if (signal.aborted || left() < 3_000) throw err;
      return deps.synthesize(a, chunkTexts[idx], signal, Math.min(deps.attemptTimeoutMs, left()));
    }
  };
  const ensureStarted = (idx: number): void => {
    if (idx >= total || inflight.has(idx) || !attempt) return;
    const p = synthFrozen(idx).then((b) => {
      // Оплата в момент обращения к Google, даже если кусок не будет отдан.
      deps.onChunkDone?.(chunkTexts[idx].length);
      return b;
    });
    p.catch(() => {}); // reject добирается через await ниже; глушим unhandled
    inflight.set(idx, p);
  };

  try {
    for (let i = 0; i < total; i++) {
      if (left() < 3_000) throw new Error('дедлайн конвейера исчерпан');
      let buf: Buffer | null = null;
      const fast = deps.fastFirstAttempt;
      if (i === 0 && fast && !attempt && !isLangNegCached(fast.model, fast.languageCode)) {
        try {
          buf = await deps.synthesize(fast, chunkTexts[0], signal, Math.min(deps.attemptTimeoutMs, left()));
          deps.onChunkDone?.(chunkTexts[0].length);
        } catch (err) {
          if (err instanceof TtsUpstreamError && err.status === 400) negCacheLang(fast.model, fast.languageCode);
          if (isTimeoutError(err)) negCacheLang(fast.model, fast.languageCode, TTS_SLOW_CACHE_MS);
          deps.log?.({ err: String(err).slice(0, 160) }, 'tts-stream: быстрый первый кусок не удался — обычная цепочка');
          buf = null;
        }
      }
      if (buf === null && !attempt) {
        // Первый синтез: цепочка попыток; рабочая комбинация замораживается.
        let lastErr: unknown = new Error('нет доступных комбинаций синтеза');
        let ok = false;
        buf = Buffer.alloc(0);
        for (const a of attempts) {
          if (isLangNegCached(a.model, a.languageCode)) continue;
          if (left() < 3_000) break;
          try {
            buf = await deps.synthesize(a, chunkTexts[i], signal, Math.min(deps.attemptTimeoutMs, left()));
            attempt = a;
            ok = true;
            deps.onChunkDone?.(chunkTexts[i].length);
            break;
          } catch (err) {
            lastErr = err;
            if (err instanceof TtsUpstreamError && err.status === 400) negCacheLang(a.model, a.languageCode);
            // Деградация модели (таймаут) — пропускаем её несколько минут,
            // чтобы следующие куски/клики сразу уходили в живой Chirp.
            if (isTimeoutError(err)) negCacheLang(a.model, a.languageCode, TTS_SLOW_CACHE_MS);
            deps.log?.({ step: a.model ?? a.voice, languageCode: a.languageCode, err: String(err).slice(0, 200) }, 'tts-stream: попытка не удалась');
            if (signal.aborted) break;
          }
        }
        if (!ok) throw lastErr;
      } else if (buf === null) {
        ensureStarted(i);
        for (let k = 1; k < TTS_PIPELINE_CONCURRENCY; k++) ensureStarted(i + k);
        buf = await inflight.get(i)!;
        inflight.delete(i);
      }
      if (i > 0) buf = stripLeadingId3(buf!);
      if (i < total - 1) buf = stripTrailingId3v1(buf!);
      deps.emit(buf!, i);
      done += 1;
    }
    return { done, total, complete: true };
  } catch (err) {
    // Чистая остановка на границе последнего готового предложения.
    deps.log?.(
      { err: String(err).slice(0, 200), got: done, total, aborted: signal.aborted },
      'tts-stream: конвейер остановлен досрочно',
    );
    return { done, total, complete: false };
  }
}

/** Полный сброс модульного состояния — ТОЛЬКО для тестов. */
export function resetTtsStreamForTests(): void {
  negLangCache.clear();
}
