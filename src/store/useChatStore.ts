/**
 * Chat / review-session store.
 *
 * Owns the conversational canvas state machine:
 *   idle → analyzing → analyzed → (workspace handled by routing)
 *
 * The animated progress steps are driven here on timers while the analysis
 * request is in flight, so the UI shows a genuine loading→success→error cycle
 * backed by the API layer.
 */
import { create } from 'zustand';
import { consumePendingProject, USE_MOCK, analysisApi, documentsApi } from '@/api';
import { chatsApi } from '@/api/chats.api';
import { uploadsApi, type UploadedFile } from '@/api/uploads.api';
import { ApiError } from '@/api/util';
import { apiErrorMessage } from '@/i18n/apiError';
import { COUNTRIES } from '@/data/countries';
import { ANALYSIS_STEPS, MOCK_PLAN_QUESTIONS, MOCK_PLAN_REPLY, MOCK_SLIDES_REPLY } from '@/data/seed';
import { loadLang, pickText, tStandalone } from '@/i18n/messages';
import { useChatHistoryStore } from '@/store/useChatHistoryStore';
import { useUIStore } from '@/store/useUIStore';
import type { AnalysisResult, ChatMessage, ChatStep, ChatWork, DocBlock, Redline, RedlineStatus } from '@/types/domain';
import { isRedlineSlot } from '@/types/domain';

/** Refresh the sidebar list so new sessions / updated order show up instantly. */
function refreshHistory() {
  void useChatHistoryStore.getState().load();
}

/**
 * «Новый договор» со страницы проекта: ProjectDetailPage кладёт id дела в
 * sessionStorage (PENDING_PROJECT_KEY); первый успешный анализ переносит
 * готовый документ в проект и гасит ключ (одноразовый — не копится вечно).
 * Любая ошибка уходит в тост и НЕ роняет анализ.
 */
function adoptDocIntoProject(documentId: string | undefined, projectId: string | null): void {
  if (!projectId) return; // этот анализ не из флоу «новый договор в деле»
  if (!documentId) {
    // Анализ прошёл, но id документа сервер не вернул — честно сообщаем,
    // что в дело договор не попал (ключ уже погашен на старте).
    useUIStore.getState().pushToast(tStandalone('projects.addFailedToast'), 'error');
    return;
  }
  documentsApi
    .assignProject(documentId, projectId)
    .then(() => useUIStore.getState().pushToast(tStandalone('projects.addedToast'), 'success'))
    .catch(() => useUIStore.getState().pushToast(tStandalone('projects.addFailedToast'), 'error'));
}

/** Default law context ("German law", …) from the top-bar country selector. */
function defaultLaw(): string | undefined {
  const code = useUIStore.getState().country;
  return COUNTRIES.find((c) => c.code === code)?.law;
}

export type ChatPhase = 'idle' | 'analyzing' | 'analyzed' | 'error';

const STEP_INTERVAL = 1150;

/** Контроллер текущего анализа — чтобы кнопка «Отменить» реально обрывала запрос. */
let analysisAbort: AbortController | null = null;

/** Mock assistant replies per slash command — replaced by a real chat endpoint. */
function mockReply(text: string): string {
  const t = text.trim().toLowerCase();
  if (t.startsWith('/draft')) return tStandalone('chat.mock.draft');
  if (t.startsWith('/compare')) return tStandalone('chat.mock.compare');
  if (t.startsWith('/translate')) return tStandalone('chat.mock.translate');
  if (t.startsWith('/plan')) {
    // Первый план — с уточняющими вопросами; после ответов или правок — без.
    const settled = /уточняющие вопросы|clarifying questions|внесите изменения|revise the plan/i.test(t);
    const plan = pickText(MOCK_PLAN_REPLY, loadLang());
    return settled ? plan : `${plan}\n\n${pickText(MOCK_PLAN_QUESTIONS, loadLang())}`;
  }
  if (t.startsWith('/slides')) return pickText(MOCK_SLIDES_REPLY, loadLang());
  return tStandalone('chat.mock.default');
}

/** Шаг с сервера → в список: шаг с тем же id заменяется («ищу» → «нашёл»),
 *  его данные дополняются (запросы поиска приходят раньше найденного). */
export function mergeStep(steps: ChatStep[], step: ChatStep): ChatStep[] {
  const i = steps.findIndex((s) => s.id === step.id);
  if (i < 0) return [...steps, step];
  const next = steps.slice();
  next[i] = { ...step, data: { ...steps[i].data, ...step.data } };
  return next;
}

/** Пошли первые слова ответа — работа окончена: активные шаги закрываются. */
export function endWork(work: ChatWork | undefined, at = Date.now()): ChatWork | undefined {
  if (!work || work.endedAt) return work;
  return { ...work, endedAt: at, steps: work.steps.map((s) => (s.status === 'active' ? { ...s, status: 'done' } : s)) };
}

/** Тестовый режим (без сервера): тот же ход работы, что шлёт сервер, по таймеру. */
function mockWorkSteps(text: string, files?: string[]): { steps: [number, ChatStep][]; total: number } {
  const country = useUIStore.getState().country;
  const jurisdiction = country === 'GB' ? 'UK' : country;
  const mode = /^\/(plan|slides|approve)\b/i.exec(text.trim())?.[1]?.toLowerCase();
  const steps: [number, ChatStep][] = [[0, { id: 'prompt', status: 'done' }]];
  let t = 350;
  if (files?.length) {
    steps.push([t, { id: 'files', status: 'active', data: { files } }]);
    t += 800;
    steps.push([t, { id: 'files', status: 'done', data: { files } }]);
    t += 150;
  }
  const queries = ['неустойка за просрочку поставки', 'ответственность поставщика по договору'];
  steps.push([t, { id: 'search', status: 'active', data: { jurisdiction } }]);
  t += 600;
  steps.push([t, { id: 'search', status: 'active', data: { jurisdiction, queries } }]);
  t += 1000;
  steps.push([
    t,
    {
      id: 'search',
      status: 'done',
      data: {
        jurisdiction,
        queries,
        found: 3,
        refs: [
          { label: 'Статья 333', doc: 'Гражданский кодекс (демо)', url: 'https://lex.uz/ru/docs/111181#162633' },
          { label: 'Статья 260', doc: 'Гражданский кодекс (демо)', url: 'https://lex.uz/ru/docs/111181' },
        ],
      },
    },
  ]);
  if (mode) steps.push([t + 150, { id: 'mode', status: 'done', data: { mode } }]);
  t += 300;
  steps.push([t, { id: 'answer', status: 'active' }]);
  return { steps, total: t + 1600 };
}

interface ChatState {
  phase: ChatPhase;
  messages: ChatMessage[];
  analysis: AnalysisResult | null;
  activeStep: number; // -1 none, 0..2 in progress, steps.length = done
  /** Когда начался текущий анализ (мс). Карточка показывает честное «идёт
   *  разбор, 1 мин 20 с» вместо замершего на 66% индикатора. */
  analysisStartedAt: number | null;
  error: string | null;
  steps: string[];
  /** Backend chat session id (created lazily on the first real-API message). */
  serverSessionId: string | null;
  /** A saved session is being fetched (uncached open) — show a skeleton. */
  sessionLoading: boolean;
  /** Загрузка сохранённого чата сорвалась по сети (НЕ 404): страница
   *  показывает «повторить», а повторный клик перезапускает loadSession. */
  sessionLoadFailed: boolean;
  /** Redline id to jump to when the workspace opens (set from the chat summary
   *  card's "click a finding"); consumed and cleared by the workspace. */
  pendingAnchor: string | null;

  /** Request the workspace to open at the clause fixed by this redline. */
  requestAnchor: (redlineId: string) => void;
  clearPendingAnchor: () => void;

  /** Thumbs rating on an assistant reply (optimistic). */
  setFeedback: (messageId: string, value: 'up' | 'down' | null) => void;

  /** `opts.keepCanvas`: не обнулять текущий документ на время анализа — воркспейс
   *  остаётся открытым (сохранённый черновик анализируется «на месте»).
   *  `opts.photos`: фото страниц договора по порядку — сервер склеит их в PDF,
   *  `file.name` тогда — имя будущего документа.
   *  `opts.newSession`: новый договор — новый чат в боковой панели; анализ
   *  привязывается ТОЛЬКО к нему, а не к чату, открытому в момент загрузки. */
  startAnalysis: (
    file: { name: string; size: string },
    rawFile?: File,
    opts?: { keepCanvas?: boolean; uploadId?: string; photos?: File[]; newSession?: boolean },
  ) => Promise<void>;
  /** Отменить идущий анализ (кнопка «Отменить» на карточке). */
  cancelAnalysis: () => void;
  /** files — прикреплённые к вопросу файлы (уже загружены на сервер). */
  sendMessage: (text: string, files?: { uploadId: string; name: string; size: string }[]) => void;
  reset: () => void;
  /** Real mode: hydrate the canvas from a server-side chat session. */
  loadSession: (sessionId: string) => Promise<void>;
  /** Link the canvas to an already-created server session (sidebar entry). */
  setServerSession: (id: string | null) => void;
  /** Show a specific analysis in the workspace (e.g. from the Documents page). */
  adoptAnalysis: (analysis: AnalysisResult) => void;
  /** Сохранённый документ: открыть текст в воркспейсе БЕЗ анализа.
   *  Пока draftSource установлен, воркспейс показывает кнопку «Анализ рисков». */
  draftSource: { savedTemplateId: string; title: string; content: string } | null;
  adoptDraft: (tpl: { id: string; title: string; content: string }) => void;
  /** Синхронизировать текст черновика после правки в воркспейсе, чтобы
   *  скачивание/копирование/анализ работали с отредактированной версией. */
  updateDraftContent: (content: string) => void;
  /** Re-run the AI review against the current draft; resolves with the new result. */
  reanalyze: () => Promise<AnalysisResult>;

  setRedlineStatus: (id: string, status: RedlineStatus) => void;
  /** Accept every pending redline; returns the ids flipped (for a 5s Undo). */
  acceptAllRedlines: () => string[];
  /** Send the given redlines back to pending (Accept-all undo). */
  revertRedlines: (ids: string[]) => void;
  pendingRedlineCount: () => number;
  /** Live editor: replace the analysis document blocks after a manual edit.
   *  `snapshot` (default true) records an undo step; undo/redo pass false. */
  updateDocument: (document: AnalysisResult['document'], snapshot?: boolean) => void;

  /** Toggle whether AI tracked changes (redlines) are shown or hidden. */
  showEdits: boolean;
  toggleShowEdits: () => void;
  /** Undo/redo stacks (editor toolbar). Each snapshot captures BOTH the blocks
   *  and the redline states, so undo can't resurrect a retired redline slot. */
  docUndo: DocSnapshot[];
  docRedo: DocSnapshot[];
  /** Revert / re-apply the last document edit; persists the swapped blocks. */
  undoDocument: () => void;
  redoDocument: () => void;
}

interface DocSnapshot {
  /** Чей это снимок: Undo из ЧУЖОГО анализа вставлял бы текст другого
   *  договора и удалял его правки на сервере — снимки строго одноимённые. */
  analysisId: string;
  document: DocBlock[];
  redlines: AnalysisResult['redlines'];
}

/** Последний прикреплённый файл (не переживает перезагрузку страницы) —
 *  нужен «Повторить» после неудачного анализа, чтобы переслать ТЕ ЖЕ байты. */
let lastRawFile: File | null = null;
/** Загрузка этого файла уже дошла до сервера: «Повторить» после сбоя анализа
 *  разбирает ТУ ЖЕ загрузку по её id, а не шлёт копию (лишняя копия съедала
 *  место в хранилище тарифа). */
let lastRawUpload: { file: File; upload: UploadedFile } | null = null;
/** То же для фото страниц: «Повторить» после сбоя анализа берёт уже
 *  загруженный PDF (upload), а если не дошла сама загрузка — шлёт снимки снова. */
let lastPhotos: { name: string; photos: File[]; upload: UploadedFile | null } | null = null;
/** Что прикрепили ПОСЛЕДНИМ — «Повторить» повторяет именно это. Раньше повтор
 *  искал «последний файл с компьютера с таким именем»: после импорта из облака
 *  он либо просил прикрепить файл заново, либо разбирал СТАРЫЙ одноимённый
 *  файл с компьютера (аудит загрузок 2026-10-18). Файл из облака уже лежит на
 *  сервере — повтор идёт по его uploadId. */
let lastAttachment: { name: string; kind: 'file' | 'photos' | 'cloud'; uploadId?: string } | null = null;

/** Чат, который создаётся под идущий анализ нового договора (opts.newSession).
 *  Отмена анализа до того, как чат создан, должна удалить и его — иначе в
 *  боковой панели остаётся пустой чат. */
let pendingRunSession: Promise<string | null> | null = null;

/** Сколько ждать создания чата, прежде чем показать результат или ошибку
 *  анализа: запрос в сеть может повиснуть, а ждать его вечно нельзя. */
const OWN_SESSION_WAIT_MS = 15_000;
/** Значение промиса, если он успел за `ms`; иначе undefined (промис живёт дальше). */
function settledWithin<T>(promise: Promise<T>, ms: number): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => resolve(undefined), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

let stepTimers: ReturnType<typeof setTimeout>[] = [];
function clearStepTimers() {
  stepTimers.forEach(clearTimeout);
  stepTimers = [];
}

/** Per-message typewriter timers + their full texts: a late or concurrent
 *  reply must never kill another message's animation. */
const streamTimers = new Map<string, ReturnType<typeof setInterval>>();
const streamFullTexts = new Map<string, string>();

/** Canvas generation counter: bumped on every canvas switch (session load,
 *  reset, opening a document or draft). In-flight completions compare their
 *  captured epoch and drop their result instead of leaking it into the new
 *  canvas. */
let canvasEpoch = 0;

/** Replies still in flight, keyed by server session id. Lets the user leave a
 *  chat mid-generation and find the reply streaming in when they come back —
 *  the model keeps working in the background instead of the answer vanishing. */
const pendingReplies = new Map<string, string>(); // sessionId → placeholder message id

/** Placeholder ids whose reply is streaming live from the server (real SSE, not
 *  the fake typewriter). finishActiveStreams leaves these alone — they are
 *  genuinely still generating, not stale animations to fast-forward or drop. */
const liveStreamIds = new Set<string>();

/** Last known conversation per session (stale-while-revalidate): reopening a
 *  chat paints instantly from this cache while fresh data loads behind it.
 *  LRU-capped — a long session hopping between many chats (each with a full
 *  analysis document) must not grow memory without bound. */
const SESSION_CACHE_MAX = 30;
const sessionCache = new Map<string, { messages: ChatMessage[]; analysis: AnalysisResult | null }>();
function cacheSession(id: string, value: { messages: ChatMessage[]; analysis: AnalysisResult | null }) {
  sessionCache.delete(id); // re-insert → becomes the most recently used
  sessionCache.set(id, value);
  while (sessionCache.size > SESSION_CACHE_MAX) {
    sessionCache.delete(sessionCache.keys().next().value as string); // evict the oldest
  }
}

/** Плоский текст сохранённого документа → блоки документа для вьювера.
 *  Эвристика заголовков: короткая одиночная строка ЗАГЛАВНЫМИ или «1. …». */
function draftContentToBlocks(content: string): DocBlock[] {
  const blocks: DocBlock[] = [];
  for (const raw of content.split(/\r?\n\s*\n/)) {
    const chunk = raw.trim();
    if (!chunk) continue;
    const singleLine = !chunk.includes('\n');
    const looksHeading =
      singleLine &&
      chunk.length <= 90 &&
      ((/[A-ZА-ЯЁ]/.test(chunk) && chunk === chunk.toUpperCase()) || /^\d+(\.\d+)*\.?\s+\S/.test(chunk));
    if (looksHeading) blocks.push({ type: 'heading', text: chunk });
    else blocks.push({ type: 'paragraph', segments: [chunk] });
  }
  return blocks.length ? blocks : [{ type: 'paragraph', segments: [content.trim()] }];
}

/** Обратный путь: блоки черновика → плоский текст документа. Правки в воркспейсе
 *  сохраняются в saved_templates как plain text, поэтому инлайн-форматирование
 *  сознательно сплющивается — что на экране, то и в файле (без скрытых потерь). */
export function draftBlocksToText(blocks: DocBlock[]): string {
  const parts: string[] = [];
  for (const b of blocks) {
    const text =
      b.type === 'heading'
        ? (b.text ?? '').trim()
        : (b.segments ?? [])
            .map((seg) => (typeof seg === 'string' ? seg : isRedlineSlot(seg) ? '' : seg.text))
            .join('')
            .trim();
    if (text) parts.push(text);
  }
  return parts.join('\n\n');
}

export const useChatStore = create<ChatState>((set, get) => {
  /** Once both the analysis and the server session exist, tie them together so
   *  the summary card is restored when the session is reopened (idempotent). */
  const tryLinkAnalysis = () => {
    const { analysis, serverSessionId } = get();
    if (USE_MOCK || !analysis || !serverSessionId) return;
    void chatsApi.linkAnalysis(serverSessionId, analysis.id).catch(() => undefined);
  };

  /** Reveal `full` a few characters at a time inside the assistant bubble. */
  const streamIn = (assistantId: string, full: string) => {
    const existing = streamTimers.get(assistantId);
    if (existing) clearInterval(existing);
    streamFullTexts.set(assistantId, full);
    let i = 0;
    const timer = setInterval(() => {
      i = Math.min(full.length, i + 3);
      const done = i >= full.length;
      set((s) => ({
        messages: s.messages.map((m) =>
          m.id === assistantId ? { ...m, text: full.slice(0, i), streaming: !done, work: endWork(m.work) } : m,
        ),
      }));
      if (done) {
        clearInterval(timer);
        streamTimers.delete(assistantId);
        streamFullTexts.delete(assistantId);
      }
    }, 16);
    streamTimers.set(assistantId, timer);
  };

  /** Live-token painter: accumulate deltas from an SSE reply and flush them into
   *  the message with `targetId` at most every ~50ms — but ONLY if that message
   *  still exists in the current canvas. That one guard covers epoch switches
   *  (id gone → nothing paints) and leave-and-return (loadSession restores the
   *  placeholder → the next flush catches it up to everything streamed while
   *  the user was away). The model's own cadence IS the typewriter here. */
  const makeLivePainter = (targetId: string) => {
    let acc = '';
    let scheduled: ReturnType<typeof setTimeout> | null = null;
    const flush = () => {
      scheduled = null;
      set((s) =>
        s.messages.some((m) => m.id === targetId)
          ? { messages: s.messages.map((m) => (m.id === targetId ? { ...m, text: acc, streaming: true, work: endWork(m.work) } : m)) }
          : {},
      );
    };
    return {
      onToken: (delta: string) => {
        acc += delta;
        if (!scheduled) scheduled = setTimeout(flush, 50);
      },
      cancel: () => {
        if (scheduled) {
          clearTimeout(scheduled);
          scheduled = null;
        }
      },
    };
  };

  /** Шаг работы над ответом — в сообщение-заглушку, если оно ещё на экране. */
  const applyStep = (targetId: string, step: ChatStep) =>
    set((s) =>
      s.messages.some((m) => m.id === targetId)
        ? {
            messages: s.messages.map((m) =>
              m.id === targetId
                ? { ...m, work: { ...(m.work ?? { startedAt: Date.now() }), steps: mergeStep(m.work?.steps ?? [], step) } }
                : m,
            ),
          }
        : {},
    );

  /** Fast-forward every animating reply to its full text and drop reply
   *  placeholders whose request never returned. Runs on every canvas switch
   *  and before each outgoing message — nothing may stay streaming:true.
   *  Live SSE replies are skipped: they are still generating server-side. */
  const finishActiveStreams = () => {
    const fulls = new Map(streamFullTexts);
    for (const timer of streamTimers.values()) clearInterval(timer);
    streamTimers.clear();
    streamFullTexts.clear();
    set((s) => ({
      messages: s.messages.flatMap((m) => {
        if (!m.streaming) return [m];
        if (liveStreamIds.has(m.id)) return [m]; // genuinely still streaming from the server
        const full = fulls.get(m.id);
        if (full !== undefined) return [{ ...m, streaming: false, text: full }];
        return m.text ? [{ ...m, streaming: false }] : []; // reply never arrived
      }),
    }));
  };

  return {
  phase: 'idle',
  messages: [],
  analysis: null,
  draftSource: null,
  activeStep: -1,
  analysisStartedAt: null,
  error: null,
  steps: ANALYSIS_STEPS,
  serverSessionId: null,
  sessionLoading: false,
  sessionLoadFailed: false,
  pendingAnchor: null,
  showEdits: true,
  docUndo: [],
  docRedo: [],

  requestAnchor: (redlineId) => set({ pendingAnchor: redlineId }),
  clearPendingAnchor: () => set({ pendingAnchor: null }),

  setFeedback: (messageId, value) => {
    const prev = get().messages.find((m) => m.id === messageId)?.feedback ?? null;
    set((s) => ({ messages: s.messages.map((m) => (m.id === messageId ? { ...m, feedback: value } : m)) }));
    const sessionId = get().serverSessionId;
    // Local-only rating: mock conversations and fallback replies whose local
    // ids (a_…) the server never saw — a POST would only 404.
    if (USE_MOCK || !sessionId || messageId.startsWith('a_')) return;
    void chatsApi.setFeedback(sessionId, messageId, value).catch(() => {
      // Roll back only if the user has not changed the rating again meanwhile.
      set((s) => ({ messages: s.messages.map((m) => (m.id === messageId && m.feedback === value ? { ...m, feedback: prev } : m)) }));
      useUIStore.getState().pushToast(tStandalone('common.error'), 'error');
    });
  },

  cancelAnalysis: () => {
    // Раньше отменить анализ было нельзя вовсе: оставалось закрыть вкладку —
    // и это стоило пользователю ИИ-запроса (аудит 2026-08-03).
    analysisAbort?.abort();
    analysisAbort = null;
    clearStepTimers();
    canvasEpoch++;
    const deadSid = get().serverSessionId;
    const removeDead = (sid: string) =>
      void chatsApi
        .remove(sid)
        .then(() => refreshHistory())
        .catch(() => undefined);
    if (deadSid && !USE_MOCK) removeDead(deadSid);
    // Чат под этот анализ мог ещё создаваться — удалить его, когда появится.
    const pending = pendingRunSession;
    pendingRunSession = null;
    if (pending && !USE_MOCK) void pending.then((sid) => sid && sid !== deadSid && removeDead(sid));
    set({ phase: 'idle', messages: [], activeStep: -1, analysisStartedAt: null, error: null, serverSessionId: null });
  },

  startAnalysis: async (file, rawFile, opts) => {
    if (get().phase === 'analyzing') return;
    // «Повторить» с карточки ошибки приходит БЕЗ файла — переиспользуем
    // последний прикреплённый (тот же по имени). Без файла анализ запускать
    // НЕЛЬЗЯ: сервер разрешал бы контент по имени и мог молча разобрать
    // устаревшую версию или вообще ничего (выдуманный «анализ»).
    if (rawFile) {
      lastRawFile = rawFile;
      lastAttachment = { name: file.name, kind: 'file' };
    } else if (opts?.photos?.length) {
      lastPhotos = { name: file.name, photos: opts.photos, upload: null };
      lastAttachment = { name: file.name, kind: 'photos' };
    } else if (opts?.uploadId) {
      lastAttachment = { name: file.name, kind: 'cloud', uploadId: opts.uploadId };
    }
    // «Повторить» (без вложения) — то, что прикрепили последним, и только если
    // это тот же договор (по имени на карточке ошибки).
    const retry = !rawFile && !opts?.photos?.length && !opts?.uploadId && lastAttachment?.name === file.name ? lastAttachment : null;
    const retryUploadId = retry?.kind === 'cloud' ? retry.uploadId : undefined;
    const photoRun = opts?.photos?.length || retry?.kind === 'photos' ? lastPhotos : null;
    const effectiveRaw = photoRun ? null : (rawFile ?? (retry?.kind === 'file' ? lastRawFile : null));
    if (retryUploadId) opts = { ...opts, uploadId: retryUploadId };
    // opts.uploadId — файл уже НА СЕРВЕРЕ (импорт из Google Drive / OneDrive /
    // Dropbox). Раньше этот гейт заворачивал такой запуск, и импорт из облака
    // НИКОГДА не доходил до анализа: пользователь видел «прикрепите файл
    // заново» после успешного импорта (аудит 2026-08-03).
    if (!effectiveRaw && !opts?.uploadId && !photoRun && !USE_MOCK) {
      useUIStore.getState().pushToast(tStandalone('chat.retryNeedsFile'), 'error');
      return;
    }
    // Потребляем ключ «новый договор в деле» СЕЙЧАС (read+clear): строго
    // одноразово для этого запуска. Провал/следующий несвязанный анализ уже не
    // подхватят его и не утащат договор в чужое дело. Успех подошьёт по локали.
    const pendingProjectId = consumePendingProject();
    const epoch = canvasEpoch;
    clearStepTimers();

    const userMessage: ChatMessage = {
      id: `m_${Date.now()}`,
      role: 'user',
      kind: 'file',
      file,
    };

    set({
      phase: 'analyzing',
      messages: [userMessage],
      // keepCanvas: черновик остаётся на экране, пока идёт анализ.
      analysis: opts?.keepCanvas ? get().analysis : null,
      activeStep: 0,
      analysisStartedAt: Date.now(),
      error: null,
      // Новый договор — новый чат: прежний чат больше не «текущий», иначе
      // анализ мог привязаться к нему, пока новый ещё создаётся (аудит загрузок
      // 2026-10-18: в старом чате оказывался разбор чужого договора).
      ...(opts?.newSession ? { serverSessionId: null } : {}),
    });

    // Чат под этот анализ. Канвасу он назначается, только если пользователь
    // всё ещё здесь; привязка анализа к нему — в любом случае (см. ниже).
    let ownSession: Promise<string | null> | null = null;
    if (opts?.newSession) {
      const created = useChatHistoryStore
        .getState()
        .addSession(file.name)
        .then((session) => session?.id ?? null)
        .catch(() => null);
      ownSession = created;
      pendingRunSession = created;
      void created.then((sid) => {
        if (sid && epoch === canvasEpoch && pendingRunSession === created && !get().serverSessionId) {
          set({ serverSessionId: sid });
          tryLinkAnalysis();
        }
      });
    }

    // Advance the visible progress steps while the request is in flight.
    // Шаги — это ожидаемый ПОРЯДОК работ, а не измеренное время: реальный
    // разбор занимает от десятков секунд до минут (замер 30,8 с на коротком
    // договоре). Поэтому после последнего шага карточка не замирает на 66%, а
    // показывает бегущее время (см. AnalysisCard).
    for (let i = 1; i < ANALYSIS_STEPS.length; i++) {
      stepTimers.push(setTimeout(() => set({ activeStep: i }), STEP_INTERVAL * i));
    }
    const controller = typeof AbortController === 'undefined' ? null : new AbortController();
    analysisAbort = controller;

    try {
      let uploadId = opts?.uploadId;
      let fileName = file.name;
      let fileSize = file.size;
      if (photoRun && !USE_MOCK) {
        // Фото → PDF на сервере. Отказ (тариф, размер, не фото) уходит в
        // карточку ошибки с настоящей причиной, а не общим «не загрузилось».
        const up = photoRun.upload ?? (await uploadsApi.uploadPhotos(photoRun.photos, file.name));
        photoRun.upload = up;
        uploadId = up.id;
        fileName = up.fileName;
        fileSize = up.fileSize;
      } else if (effectiveRaw && !opts?.uploadId && !USE_MOCK) {
        // Ship the file itself first — the AI reads the actual contract text.
        // Анализ идёт по id ЭТОЙ загрузки: раньше id выбрасывался, и сервер
        // искал «последний файл с таким именем» — при двух «Договор.pdf» мог
        // разобрать не тот (аудит загрузок 2026-10-18).
        try {
          const up =
            lastRawUpload?.file === effectiveRaw ? lastRawUpload.upload : await uploadsApi.upload(effectiveRaw);
          lastRawUpload = { file: effectiveRaw, upload: up };
          uploadId = up.id;
        } catch (err) {
          // Upload failed. Do NOT fall through to analysis without the file —
          // abort with a clear error instead (the outer catch cleans up the
          // empty session). Отказ сервера по существу (формат, пароль на .doc,
          // размер, лимит места) — его словами; сеть и сбои — общим «не загрузилось».
          const reason =
            err instanceof ApiError && err.status >= 400 && err.status < 500
              ? apiErrorMessage(err, tStandalone)
              : tStandalone('chat.uploadFailed');
          useUIStore.getState().pushToast(reason, 'error');
          throw new Error(reason);
        }
      }
      const sessionAtCall = ownSession ? null : get().serverSessionId;
      const result = await analysisApi.analyze({
        fileName,
        fileSize,
          jurisdiction: defaultLaw(),
          ...(uploadId ? { uploadId } : {}),
        },
        controller?.signal,
      );
      // «Новый договор» из проекта: здесь фронт впервые узнаёт documentId —
      // переносим документ в дело (по локали, ключ уже погашен на старте) даже
      // если канвас переключили. Ошибка глотается в тост внутри хелпера.
      adoptDocIntoProject(result.documentId, pendingProjectId);
      // Свой чат анализа (обычно давно создан — анализ идёт десятки секунд).
      // Если создание чата повисло в сети — результат не ждёт его вечно:
      // привязка случится, когда чат всё-таки появится.
      const settled = ownSession ? await settledWithin(ownSession, OWN_SESSION_WAIT_MS) : null;
      const ownSid = settled ?? null;
      if (ownSession && settled === undefined) {
        void ownSession.then((sid) => {
          if (sid && !USE_MOCK) void chatsApi.linkAnalysis(sid, result.id).catch(() => undefined);
        });
      } else if (pendingRunSession === ownSession) pendingRunSession = null;
      // Persist the session↔analysis link NO MATTER which canvas is visible —
      // otherwise an analysis finished in the background is never restorable
      // and its sidebar chat opens empty. (Idempotent server-side.) Новый
      // договор привязывается ТОЛЬКО к своему чату.
      const linkSid = ownSession ? ownSid : (sessionAtCall ?? get().serverSessionId);
      if (linkSid && !USE_MOCK) void chatsApi.linkAnalysis(linkSid, result.id).catch(() => undefined);
      const mySid = ownSession ? ownSid : sessionAtCall;
      if (epoch !== canvasEpoch) {
        // Canvas switched while analysing. If the user came back to the same
        // session, adopt the finished result; otherwise it stays persisted
        // server-side and is restored when the session is reopened.
        if (mySid && get().serverSessionId === mySid) {
          clearStepTimers();
          set((s) => ({
            phase: 'analyzed',
            analysis: result,
            draftSource: null,
            activeStep: ANALYSIS_STEPS.length,
            error: null,
            docUndo: [],
            docRedo: [],
            // loadSession мог стереть локальный пузырёк файла (сервер узнаёт
            // об анализе только из linkAnalysis, который ещё летит) — вернём
            // его, иначе карточке результата не к чему крепиться и чат
            // встречает приветствием, пряча готовый анализ.
            messages: s.messages.length ? s.messages : [userMessage],
          }));
          tryLinkAnalysis();
        }
        return;
      }
      clearStepTimers();
      set({
        ...(ownSid && !get().serverSessionId ? { serverSessionId: ownSid } : {}),
        phase: 'analyzed',
        analysis: result,
        analysisStartedAt: null,
        draftSource: null, // настоящий анализ заменил сохранённый черновик
        activeStep: ANALYSIS_STEPS.length,
        docUndo: [], // история правок принадлежала предыдущему анализу
        docRedo: [],
      });
      tryLinkAnalysis();
    } catch (err) {
      // Свой чат мог ещё создаваться (быстрый отказ загрузки) — дождаться его,
      // чтобы удалить вместе с неудачным анализом, а не оставить пустым. Если
      // создание повисло — ошибку показываем сразу, а чат удалим, когда появится.
      const settled = ownSession ? await settledWithin(ownSession, OWN_SESSION_WAIT_MS) : null;
      const ownSid = settled ?? null;
      if (pendingRunSession === ownSession) pendingRunSession = null;
      if (ownSession && settled === undefined && !USE_MOCK) {
        void ownSession.then((sid) => {
          if (sid) void chatsApi.remove(sid).then(() => refreshHistory()).catch(() => undefined);
        });
      }
      if (epoch !== canvasEpoch) return;
      // Отмена пользователем — не ошибка: состояние уже сброшено в cancelAnalysis.
      if (err instanceof DOMException && err.name === 'AbortError') return;
      clearStepTimers();
      // The sidebar session was created optimistically FOR this analysis. If
      // nothing was ever persisted into it (no text messages), remove it —
      // otherwise a failed/limited analysis leaves a dead chat that opens empty.
      const deadSid = ownSid ?? get().serverSessionId;
      const hasText = get().messages.some((m) => m.kind === 'text');
      if (deadSid && !hasText && !USE_MOCK) {
        set({ serverSessionId: null });
        void chatsApi
          .remove(deadSid)
          .then(() => refreshHistory())
          .catch(() => undefined);
      }
      set({
        phase: 'error',
        // Отказ по тарифу собирается на языке интерфейса (apiErrorMessage),
        // остальное — сообщение сервера как есть.
        error: apiErrorMessage(err, tStandalone),
        activeStep: -1,
        analysisStartedAt: null,
      });
    }
  },

  reset: () => {
    clearStepTimers();
    finishActiveStreams();
    canvasEpoch++;
    set({ phase: 'idle', messages: [], analysis: null, draftSource: null, activeStep: -1, error: null, serverSessionId: null, sessionLoading: false, docUndo: [], docRedo: [] });
  },

  sendMessage: (text, files) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    const attached = files?.length ? files : undefined;
    const epoch = canvasEpoch;
    // Fast-forward the previous reply's animation: history must carry its
    // full text and no message may linger in streaming state.
    finishActiveStreams();

    const userMessage: ChatMessage = {
      id: `u_${Date.now()}`,
      role: 'user',
      kind: 'text',
      text: trimmed,
      ...(attached ? { attachments: attached.map(({ name, size }) => ({ name, size })) } : {}),
    };
    const assistantId = `a_${Date.now()}`;
    const assistantMessage: ChatMessage = {
      id: assistantId,
      role: 'assistant',
      kind: 'text',
      text: '',
      streaming: true,
      work: { steps: [], startedAt: Date.now() },
    };

    // Keep the chat visible even before any analysis has run.
    set((s) => ({
      phase: s.phase === 'idle' ? 'analyzed' : s.phase,
      messages: [...s.messages, userMessage, assistantMessage],
    }));

    if (USE_MOCK) {
      const { steps, total } = mockWorkSteps(trimmed, attached?.map((f) => f.name));
      for (const [at, step] of steps) setTimeout(() => applyStep(assistantId, step), at);
      setTimeout(() => streamIn(assistantId, mockReply(trimmed)), total);
      return;
    }

    // A declined plan limit surfaces as a limit; any other failure surfaces as
    // an honest error — never a fabricated legal answer (a canned reply would
    // masquerade as real AI output in a legal product).
    const failReply = (err: unknown) => {
      // Ход работы у несостоявшегося ответа не показываем — только ошибку.
      set((s) => ({ messages: s.messages.map((m) => (m.id === assistantId ? { ...m, work: undefined } : m)) }));
      if (err instanceof ApiError && err.status === 402) {
        streamIn(assistantId, tStandalone('chat.limitReached'));
        useUIStore.getState().pushToast(apiErrorMessage(err, tStandalone), 'error');
        return;
      }
      const message = apiErrorMessage(err, tStandalone);
      streamIn(assistantId, tStandalone('chat.error'));
      useUIStore.getState().pushToast(message, 'error');
    };

    // Real backend: ensure a server-side chat session, then ask the AI.
    void (async () => {
      try {
        let sessionId = get().serverSessionId;
        if (!sessionId) {
          const title = get().analysis?.fileName ?? trimmed.slice(0, 60);
          const session = await chatsApi.create(title);
          if (epoch !== canvasEpoch) return;
          sessionId = session.id;
          set({ serverSessionId: sessionId });
          refreshHistory(); // the new chat shows up in the sidebar right away
        }
        // Ground the reply in the contract being reviewed (document Q&A).
        // Tokens stream live into the placeholder as the model writes them.
        pendingReplies.set(sessionId, assistantId);
        liveStreamIds.add(assistantId);
        const painter = makeLivePainter(assistantId);
        // Сохранённый черновик: серверного анализа нет (id draft_… сервер не знает) —
        // контекстом вопроса едет сам текст черновика.
        const draftSrc = get().draftSource;
        const reply = await chatsApi.sendMessage(
          sessionId,
          trimmed,
          draftSrc ? undefined : get().analysis?.id,
          defaultLaw(),
          painter.onToken,
          draftSrc ? { title: draftSrc.title, content: draftSrc.content } : undefined,
          attached?.map((f) => f.uploadId),
          (step) => applyStep(assistantId, step),
        );
        painter.cancel();
        pendingReplies.delete(sessionId);
        liveStreamIds.delete(assistantId);
        if (epoch === canvasEpoch) {
          // Adopt the server-side message id (so thumbs rating hits the
          // persisted row) and drop in the authoritative final text.
          set((s) => ({
            messages: s.messages.map((m) =>
              m.id === assistantId ? { ...m, id: reply.id, text: reply.text ?? '', streaming: false, work: endWork(m.work) } : m,
            ),
          }));
        } else if (get().serverSessionId === sessionId) {
          // The user left and came back to this chat while the model worked:
          // reuse the placeholder loadSession restored (or append one) and
          // drop the finished reply into it.
          set((s) => {
            if (s.messages.some((m) => m.id === assistantId)) {
              return {
                messages: s.messages.map((m) =>
                  m.id === assistantId ? { ...m, id: reply.id, text: reply.text ?? '', streaming: false, work: endWork(m.work) } : m,
                ),
              };
            }
            return {
              messages: [
                ...s.messages,
                { id: reply.id, role: 'assistant' as const, kind: 'text' as const, text: reply.text ?? '', streaming: false },
              ],
            };
          });
        }
        // Another canvas is open: nothing to draw — the reply is persisted
        // server-side and appears when that chat is reopened.
        refreshHistory(); // bump the session to the top (updated_at changed)
      } catch (err) {
        const sid = get().serverSessionId;
        for (const [k, v] of pendingReplies) if (v === assistantId) pendingReplies.delete(k);
        liveStreamIds.delete(assistantId);
        if (epoch === canvasEpoch) {
          failReply(err);
        } else if (sid && get().messages.some((m) => m.id === assistantId)) {
          failReply(err); // restored placeholder — resolve it honestly
        }
      }
    })();
  },

  loadSession: async (sessionId) => {
    if (USE_MOCK) return;
    // already showing this one — но неудавшаяся загрузка обязана перезапускаться
    if (get().serverSessionId === sessionId && !get().sessionLoadFailed) return;
    clearStepTimers();
    finishActiveStreams();
    // Snapshot the canvas we're leaving, so coming back paints instantly.
    const leaving = get();
    if (leaving.serverSessionId && leaving.messages.length) {
      cacheSession(leaving.serverSessionId, { messages: leaving.messages, analysis: leaving.analysis });
    }
    canvasEpoch++;
    const epoch = canvasEpoch;

    // A reply for this session may still be generating in the background —
    // restore its "thinking" placeholder so the stream lands visibly.
    const withPending = (msgs: ChatMessage[]): ChatMessage[] => {
      const pendingId = pendingReplies.get(sessionId);
      return pendingId && !msgs.some((m) => m.id === pendingId)
        ? [...msgs, { id: pendingId, role: 'assistant' as const, kind: 'text' as const, text: '', streaming: true }]
        : msgs;
    };

    // Paint IMMEDIATELY: the cached conversation if we have one (revalidated
    // below), otherwise an empty canvas with a loading skeleton — the click
    // must never feel dead while the network round-trips run.
    const cached = sessionCache.get(sessionId);
    set({
      phase: cached ? 'analyzed' : 'idle',
      messages: cached ? withPending(cached.messages) : [],
      analysis: cached?.analysis ?? null,
      draftSource: null,
      activeStep: cached?.analysis ? ANALYSIS_STEPS.length : -1,
      error: null,
      serverSessionId: sessionId,
      sessionLoading: !cached,
      sessionLoadFailed: false,
      docUndo: [], // история правок не переезжает между чатами/анализами
      docRedo: [],
    });

    try {
      const messages = await chatsApi.messages(sessionId);
      if (epoch !== canvasEpoch) return;
      // Stage 1: the conversation shows as soon as it arrives — the analysis
      // card (a second round-trip) attaches right after.
      set((s) => {
        // Обратный порядок гонки фонового анализа: усыновление могло УЖЕ
        // вернуть пузырёк файла и результат, а сервер ещё отвечает «сообщений
        // нет» (linkAnalysis в пути). Пустой список не должен стирать живой
        // канвас — иначе готовый анализ снова прячется за приветствием.
        const keepLocal = messages.length === 0 && s.analysis !== null && s.messages.length > 0;
        return {
          phase: messages.length || keepLocal ? 'analyzed' : 'idle',
          messages: keepLocal ? s.messages : withPending(messages),
          sessionLoading: false,
        };
      });
      const analysisRef = [...messages].reverse().find((m) => m.analysisId)?.analysisId;
      const analysis = analysisRef ? await analysisApi.get(analysisRef).catch(() => null) : null;
      cacheSession(sessionId, { messages, analysis });
      if (epoch !== canvasEpoch) return;
      set((s) => {
        // Пока мы ходили за сообщениями, фоновый анализ ЭТОЙ ЖЕ сессии мог
        // «усыновиться» в канвас (его серверная связка linkAnalysis ещё в
        // пути, поэтому analysisRef пуст). Не затираем живой результат
        // null-ом — сервер догонит через мгновение. Но если сервер ЗНАЕТ про
        // анализ (analysisRef есть), его правда главнее: удалённый/недоступный
        // анализ не должен жить в кэше вкладки.
        const kept = analysis ?? (analysisRef ? null : s.analysis);
        return {
          phase: s.messages.length || kept ? 'analyzed' : 'idle',
          analysis: kept,
          activeStep: kept ? ANALYSIS_STEPS.length : -1,
        };
      });
    } catch (err) {
      if (epoch !== canvasEpoch) return;
      if (err instanceof ApiError && err.status === 404) {
        // Session unknown to the server — show an empty canvas instead of
        // someone else's demo contract.
        set({ phase: 'idle', messages: [], analysis: null, activeStep: -1, error: null, serverSessionId: null, sessionLoading: false });
        return;
      }
      // Сеть моргнула / сервер 5xx: это НЕ «чата нет». Сессию не отвязываем
      // (иначе следующее сообщение молча создало бы НОВЫЙ чат-развилку) и не
      // стираем уже нарисованный кэш. Флаг даёт странице показать «повторить».
      useUIStore.getState().pushToast(tStandalone('chat.loadFailed'), 'error');
      set({ sessionLoading: false, sessionLoadFailed: true });
    }
  },

  setServerSession: (id) => {
    set({ serverSessionId: id });
    tryLinkAnalysis();
  },

  // Documents page → "Open workspace": show that document's own analysis.
  adoptAnalysis: (analysis) => {
    clearStepTimers();
    finishActiveStreams();
    canvasEpoch++;
    set({
      phase: 'analyzed',
      messages: [
        {
          id: `m_${Date.now()}`,
          role: 'user',
          kind: 'file',
          file: { name: analysis.fileName, size: analysis.fileSize },
        },
      ],
      analysis,
      draftSource: null,
      activeStep: ANALYSIS_STEPS.length,
      error: null,
      serverSessionId: null,
      sessionLoading: false, // незавершённый loadSession не оставит скелетон
      // A freshly opened document starts with a clean edit history.
      docUndo: [],
      docRedo: [],
    });
  },

  // Vault → Documents → открыть сохранённый черновик в воркспейсе. Анализа ещё нет: findings
  // пусты; правки блоков разрешены и сохраняются в сам документ (PATCH
  // /templates/saved/:id); кнопка «Анализ рисков» запустит startAnalysis
  // с keepCanvas (текст останется на экране, пока ИИ работает).
  adoptDraft: (tpl) => {
    clearStepTimers();
    finishActiveStreams();
    canvasEpoch++;
    set({
      phase: 'analyzed',
      messages: [],
      analysis: {
        id: `draft_${tpl.id}`,
        fileName: tpl.title,
        fileSize: '',
        summary: '',
        riskScore: 0,
        riskLevel: 'Low',
        clausesReviewed: 0,
        findings: [],
        redlines: [],
        document: draftContentToBlocks(tpl.content),
        canEdit: true, // правки сохраняются в сам сохранённый документ
      },
      draftSource: { savedTemplateId: tpl.id, title: tpl.title, content: tpl.content },
      activeStep: -1,
      error: null,
      serverSessionId: null,
      sessionLoading: false, // незавершённый loadSession не оставит скелетон
      docUndo: [],
      docRedo: [],
    });
  },

  updateDraftContent: (content) =>
    set((s) => (s.draftSource ? { draftSource: { ...s.draftSource, content } } : s)),

  reanalyze: async () => {
    const current = get().analysis;
    if (!current) throw new Error('Nothing to re-analyse');
    // Эпоха как в startAnalysis/sendMessage: пока повторный анализ летел,
    // пользователь мог открыть ДРУГОЙ чат — поздний результат не должен
    // захватывать чужой канвас и намертво привязываться к чужой сессии.
    const epoch = canvasEpoch;
    const sessionAtCall = get().serverSessionId;
    const result = await analysisApi.reanalyze(current.id, defaultLaw());
    if (epoch !== canvasEpoch) {
      // Связку сессия↔анализ сохраняем для ТОЙ сессии, где анализ запускали.
      if (sessionAtCall && !USE_MOCK) void chatsApi.linkAnalysis(sessionAtCall, result.id).catch(() => undefined);
      return result;
    }
    set({ analysis: result, phase: 'analyzed', activeStep: ANALYSIS_STEPS.length, error: null, docUndo: [], docRedo: [] });
    tryLinkAnalysis();
    return result;
  },


  setRedlineStatus: (id, status) => {
    const analysis = get().analysis;
    if (!analysis) return;
    // Remember the status we're leaving, so a failed persist rolls back to it
    // (not blindly to 'pending' — reverting an accepted change that fails must
    // return to 'accepted', not silently discard the earlier decision).
    const prev = analysis.redlines.find((r) => r.id === id)?.status ?? 'pending';
    if (prev === status) return;
    set({
      analysis: {
        ...analysis,
        redlines: analysis.redlines.map((r) => (r.id === id ? { ...r, status } : r)),
      },
    });
    // Persist EVERY transition (accept, reject, and revert-to-pending) so the
    // decision survives reloads and reaches exports/teammates. On failure the
    // optimistic change rolls back — the UI must never claim a state the
    // server did not store.
    void analysisApi.updateRedline(analysis.id, id, status).catch(() => {
      const a = get().analysis;
      if (a && a.id === analysis.id) {
        set({
          analysis: { ...a, redlines: a.redlines.map((r) => (r.id === id ? { ...r, status: prev } : r)) },
        });
      }
      useUIStore.getState().pushToast(tStandalone('common.error'), 'error');
    });
  },

  acceptAllRedlines: () => {
    const analysis = get().analysis;
    if (!analysis) return [];
    const pending = analysis.redlines.filter((r) => r.status === 'pending');
    set({
      analysis: {
        ...analysis,
        redlines: analysis.redlines.map((r) => (r.status === 'pending' ? { ...r, status: 'accepted' } : r)),
      },
    });
    void Promise.allSettled(
      pending.map((r) => analysisApi.updateRedline(analysis.id, r.id, 'accepted').then(() => r.id)),
    ).then((results) => {
      const failed = new Set(
        results.flatMap((res, i) => (res.status === 'rejected' ? [pending[i].id] : [])),
      );
      if (!failed.size) return;
      const a = get().analysis;
      if (a && a.id === analysis.id) {
        set({
          analysis: { ...a, redlines: a.redlines.map((r) => (failed.has(r.id) ? { ...r, status: 'pending' } : r)) },
        });
      }
      useUIStore.getState().pushToast(tStandalone('common.error'), 'error');
    });
    // Hand back the ids we flipped so the caller can offer a 5s Undo.
    return pending.map((r) => r.id);
  },

  /** Undo: send the given redlines back to 'pending' (used by the Accept-all
   *  undo toast). Persists each revert; a failed one is left accepted. */
  revertRedlines: (ids) => {
    const analysis = get().analysis;
    if (!analysis || !ids.length) return;
    const idSet = new Set(ids);
    set({
      analysis: {
        ...analysis,
        redlines: analysis.redlines.map((r) => (idSet.has(r.id) ? { ...r, status: 'pending' } : r)),
      },
    });
    void Promise.allSettled(
      ids.map((id) => analysisApi.updateRedline(analysis.id, id, 'pending').then(() => id)),
    ).then((results) => {
      const failed = new Set(results.flatMap((res, i) => (res.status === 'rejected' ? [ids[i]] : [])));
      if (!failed.size) return;
      const a = get().analysis;
      if (a && a.id === analysis.id) {
        set({
          analysis: { ...a, redlines: a.redlines.map((r) => (failed.has(r.id) ? { ...r, status: 'accepted' } : r)) },
        });
      }
      useUIStore.getState().pushToast(tStandalone('common.error'), 'error');
    });
  },

  pendingRedlineCount: () =>
    get().analysis?.redlines.filter((r) => r.status === 'pending').length ?? 0,

  updateDocument: (document, snapshot = true) =>
    set((s) => {
      if (!s.analysis) return s;
      // A manual paragraph edit can drop {redlineId} slots — retire pending
      // suggestions that are no longer in the document (the server PATCH does
      // the same), so the "N suggestions" counters match what is visible.
      const referenced = new Set<string>();
      for (const b of document) {
        for (const seg of b.segments ?? []) {
          if (isRedlineSlot(seg)) referenced.add(seg.redlineId);
        }
      }
      const before: DocSnapshot = { analysisId: s.analysis.id, document: s.analysis.document, redlines: s.analysis.redlines };
      return {
        analysis: {
          ...s.analysis,
          document,
          redlines: s.analysis.redlines.filter((r) => r.status !== 'pending' || referenced.has(r.id)),
        },
        // Record the pre-edit state so Undo restores both blocks AND redlines.
        docUndo: snapshot ? [...s.docUndo, before].slice(-50) : s.docUndo,
        docRedo: snapshot ? [] : s.docRedo,
      };
    }),

  toggleShowEdits: () => set((s) => ({ showEdits: !s.showEdits })),

  undoDocument: () => {
    const s = get();
    if (!s.analysis || s.docUndo.length === 0) return;
    const prev = s.docUndo[s.docUndo.length - 1];
    if (prev.analysisId !== s.analysis.id) {
      // Осиротевшие снимки другого анализа — выбрасываем, не применяем.
      set({ docUndo: [], docRedo: [] });
      return;
    }
    const current: DocSnapshot = { analysisId: s.analysis.id, document: s.analysis.document, redlines: s.analysis.redlines };
    set({
      analysis: { ...s.analysis, document: prev.document, redlines: prev.redlines },
      docUndo: s.docUndo.slice(0, -1),
      docRedo: [...s.docRedo, current].slice(-50),
    });
    // Send the restored redlines too: undo can re-introduce a slot whose redline
    // an earlier edit deleted server-side — without this the clause text is lost.
    // Сохранённый черновик живёт не в analyses — его синхронизирует воркспейс
    // (PATCH /templates/saved/:id), серверного анализа для него нет.
    if (!s.draftSource) void persistDocument(get().analysis!.id, prev.document, prev.redlines);
  },

  redoDocument: () => {
    const s = get();
    if (!s.analysis || s.docRedo.length === 0) return;
    const next = s.docRedo[s.docRedo.length - 1];
    if (next.analysisId !== s.analysis.id) {
      set({ docUndo: [], docRedo: [] });
      return;
    }
    const current: DocSnapshot = { analysisId: s.analysis.id, document: s.analysis.document, redlines: s.analysis.redlines };
    set({
      analysis: { ...s.analysis, document: next.document, redlines: next.redlines },
      docRedo: s.docRedo.slice(0, -1),
      docUndo: [...s.docUndo, current].slice(-50),
    });
    if (!s.draftSource) void persistDocument(get().analysis!.id, next.document, next.redlines);
  },
  };
});

/** Persist swapped document blocks (undo/redo); surface a toast on failure.
 *  `redlines` (the restored snapshot) lets the server re-create a redline the
 *  document references but that an earlier edit deleted — see saveDocument. */
function persistDocument(analysisId: string, document: DocBlock[], redlines?: Redline[]): Promise<void> {
  return analysisApi
    .saveDocument(analysisId, document, redlines)
    .then(() => undefined)
    .catch(() => useUIStore.getState().pushToast(tStandalone('common.error'), 'error'));
}
