/**
 * Ядро стриминговой озвучки: резка текста на куски, склейка MP3, стор записей
 * стрима с конвейером синтеза и негативный кэш languageCode.
 *
 * Дизайн под Safari: конвейер живёт НЕЗАВИСИМО от HTTP-соединений (Safari шлёт
 * пробный Range-запрос и рвёт его) — записи считают читателей (refcount), и
 * только после ухода всех читателей грейс-таймер отменяет запросы к Google.
 * Вся логика чистая и экспортирована для тестов; сетевой вызов synthesize
 * передаётся снаружи (роут) — модуль не знает про Fastify и fetch.
 */
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import {
  TTS_ABORT_GRACE_MS,
  TTS_CHUNK_TARGET_CHARS,
  TTS_FIRST_CHUNK_MAX_CHARS,
  TTS_LANG_NEG_CACHE_MS,
  TTS_MAX_TEXT_BYTES,
  TTS_PIPELINE_CONCURRENCY,
  TTS_STREAM_MAX_PER_USER,
  TTS_STREAM_MAX_RECORDS,
  TTS_STREAM_MAX_TOTAL_BYTES,
  TTS_STREAM_TTL_MS,
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

/** Кэшируются ТОЛЬКО детерминированные отказы (HTTP 400 — кода не существует). */
export function negCacheLang(model: string | undefined, code: string): void {
  negLangCache.set(negKey(model, code), Date.now() + TTS_LANG_NEG_CACHE_MS);
}

/* ── Резка текста на куски ──────────────────────────────────────────────────── */

/** Первый кусок — маленький (первое предложение, длинное режется по запятой):
 *  его синтез = время до первого звука. Остальные — по границам предложений
 *  до ~target символов. Суррогатные пары не рвутся. */
export function splitTtsChunks(
  text: string,
  firstMax = TTS_FIRST_CHUNK_MAX_CHARS,
  target = TTS_CHUNK_TARGET_CHARS,
): string[] {
  const clean = text.trim();
  if (!clean) return [];
  const sentences = clean.match(/[^.!?؟\n]+[.!?؟]*\s*/g) ?? [clean];
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
  // Жёсткий байтовый кап: предложение без знаков препинания может превысить
  // лимит Cloud TTS (~4000 байт на input.text) — такой кусок падал бы
  // детерминированным 400 на КАЖДОМ реплее (прожиг денег, находка ломателя).
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

/* ── Стор записей стрима ────────────────────────────────────────────────────── */

export interface TtsStreamRecord {
  id: string;
  userId: string;
  chunkTexts: string[];
  /** Цепочка попыток для ПЕРВОГО куска (модель×код + Chirp-фолбэк). */
  attempts: TtsAttempt[];
  /** Замораживается после первого успеха: куски 2+ идут той же комбинацией —
   *  откат на Chirp посреди ролика дал бы слышимую смену тембра. */
  attempt: TtsAttempt | null;
  buffers: Buffer[];
  /** Успешно синтезированные, но ещё не выпущенные куски (префетчи, пережившие
   *  провал соседнего куска): реплей переиспользует их, а не платит заново. */
  pending: Map<number, Buffer>;
  bytes: number;
  readers: number;
  events: EventEmitter;
  running: boolean;
  complete: boolean;
  /** Конвейер сдался на середине — реплей докачает недостающее. */
  incomplete: boolean;
  createdAt: number;
  abort: AbortController | null;
  graceTimer: NodeJS.Timeout | null;
}

const records = new Map<string, TtsStreamRecord>();
let totalBytes = 0;

function drop(rec: TtsStreamRecord): void {
  records.delete(rec.id);
  totalBytes -= rec.bytes;
}

function isExpired(rec: TtsStreamRecord): boolean {
  return Date.now() - rec.createdAt > TTS_STREAM_TTL_MS;
}

/** TTL-подметание + LRU по записям и байтам; активные записи не выселяются —
 *  кроме «жёстко протухших» (2×TTL): застрявший readers-счётчик (обрыв в
 *  async-окне до подписки на close) не должен закреплять запись навечно. */
function evictIdle(): void {
  const now = Date.now();
  for (const rec of records.values()) {
    if (isExpired(rec) && rec.readers <= 0 && !rec.running) drop(rec);
    else if (now - rec.createdAt > TTS_STREAM_TTL_MS * 2) {
      rec.abort?.abort();
      drop(rec);
    }
  }
  const idle = [...records.values()]
    .filter((r) => r.readers <= 0 && !r.running)
    .sort((a, b) => a.createdAt - b.createdAt);
  for (const rec of idle) {
    if (records.size <= TTS_STREAM_MAX_RECORDS && totalBytes <= TTS_STREAM_MAX_TOTAL_BYTES) break;
    drop(rec);
  }
}

export function createStreamRecord(userId: string, chunkTexts: string[], attempts: TtsAttempt[]): TtsStreamRecord {
  evictIdle();
  // Пер-пользовательский кап: спам prepare не выселяет чужие стримы (LRU),
  // а перерабатывает собственные старые записи.
  const own = [...records.values()]
    .filter((r) => r.userId === userId && r.readers <= 0 && !r.running)
    .sort((a, b) => a.createdAt - b.createdAt);
  while (own.length >= TTS_STREAM_MAX_PER_USER) drop(own.shift()!);
  const rec: TtsStreamRecord = {
    id: crypto.randomUUID(),
    userId,
    chunkTexts,
    attempts,
    attempt: null,
    buffers: [],
    pending: new Map(),
    bytes: 0,
    readers: 0,
    events: new EventEmitter(),
    running: false,
    complete: false,
    incomplete: false,
    createdAt: Date.now(),
    abort: null,
    graceTimer: null,
  };
  rec.events.setMaxListeners(50); // параллельные читатели Safari-probe + реплеи
  records.set(rec.id, rec);
  return rec;
}

export function getStreamRecord(id: string): TtsStreamRecord | undefined {
  const rec = records.get(id);
  if (!rec) return undefined;
  if (isExpired(rec) && rec.readers <= 0 && !rec.running) {
    drop(rec);
    return undefined;
  }
  return rec;
}

export function addReader(rec: TtsStreamRecord): void {
  rec.readers += 1;
  if (rec.graceTimer) {
    clearTimeout(rec.graceTimer);
    rec.graceTimer = null;
  }
}

/** Грейс-отмена синтеза, когда его никто не слушает: и после ухода последнего
 *  читателя, и если конвейер стартовал уже без читателей (обрыв в async-окне
 *  до старта — иначе синтез добежал бы до конца впустую, находка ломателя). */
function armGraceIfUnwatched(rec: TtsStreamRecord): void {
  if (rec.readers > 0 || rec.graceTimer || !rec.running) return;
  rec.graceTimer = setTimeout(() => {
    rec.graceTimer = null;
    if (rec.readers === 0) rec.abort?.abort();
  }, TTS_ABORT_GRACE_MS);
  rec.graceTimer.unref?.();
}

export function removeReader(rec: TtsStreamRecord): void {
  rec.readers = Math.max(0, rec.readers - 1);
  armGraceIfUnwatched(rec);
}

/* ── Конвейер синтеза ───────────────────────────────────────────────────────── */

export interface PipelineDeps {
  synthesize: (a: TtsAttempt, text: string, signal: AbortSignal, timeoutMs: number) => Promise<Buffer>;
  attemptTimeoutMs: number;
  totalDeadlineMs: number;
  /** Списание дневного счётчика — за каждый ФАКТИЧЕСКИ синтезированный кусок. */
  onChunkDone?: (chars: number) => void;
  log?: (obj: Record<string, unknown>, msg: string) => void;
}

/** Идемпотентный запуск: уже бегущий или завершённый конвейер не трогаем.
 *  Возобновление после стопа/незавершёнки продолжает с готовых кусков. */
export function startPipeline(rec: TtsStreamRecord, deps: PipelineDeps): void {
  if (rec.running || rec.complete) return;
  rec.running = true;
  rec.incomplete = false;
  rec.abort = new AbortController();
  armGraceIfUnwatched(rec);
  void runPipeline(rec, deps).finally(() => {
    rec.running = false;
    rec.abort = null;
    rec.events.emit('end');
  });
}

async function runPipeline(rec: TtsStreamRecord, deps: PipelineDeps): Promise<void> {
  const deadline = Date.now() + deps.totalDeadlineMs;
  const total = rec.chunkTexts.length;
  const signal = rec.abort!.signal;
  const left = () => deadline - Date.now();
  const inflight = new Map<number, Promise<Buffer>>();

  // Куски 2+: замороженная комбинация, 1 ретрай (сеть/429), без смены тембра.
  const synthFrozen = async (idx: number): Promise<Buffer> => {
    const a = rec.attempt!;
    try {
      return await deps.synthesize(a, rec.chunkTexts[idx], signal, Math.min(deps.attemptTimeoutMs, left()));
    } catch (err) {
      if (signal.aborted || left() < 3_000) throw err;
      return deps.synthesize(a, rec.chunkTexts[idx], signal, Math.min(deps.attemptTimeoutMs, left()));
    }
  };
  // Оплата — в момент ФАКТИЧЕСКОГО обращения к Google (не при выпуске куска
  // читателю): иначе успешный префетч, выброшенный из-за провала соседа,
  // пересинтезировался бы на каждом реплее бесплатно для счётчика (находка
  // ломателя). Успех уходит в rec.pending и переживает перезапуски конвейера.
  const ensureStarted = (idx: number): void => {
    if (idx >= total || idx < rec.buffers.length) return;
    if (rec.pending.has(idx) || inflight.has(idx) || !rec.attempt) return;
    const p = synthFrozen(idx).then((b) => {
      deps.onChunkDone?.(rec.chunkTexts[idx].length);
      rec.pending.set(idx, b);
      return b;
    });
    p.catch(() => {}); // reject добирается через await ниже; глушим unhandled
    inflight.set(idx, p);
  };

  try {
    for (let i = rec.buffers.length; i < total; i++) {
      if (left() < 3_000) throw new Error('дедлайн конвейера исчерпан');
      let buf: Buffer;
      if (!rec.attempt) {
        // Первый синтез: цепочка попыток; рабочая комбинация замораживается.
        let lastErr: unknown = new Error('нет доступных комбинаций синтеза');
        let ok = false;
        buf = Buffer.alloc(0);
        for (const a of rec.attempts) {
          if (isLangNegCached(a.model, a.languageCode)) continue;
          if (left() < 3_000) break;
          try {
            buf = await deps.synthesize(a, rec.chunkTexts[i], signal, Math.min(deps.attemptTimeoutMs, left()));
            rec.attempt = a;
            ok = true;
            deps.onChunkDone?.(rec.chunkTexts[i].length);
            break;
          } catch (err) {
            lastErr = err;
            if (err instanceof TtsUpstreamError && err.status === 400) negCacheLang(a.model, a.languageCode);
            deps.log?.({ step: a.model ?? a.voice, languageCode: a.languageCode, err: String(err).slice(0, 200) }, 'tts-stream: попытка не удалась');
            if (signal.aborted) break;
          }
        }
        if (!ok) throw lastErr;
      } else {
        ensureStarted(i);
        for (let k = 1; k < TTS_PIPELINE_CONCURRENCY; k++) ensureStarted(i + k);
        const cached = rec.pending.get(i);
        buf = cached ?? (await inflight.get(i)!);
        rec.pending.delete(i);
        inflight.delete(i);
      }
      if (i > 0) buf = stripLeadingId3(buf);
      if (i < total - 1) buf = stripTrailingId3v1(buf);
      rec.buffers.push(buf);
      rec.bytes += buf.length;
      totalBytes += buf.length;
      rec.events.emit('chunk');
      if (rec.readers === 0) armGraceIfUnwatched(rec);
    }
    rec.complete = true;
  } catch (err) {
    // Чистое завершение на границе последнего готового предложения; реплей
    // докачает (incomplete). Внеполосного сигнала об обрыве у <audio> нет.
    rec.incomplete = rec.buffers.length < total;
    deps.log?.(
      { err: String(err).slice(0, 200), got: rec.buffers.length, total, aborted: signal.aborted },
      'tts-stream: конвейер остановлен досрочно',
    );
  }
}

/** Полный сброс модульного состояния — ТОЛЬКО для тестов. */
export function resetTtsStreamForTests(): void {
  records.clear();
  totalBytes = 0;
  negLangCache.clear();
}
