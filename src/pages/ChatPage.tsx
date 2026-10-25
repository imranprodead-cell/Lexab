import { useCallback, useEffect, useLayoutEffect, useRef, useState, type DragEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { motion } from 'motion/react';
import { EASE } from '@/lib/motion';
import { TopBar } from '@/components/layout/TopBar';
import { TopBarActions } from '@/components/layout/TopBarActions';
import { CountrySelector } from '@/components/layout/CountrySelector';
import { BrandMenu } from '@/components/layout/BrandMenu';
import { Icon, type IconName } from '@/components/icons/Icon';
import { WelcomeScreen } from '@/components/chat/WelcomeScreen';
import { UserFileBubble } from '@/components/chat/UserFileBubble';
import { AnalysisCard } from '@/components/chat/AnalysisCard';
import { SummaryCard } from '@/components/chat/SummaryCard';
import { ChatInput } from '@/components/chat/ChatInput';
import { MessageFiles, type ComposerAttachment } from '@/components/chat/Attachments';
import { WorkSteps } from '@/components/chat/WorkSteps';
import { TaskSidebar } from '@/components/chat/TaskSidebar';
import { CloudImportModal } from '@/components/chat/CloudImportModal';
import { MessageActions } from '@/components/chat/MessageActions';
import { MarkdownMessage } from '@/components/chat/MarkdownMessage';
import { DeckCard } from '@/components/chat/DeckCard';
import { ArtifactPanel } from '@/components/chat/ArtifactPanel';
import { PlanApprovalCard, PlanApprovedPill, QuestionCard } from '@/components/chat/ChoiceCards';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { ScalesMascot } from '@/components/ui/ScalesMascot';
import { Modal } from '@/components/ui/Modal';
import { ErrorState, SkeletonRows } from '@/components/ui/States';
import { USE_MOCK } from '@/api';
import { billingApi } from '@/api/billing.api';
import { analysisApi } from '@/api/analysis.api';
import { useAsync } from '@/hooks/useAsync';
import { useChatStore } from '@/store/useChatStore';
import { useUIStore } from '@/store/useUIStore';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useI18n } from '@/i18n/I18nProvider';
import { formatFileSize } from '@/lib/format';
import { isAttachFile, isDocFile, MAX_DOC_BYTES, maxAttachments } from '@/lib/docFormats';
import { isSlidesCommand, parseDeck } from '@/lib/deck';
import { extractArtifacts, type Artifact } from '@/lib/artifacts';
import { answersMessage, displayText, extractQuestions, isApproveCommand, isPlanCommand, looksLikePlan } from '@/lib/questions';
import { COMMANDS } from '@/data/seed';
import { plansLabel } from '@/lib/planFeatures';
import { MAX_PHOTO_BYTES, MAX_PHOTOS, uploadsApi, type UploadedFile } from '@/api/uploads.api';
import { ApiError } from '@/api/util';
import { apiErrorMessage } from '@/i18n/apiError';
import { COUNTRIES } from '@/data/countries';
import type { ChatMessage } from '@/types/domain';
import chat from '@/components/chat/chat.module.css';

/** Фото страниц договора: по расширению или типу (HEIC в Chrome приходит без типа). */
const PHOTO = /\.(jpe?g|png|webp|heic|heif)$/i;
const isPhoto = (f: File) => PHOTO.test(f.name) || f.type.startsWith('image/');

/** «Фото договора 17.10.2026 18-42-05.pdf» — уникально до секунды: документы
 *  различаются по имени, и вторая пачка фото не должна лечь поверх первой. */
function photoDocName(base: string, d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${base} ${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()} ${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}.pdf`;
}

const PLAN_HINT_KEY = 'lexai.planHint';
function readPlanHint(): string | null {
  try {
    return localStorage.getItem(PLAN_HINT_KEY);
  } catch {
    return null;
  }
}
function savePlanHint(plan: string) {
  try {
    localStorage.setItem(PLAN_HINT_KEY, plan);
  } catch {
    /* хранилище недоступно — полоска появится после ответа сервера */
  }
}

// Позиция прокрутки по сессиям: возврат из рабочей области (размонтирование →
// монтирование ChatPage) возвращает ленту туда, где читали, а не в самый низ.
// Сигнатура ids инвалидирует запись, как только переписка изменилась.
const savedScroll = new Map<string, { top: number; ids: string }>();

/** Кнопка «вниз»: показ, когда ниже экрана спрятано больше JUMP_SHOW_PX текста
 *  (заметно ушли вверх), скрытие — ближе JUMP_HIDE_PX к концу. Разрыв между
 *  порогами не даёт ей мигать на границе. */
const JUMP_SHOW_PX = 360;
const JUMP_HIDE_PX = 80;
const JUMP_DELAY_MS = 180;

/** User message bubble; long texts collapse with an inline "Expand ⌄" link. */
function UserBubble({ text: raw }: { text: string }) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  // «/plan …» → цветная плашка «Plan» + текст, как в поле ввода до отправки.
  const cmd = COMMANDS.find((c) => raw === c.cmd || raw.startsWith(`${c.cmd} `) || raw.startsWith(`${c.cmd}\n`));
  const text = cmd ? raw.slice(cmd.cmd.length).replace(/^\s+/, '') : raw;
  const chip = cmd ? (
    <span className={chat.bubbleChip} data-tone={cmd.cmd.slice(1)}>
      <Icon name={cmd.icon as IconName} size={14} strokeWidth={1.9} />
      <span className={chat.cmdChipLabel}>{cmd.cmd.slice(1)}</span>
    </span>
  ) : null;
  const long = text.length > 550 || text.split('\n').length > 8;
  if (!long)
    return (
      <div className={`${chat.msgUserBubble} ${chat.textIn}`}>
        {chip}
        {text}
      </div>
    );
  return (
    <div className={`${chat.msgUserBubble} ${chat.textIn}`}>
      <div className={expanded ? undefined : chat.bubbleClampText}>
        {chip}
        {text}
      </div>
      <button type="button" className={chat.bubbleMore} onClick={() => setExpanded((v) => !v)}>
        {expanded ? t('chat.collapse') : t('chat.expand')}
        <span className={`${chat.bubbleMoreChevron} ${expanded ? chat.bubbleMoreChevronOpen : ''}`}>
          <Icon name="chevron" size={14} />
        </span>
      </button>
    </div>
  );
}

/**
 * The conversational canvas: welcome → streaming analysis → follow-up chat.
 * Supports drag-and-drop contract upload and streamed assistant replies.
 */
export function ChatPage() {
  const { sessionId } = useParams();
  const navigate = useNavigate();
  const { t } = useI18n();
  usePageTitle(t('nav.chat'));

  const phase = useChatStore((s) => s.phase);
  const messages = useChatStore((s) => s.messages);
  const analysis = useChatStore((s) => s.analysis);
  const activeStep = useChatStore((s) => s.activeStep);
  const steps = useChatStore((s) => s.steps);
  const error = useChatStore((s) => s.error);
  const startAnalysis = useChatStore((s) => s.startAnalysis);
  const sendMessage = useChatStore((s) => s.sendMessage);
  const loadSession = useChatStore((s) => s.loadSession);
  const requestAnchor = useChatStore((s) => s.requestAnchor);
  const setFeedback = useChatStore((s) => s.setFeedback);
  const sessionLoading = useChatStore((s) => s.sessionLoading);
  const sessionLoadFailed = useChatStore((s) => s.sessionLoadFailed);
  const serverSessionId = useChatStore((s) => s.serverSessionId);
  const adoptAnalysis = useChatStore((s) => s.adoptAnalysis);

  const pushToast = useUIStore((s) => s.pushToast);
  const country = useUIStore((s) => s.country);
  const threadRef = useRef<HTMLDivElement | null>(null);
  // Тот же узел ленты в state: за ним следит ResizeObserver кнопки «вниз»
  // (лента монтируется и пропадает при смене экранов чата).
  const [threadEl, setThreadEl] = useState<HTMLDivElement | null>(null);
  const attachThread = useCallback((node: HTMLDivElement | null) => {
    threadRef.current = node;
    setThreadEl(node);
  }, []);
  const [dragging, setDragging] = useState(false);
  const [cloudOpen, setCloudOpen] = useState(false);
  const [draftOpen, setDraftOpen] = useState(false);
  const [draftPrompt, setDraftPrompt] = useState('');
  const [drafting, setDrafting] = useState(false);

  // The Free-plan upsell above the composer (hidden on every paid plan).
  const { data: limits } = useAsync((signal) => billingApi.limits(signal), []);
  // Тариф известен только после ответа сервера, а полоска «Больше возможностей»
  // стоит над полем ввода: появляясь позже, она сдвигала его. Пока ответа нет —
  // тариф с прошлого раза (подсказка в браузере, не источник истины).
  const [planHint] = useState(readPlanHint);
  useEffect(() => {
    if (limits?.plan) savePlanHint(limits.plan);
  }, [limits?.plan]);
  const isFree = (limits?.plan ?? planHint) === 'Free';
  // ≥80% месячного лимита ИИ-запросов (на планах с потолком) — конкретный
  // счётчик вместо общих слов, на любом тарифе.
  const nearLimit = Boolean(
    limits?.aiRequests?.limit && limits.aiRequests.used / limits.aiRequests.limit >= 0.8,
  );

  // Opening a previous session from the sidebar restores its conversation
  // (from the server in real mode; the demo state in mock mode).
  useEffect(() => {
    if (sessionId) void loadSession(sessionId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  // ── Scroll behaviour (ChatGPT-style) ──────────────────────────────────────
  // A newly sent user message pins to the TOP of the viewport (the reply and
  // the "thinking" mascot grow just below it), and during streaming the chat
  // auto-follows only while the user is already at the bottom — scrolling up
  // to read is never hijacked.
  const stickRef = useRef(false);
  const prevIdsRef = useRef('');
  const anchorRef = useRef<string | null>(null);
  const [tailPad, setTailPad] = useState(0);
  // Ключ сохранённой позиции — через ref, чтобы не добавлять deps эффекту.
  const scrollKey = serverSessionId ?? sessionId ?? 'local';
  const scrollKeyRef = useRef(scrollKey);
  scrollKeyRef.current = scrollKey;

  // ── Кнопка «вниз» ─────────────────────────────────────────────────────────
  // Появляется, только когда пользователь заметно ушёл вверх от конца
  // переписки. Защита от ложных появлений, пока ИИ пишет ответ:
  //  • «сколько спрятано ниже» меряется по низу последнего сообщения, а не по
  //    scrollHeight: под свежим вопросом лежит пустой запас tailPad под ответ;
  //  • пока лента сама следует за ответом (stickRef), кнопки нет;
  //  • показ — с задержкой и перепроверкой, поэтому кадр «текст уже вырос,
  //    а лента ещё не догнала» её не зажигает. Прячется сразу.
  const [showJump, setShowJump] = useState(false);
  const showJumpRef = useRef(false);
  const jumpTimerRef = useRef<number | undefined>(undefined);
  /** Идёт плавный спуск по кнопке — промежуточные позиции не сбрасывают следование. */
  const jumpingRef = useRef(false);
  const lastTopRef = useRef(0);

  const updateJump = useCallback(() => {
    const hiddenBelow = () => {
      const el = threadRef.current;
      const last = el?.firstElementChild?.lastElementChild;
      if (!el || !last) return 0;
      return last.getBoundingClientRect().bottom - el.getBoundingClientRect().bottom;
    };
    const following = () => stickRef.current || jumpingRef.current;
    if (showJumpRef.current) {
      if (following() || hiddenBelow() < JUMP_HIDE_PX) {
        showJumpRef.current = false;
        setShowJump(false);
      }
      return;
    }
    if (jumpTimerRef.current !== undefined || following() || hiddenBelow() < JUMP_SHOW_PX) return;
    jumpTimerRef.current = window.setTimeout(() => {
      jumpTimerRef.current = undefined;
      if (!following() && hiddenBelow() >= JUMP_SHOW_PX) {
        showJumpRef.current = true;
        setShowJump(true);
      }
    }, JUMP_DELAY_MS);
  }, []);

  const onThreadScroll = () => {
    const el = threadRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (jumpingRef.current) {
      // Плавный спуск по кнопке: дошли до низа — готово; поехали вверх —
      // пользователь перехватил прокрутку, следование снимаем.
      if (atBottom || el.scrollTop < lastTopRef.current - 2) jumpingRef.current = false;
      stickRef.current = atBottom || jumpingRef.current;
    } else {
      stickRef.current = atBottom;
    }
    lastTopRef.current = el.scrollTop;
    // Сохраняем в слушателе, не в cleanup: при размонтировании threadRef уже null.
    savedScroll.set(scrollKeyRef.current, { top: el.scrollTop, ids: prevIdsRef.current });
    updateJump();
  };

  const jumpToBottom = () => {
    const el = threadRef.current;
    if (!el) return;
    window.clearTimeout(jumpTimerRef.current);
    jumpTimerRef.current = undefined;
    showJumpRef.current = false;
    setShowJump(false);
    // Пустой запас под ответ больше не нужен: текста ниже и так больше экрана,
    // а с ним «самый низ» оказался бы пустым полем.
    setTailPad(0);
    jumpingRef.current = true;
    stickRef.current = true; // догоняем ответ и дальше, если он ещё пишется
    lastTopRef.current = el.scrollTop;
    const smooth =
      !useUIStore.getState().reduceMotion && !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    requestAnimationFrame(() => el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' }));
    // Страховка: спуск, который ничем не завершился, не держит следование вечно.
    window.setTimeout(() => {
      if (!jumpingRef.current) return;
      jumpingRef.current = false;
      stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    }, 1500);
  };

  // Рост текста (ответ пишется, карточка раскрылась) и смена размера окна
  // прокрутку не вызывают — за ними следит ResizeObserver.
  useEffect(() => {
    showJumpRef.current = false;
    setShowJump(false);
    if (!threadEl || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => updateJump());
    ro.observe(threadEl);
    if (threadEl.firstElementChild) ro.observe(threadEl.firstElementChild);
    return () => ro.disconnect();
  }, [threadEl, updateJump]);

  useEffect(() => () => window.clearTimeout(jumpTimerRef.current), []);

  useEffect(() => {
    const el = threadRef.current;
    if (!el) return;
    const ids = messages.map((m) => m.id).join(',');
    const prevIds = prevIdsRef.current;
    // Свежий маунт с той же перепиской (возврат из рабочей области):
    // восстанавливаем позицию и обходим и прыжок в низ, и прижатие к верху.
    if (prevIds === '' && messages.length > 0) {
      const saved = savedScroll.get(scrollKeyRef.current);
      if (saved && saved.ids === ids) {
        prevIdsRef.current = ids;
        anchorRef.current = [...messages].reverse().find((m) => m.role === 'user')?.id ?? null;
        el.scrollTop = saved.top;
        stickRef.current = el.scrollHeight - saved.top - el.clientHeight < 80;
        jumpingRef.current = false;
        return;
      }
    }
    const appended = ids !== prevIds && ids.startsWith(prevIds) && (prevIds !== '' || messages.length <= 3);
    prevIdsRef.current = ids;
    const lastUser = [...messages].reverse().find((m) => m.role === 'user');

    if (lastUser && lastUser.id !== anchorRef.current) {
      anchorRef.current = lastUser.id;
      if (appended) {
        // Just sent: reserve room below, then pin the message to the top.
        setTailPad(Math.max(0, el.clientHeight - 150));
        stickRef.current = false;
        jumpingRef.current = false;
        requestAnimationFrame(() => {
          const node = el.querySelector<HTMLElement>(`[data-mid="${lastUser.id}"]`);
          if (node) {
            const top = node.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop;
            el.scrollTo({ top: Math.max(0, top - 10) });
          }
        });
        return;
      }
      // Whole conversation replaced (opened a saved session): classic bottom.
      setTailPad(0);
      jumpingRef.current = false;
      el.scrollTop = el.scrollHeight;
      return;
    }
    if (stickRef.current) el.scrollTop = el.scrollHeight;
  }, [messages, phase, activeStep, analysis]);

  const openWorkspace = () => navigate(sessionId ? `/chat/${sessionId}/workspace` : '/workspace');

  // Feature B: draft a contract from a prompt, then open it as an editable sheet.
  // With no prompt yet we just open the capture modal; with a prompt we generate,
  // adopt the result into the workspace store, and navigate to the sheet.
  const runDraft = async (prompt: string) => {
    const text = prompt.trim();
    setDraftPrompt(text);
    setDraftOpen(true);
    if (!text) return;
    setDrafting(true);
    try {
      const law = COUNTRIES.find((c) => c.code === country)?.law;
      const result = await analysisApi.draft(text, law);
      adoptAnalysis(result);
      setDraftOpen(false);
      setDraftPrompt('');
      openWorkspace();
    } catch (err) {
      pushToast(err instanceof Error ? err.message : t('common.error'), 'error');
    } finally {
      setDrafting(false);
    }
  };

  const analysisStartedAt = useChatStore((s) => s.analysisStartedAt);
  const cancelAnalysis = useChatStore((s) => s.cancelAnalysis);

  const analyze = (file: { name: string; size: string }, rawFile?: File, opts?: { uploadId?: string; photos?: File[] }) => {
    // Новый договор — новый чат в боковой панели. Создаёт его и привязывает
    // к нему анализ сам стор (newSession): раньше чат создавался здесь
    // параллельно с анализом, и разбор нового договора мог прицепиться к
    // чату, открытому в момент загрузки.
    void startAnalysis(file, rawFile, { ...opts, newSession: true });
  };

  // Адрес страницы следует за чатом нового договора: иначе после обновления
  // открывался прежний чат (а в панели подсвечивался не тот). Чат, открытый
  // по ссылке, сюда не попадает — его загружает loadSession по адресу.
  const urlSyncedOnce = useRef(false);
  useEffect(() => {
    const firstRun = !urlSyncedOnce.current;
    urlSyncedOnce.current = true;
    if (!serverSessionId || serverSessionId === sessionId) return;
    if (firstRun && sessionId) return;
    navigate(`/chat/${serverSessionId}`, { replace: true, state: { keepPage: true } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverSessionId]);

  // ── Прикреплённые файлы ─────────────────────────────────────────────────
  // Файл больше не запускает разбор сразу: он ложится карточкой в поле ввода
  // и грузится на сервер в фоне. С вопросом — ИИ отвечает по файлам; один
  // договор без текста — полный разбор рисков, как раньше.
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
  const attachSeq = useRef(0);
  const maxFiles = maxAttachments(limits?.plan);
  // Другой чат — свои вложения: карточки не переезжают в чужую переписку.
  useEffect(() => {
    setAttachments([]);
  }, [sessionId]);

  const limitToast = () =>
    pushToast(isFree || !limits ? t('chat.attach.limitFree', { max: maxFiles }) : t('chat.attach.limit', { max: maxFiles }), 'error');

  /** Карточка сразу, загрузка — в фоне; ошибка — красная карточка и тост с причиной. */
  const addAttachment = (meta: { name: string; size: string }, upload: () => Promise<UploadedFile>) => {
    const key = `att_${++attachSeq.current}`;
    setAttachments((list) => [...list, { key, name: meta.name, size: meta.size, status: 'uploading' }]);
    upload()
      .then((up) =>
        setAttachments((list) =>
          list.map((a) => (a.key === key ? { ...a, status: 'ready', uploadId: up.id, name: up.fileName, size: up.fileSize } : a)),
        ),
      )
      .catch((err: unknown) => {
        const reason =
          err instanceof ApiError && err.status >= 400 && err.status < 500 ? apiErrorMessage(err, t) : t('chat.uploadFailed');
        pushToast(reason, 'error');
        setAttachments((list) => list.map((a) => (a.key === key ? { ...a, status: 'error' } : a)));
      });
  };

  const removeAttachment = (key: string) => setAttachments((list) => list.filter((a) => a.key !== key));

  /** Выбор из окна, перетаскивание или вставка: документы ЛИБО фото страниц
   *  одного договора (фото склеиваются в один PDF и занимают одно место). */
  const handleFiles = (files: File[]) => {
    const room = maxFiles - attachments.length;
    if (room <= 0) {
      limitToast();
      return;
    }
    const photos = files.filter(isPhoto);
    if (photos.length && photos.length < files.length) {
      pushToast(t('chat.mixedFiles'), 'error');
      return;
    }
    if (photos.length) {
      // Тариф без «Фото и сканов» — честный отказ сразу, без загрузки снимков.
      // Флаг считает сервер по тарифу анализа (у участника команды — владельца).
      if (limits?.features?.scans === false) {
        pushToast(t('limits.featureLocked', { feature: t('feat.scans'), plans: plansLabel('scans'), plan: limits.plan }), 'error');
        return;
      }
      if (photos.length > MAX_PHOTOS) {
        pushToast(t('chat.tooManyPhotos', { max: MAX_PHOTOS }), 'error');
        return;
      }
      if (photos.some((p) => p.size > MAX_PHOTO_BYTES)) {
        pushToast(t('chat.photoTooBig'), 'error');
        return;
      }
      // Порядок страниц — по имени снимка (IMG_0001, IMG_0002… — порядок съёмки);
      // одинаковые имена (iOS отдаёт «image.jpg») сохраняют порядок выбора.
      const ordered = [...photos].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
      const name = photoDocName(t('chat.photoDocName'));
      addAttachment({ name, size: t('chat.photoCount', { n: ordered.length }) }, () => uploadsApi.uploadPhotos(ordered, name));
      return;
    }
    if (files.some((f) => !isAttachFile(f.name))) {
      pushToast(t('chat.fileTypes'), 'error');
      return;
    }
    if (files.some((f) => f.size > MAX_DOC_BYTES)) {
      pushToast(t('chat.fileTooBig'), 'error');
      return;
    }
    if (files.length > room) limitToast();
    for (const file of files.slice(0, room)) {
      // Pass the file itself so its text reaches the AI (POST /uploads).
      addAttachment({ name: file.name, size: formatFileSize(file.size) }, () => uploadsApi.upload(file));
    }
  };

  /** Полный разбор рисков прикреплённого договора (файл уже на сервере). */
  const analyzeAttachment = (a: ComposerAttachment) => {
    if (!a.uploadId) return;
    setAttachments([]);
    analyze({ name: a.name, size: a.size }, undefined, { uploadId: a.uploadId });
  };

  /** /analyze: разбор рисков — ровно для одного прикреплённого договора. */
  const onAnalyzeCommand = () => {
    if (attachments.some((a) => a.status === 'uploading')) return pushToast(t('chat.attach.wait'), 'default');
    const [only] = attachments;
    if (attachments.length === 1 && only.status === 'ready' && isDocFile(only.name)) return analyzeAttachment(only);
    pushToast(attachments.length ? t('chat.attach.analyzeOne') : t('chat.attachFirst'), 'default');
  };

  /** Отправка из поля ввода. false — не принято, текст остаётся в поле. */
  const onComposerSend = (raw: string): boolean => {
    const text = raw.trim();
    const lower = text.toLowerCase();
    if (lower.startsWith('/compare')) {
      navigate('/compare');
      return true;
    }
    if (lower.startsWith('/draft')) {
      void runDraft(text.replace(/^\/draft\s*/i, ''));
      return true;
    }
    if (attachments.some((a) => a.status === 'uploading')) {
      pushToast(t('chat.attach.wait'), 'default');
      return false;
    }
    if (attachments.some((a) => a.status === 'error')) {
      pushToast(t('chat.attach.removeFailed'), 'error');
      return false;
    }
    if (!text) {
      // Один договор без вопроса — привычный полный разбор рисков.
      const [only] = attachments;
      if (attachments.length === 1 && isDocFile(only.name)) {
        analyzeAttachment(only);
        return true;
      }
      pushToast(t('chat.attach.askWhat'), 'default');
      return false;
    }
    const files = attachments.flatMap((a) => (a.uploadId ? [{ uploadId: a.uploadId, name: a.name, size: a.size }] : []));
    setAttachments([]);
    sendMessage(text, files);
    return true;
  };

  const composerPlaceholder =
    attachments.length === 0
      ? undefined
      : attachments.length > 1
        ? t('chat.attach.placeholderMany')
        : isDocFile(attachments[0].name)
          ? t('chat.attach.placeholderOne')
          : t('chat.attach.placeholderFile');

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const files = Array.from(e.dataTransfer.files ?? []);
    if (files.length) handleFiles(files);
  };

  const onDragOver = (e: DragEvent) => {
    e.preventDefault();
    if (!dragging) setDragging(true);
  };

  // Пузырёк файла — того договора, чей разбор показан: в чате с двумя
  // разборами раньше брался ПЕРВЫЙ файл, а карточка — ПОСЛЕДНЕГО разбора.
  const analysisAt = analysis ? messages.findIndex((m) => m.kind === 'analysis' && m.analysisId === analysis.id) : -1;
  const fileMessage =
    (analysisAt > 0 ? messages.slice(0, analysisAt).reverse().find((m) => m.kind === 'file') : undefined) ??
    [...messages].reverse().find((m) => m.kind === 'file');
  const textMessages = messages.filter((m) => m.kind === 'text');

  // Пустой канвас: ни сообщений, ни идущего анализа, ни загрузки сессии.
  // Только здесь показывается декоративный фон «строк договора» — в живой
  // переписке он убран (решение пользователя; страница диалога чистая).
  const emptyCanvas =
    messages.length === 0 &&
    (phase === 'idle' || phase === 'analyzed') &&
    !sessionLoading &&
    !sessionLoadFailed;

  // Welcome-экран (эталон empty state): композер стоит посреди экрана между
  // подзаголовком и карточками; после первого сообщения motion layoutId
  // плавно увозит его в нижний док. Условие повторяет ветку рендера ниже.
  const onWelcome = emptyCanvas;

  const composerEl = (
    <ChatInput
      bare
      hideDisclaimer={onWelcome}
      onAnalyze={onAnalyzeCommand}
      onFiles={(files) => handleFiles(files)}
      onCloudImport={() => setCloudOpen(true)}
      jurisdiction={<CountrySelector variant="composer" />}
      attachments={attachments}
      onRemoveAttachment={removeAttachment}
      placeholder={composerPlaceholder}
      onSend={onComposerSend}
      banner={
        nearLimit && limits?.aiRequests?.limit ? (
          // ≥80% месячного лимита: конкретная шкала вместо общего апселла —
          // человек должен узнать о потолке ДО обидного отказа 402.
          <div className={chat.upsellBar}>
            <span className={chat.upsellText}>
              <Icon name="alert" size={14} color="var(--accent)" />
              {t('chat.usage.nearLimit', { used: limits.aiRequests.used, limit: limits.aiRequests.limit })}
            </span>
            <button type="button" className={chat.upsellBtn} onClick={() => navigate('/plans')}>
              {t('chat.upsell.cta')}
            </button>
          </div>
        ) : isFree ? (
          <div className={chat.upsellBar}>
            <span className={chat.upsellText}>
              <Icon name="sparkle" size={14} color="var(--accent)" />
              {t('chat.upsell.title')}
            </span>
            <button type="button" className={chat.upsellBtn} onClick={() => navigate('/plans')}>
              {t('chat.upsell.cta')}
            </button>
          </div>
        ) : null
      }
    />
  );

  // ── Боковая панель (документ / таблица / презентация) ─────────────────────
  const [panel, setPanelState] = useState<Artifact | null>(null);
  // Открытие и закрытие панели меняет ширину чата: текст переносится иначе, и
  // всё, что было на экране, уезжало. Перед сменой запоминаем опору — карточку,
  // по которой нажали (или верхнее сообщение на экране), — и после перестройки
  // возвращаем её на то же место. Был внизу чата — остаёшься внизу.
  const lastPointer = useRef<Element | null>(null);
  /** Карточка, из которой открыта панель: при закрытии остаётся на месте она же. */
  const openedFrom = useRef<Element | null>(null);
  const scrollAnchor = useRef<{ el: Element; top: number } | 'bottom' | null>(null);
  const setPanel = useCallback((next: Artifact | null) => {
    const th = threadRef.current;
    scrollAnchor.current = null;
    if (th) {
      const thRect = th.getBoundingClientRect();
      const thTop = thRect.top;
      const pressed = lastPointer.current?.isConnected
        ? lastPointer.current.closest(`.${chat.artCard}, .${chat.deckCard}`)
        : null;
      lastPointer.current = null;
      // Закрытие: та карточка, из которой открывали, — если она ещё на экране.
      const source = !next && openedFrom.current?.isConnected ? openedFrom.current : null;
      const sourceVisible = source
        ? source.getBoundingClientRect().bottom > thTop && source.getBoundingClientRect().top < thRect.bottom
        : false;
      const clicked = pressed ?? (sourceVisible ? source : null);
      openedFrom.current = next ? pressed : null;
      const atBottom = th.scrollHeight - th.scrollTop - th.clientHeight < 40;
      if (clicked && th.contains(clicked)) {
        scrollAnchor.current = { el: clicked, top: clicked.getBoundingClientRect().top - thTop };
      } else if (atBottom) {
        scrollAnchor.current = 'bottom';
      } else {
        const first = [...th.querySelectorAll('[data-mid]')].find((el) => el.getBoundingClientRect().bottom > thTop);
        if (first) scrollAnchor.current = { el: first, top: first.getBoundingClientRect().top - thTop };
      }
    }
    setPanelState(next);
  }, []);
  useLayoutEffect(() => {
    const anchor = scrollAnchor.current;
    const th = threadRef.current;
    scrollAnchor.current = null;
    if (!anchor || !th) return;
    if (anchor === 'bottom') {
      th.scrollTop = th.scrollHeight;
    } else if (anchor.el.isConnected) {
      th.scrollTop += anchor.el.getBoundingClientRect().top - th.getBoundingClientRect().top - anchor.top;
    }
  }, [panel]);
  const openArtifact = useCallback((a: Artifact) => setPanel(a), [setPanel]);
  // Смена чата закрывает панель: артефакт принадлежит своей переписке.
  useEffect(() => {
    setPanelState(null);
  }, [sessionId, serverSessionId]);
  // Автооткрытие, как в Claude: свежий ответ ИИ (только что дописан в этой
  // вкладке) с презентацией, документом или большой таблицей. Старые чаты из
  // истории панель сами не открывают — у них нет перехода «писал → дописал».
  const wasStreaming = useRef(false);
  useEffect(() => {
    const streaming = messages.some((m) => m.streaming);
    if (wasStreaming.current && !streaming) {
      const texts = messages.filter((m) => m.kind === 'text');
      const last = texts[texts.length - 1];
      const prev = texts[texts.length - 2];
      if (last?.role === 'assistant' && last.text) {
        const deck = prev?.role === 'user' && isSlidesCommand(prev.text) ? parseDeck(last.text) : null;
        if (deck) {
          setPanel({ kind: 'deck', key: `${last.id}:deck`, title: deck.title, deck });
        } else {
          const [first] = extractArtifacts(extractQuestions(last.text).body, last.id, {
            document: t('artifact.document'),
            table: t('artifact.table'),
          });
          if (first) setPanel(first);
        }
      }
    }
    wasStreaming.current = streaming;
  }, [messages, t, setPanel]);

  // ── Карточки над полем ввода ─────────────────────────────────────────────
  // Только для последнего ответа ИИ: уточняющие вопросы (если он их задал),
  // иначе — «Продолжить с этим планом?» после ответа на /plan.
  const [dismissedAsk, setDismissedAsk] = useState<string | null>(null);
  const [dismissedPlan, setDismissedPlan] = useState<string | null>(null);
  const lastText = textMessages[textMessages.length - 1];
  const lastReply =
    lastText?.role === 'assistant' &&
    !lastText.streaming &&
    lastText.text &&
    messages[messages.length - 1]?.id === lastText.id &&
    phase !== 'analyzing'
      ? lastText
      : null;
  const lastParts = lastReply ? extractQuestions(lastReply.text ?? '') : null;
  const prevUser = textMessages[textMessages.length - 2];
  const lastFromPlan = Boolean(lastReply && prevUser?.role === 'user' && isPlanCommand(prevUser.text));
  const askQuestions =
    lastReply && lastParts && lastParts.questions.length > 0 && dismissedAsk !== lastReply.id ? lastParts.questions : null;
  const showPlanCard = Boolean(
    !askQuestions && lastReply && lastFromPlan && lastParts && looksLikePlan(lastParts.body) && dismissedPlan !== lastReply.id,
  );

  const onQuestionsDone = (answered: { question: string; answer: string }[]) => {
    if (!lastReply) return;
    setDismissedAsk(lastReply.id);
    if (!answered.length) return; // всё пропущено — просто убираем карточку
    const text = answersMessage(t('clarify.answersHeader'), answered);
    // Вопросы к плану: ответы уходят в режиме плана — ИИ пересоберёт план.
    sendMessage(lastFromPlan ? `/plan ${text}` : text);
  };
  const onApprovePlan = () => {
    if (!lastReply) return;
    setDismissedPlan(lastReply.id);
    sendMessage(`/approve ${t('plan.approve.okMessage')}`);
  };
  const onChangePlan = (changes: string) => {
    if (!lastReply) return;
    setDismissedPlan(lastReply.id);
    sendMessage(`/plan ${t('plan.approve.changesPrefix')} ${changes}`);
  };

  const renderText = (m: ChatMessage, prev?: ChatMessage) => {
    // Ответ на /slides с колодой — карточка с миниатюрами и «Скачать .pptx»;
    // если ИИ ответил обычным текстом (попросил описать дело) — как обычно.
    const deck =
      m.role === 'assistant' && !m.streaming && m.text && prev?.role === 'user' && isSlidesCommand(prev.text)
        ? parseDeck(m.text)
        : null;
    // Блок вопросов ИИ в тексте не показываем: у последнего ответа вопросы —
    // в карточке над полем ввода, у прежних — обычным списком.
    const shown =
      m.role !== 'assistant' || !m.text
        ? (m.text ?? '')
        : m.streaming || (askQuestions && lastReply?.id === m.id)
          ? extractQuestions(m.text).body
          : displayText(m.text);
    return m.role === 'user' && isApproveCommand(m.text) ? (
      <div key={m.id} className={chat.msgApproved} data-mid={m.id}>
        <PlanApprovedPill text={(m.text ?? '').replace(/^\s*\/approve\s*/i, '')} />
      </div>
    ) : m.role === 'user' ? (
      <div key={m.id} className={chat.msgUser} data-mid={m.id}>
        {m.attachments?.length ? <MessageFiles files={m.attachments} /> : null}
        <UserBubble text={m.text ?? ''} />
      </div>
    ) : m.streaming && !shown ? (
      // Ждём первое слово: вместо трёх точек — ход работы («Работаю…» и шаги
      // с сервера). Ответ, восстановленный после перезагрузки, шагов не знает —
      // тогда одна строка «Работаю…».
      <div key={m.id} className={chat.msgAssistant}>
        <Avatar size={30} />
        <WorkSteps work={m.work} working />
      </div>
    ) : (
      <div key={m.id} className={chat.msgAssistant}>
        <Avatar size={30} />
        <div className={chat.msgAssistantBody}>
          {m.work?.steps.length ? <WorkSteps work={m.work} working={false} /> : null}
          {deck ? (
            <DeckCard
              deck={deck}
              onOpen={() => openArtifact({ kind: 'deck', key: `${m.id}:deck`, title: deck.title, deck })}
            />
          ) : (
            shown.trim() ? (
              <div className={`${chat.msgAssistantText} ${chat.textIn}`}>
                <MarkdownMessage text={shown} messageId={m.id} onOpenArtifact={openArtifact} />
              </div>
            ) : null
          )}
          {!m.streaming && shown.trim() ? (
            <MessageActions message={{ ...m, text: displayText(m.text ?? '') }} onFeedback={setFeedback} />
          ) : null}
        </div>
      </div>
    );
  };

  return (
    <div className={chat.chatSplit}>
    <div
      className={chat.canvas}
      onDragOver={onDragOver}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragging(false);
      }}
      onDrop={onDrop}
      style={{ position: 'relative' }}
    >
      <TopBar
        title={<BrandMenu />}
        right={<TopBarActions hideCountry />}
      />

      {sessionLoading && messages.length === 0 ? (
        // Opening a saved chat: instant skeleton while the messages load —
        // the click must never look like nothing happened.
        <div className={`${chat.thread} scroll`}>
          <div className={chat.threadInner} style={{ paddingTop: 18 }}>
            <SkeletonRows rows={4} height={52} />
          </div>
        </div>
      ) : sessionLoadFailed && messages.length === 0 ? (
        // Сеть моргнула при открытии сохранённого чата: честная ошибка с
        // «повторить» вместо пустого приветствия, маскирующего живой чат.
        <div className={`${chat.thread} scroll`}>
          <div className={chat.threadInner} style={{ paddingTop: 18 }}>
            <ErrorState message={t('chat.loadFailed')} onRetry={() => sessionId && void loadSession(sessionId)} />
          </div>
        </div>
      ) : messages.length === 0 && (phase === 'idle' || phase === 'analyzed') ? (
        // «analyzed» без сообщений — канвас живёт в воркспейсе (сохранённый черновик
        // через adoptDraft): в чате показываем приветствие, а не пустой экран.
        <WelcomeScreen
          composer={
            // Эталонный вход композера (y:18, delay .24); layoutId связывает
            // его с нижним доком — при первом сообщении он уезжает на место.
            <motion.div
              layoutId="composer"
              layout="position"
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              // Задержка — только у первого появления; сдвиг поля, когда оно
              // выросло (файл, новая строка), идёт сразу и коротко.
              transition={{ duration: 0.55, ease: EASE, delay: 0.24, layout: { duration: 0.3, ease: EASE } }}
              className={chat.welcomeComposer}
            >
              {composerEl}
            </motion.div>
          }
        />
      ) : (
        <div
          className={`${chat.thread} scroll`}
          ref={attachThread}
          onScroll={onThreadScroll}
          onPointerDownCapture={(e) => {
            lastPointer.current = e.target as Element;
          }}
        >
          <div className={chat.threadInner} style={{ paddingBottom: tailPad }}>
            {fileMessage?.file ? (
              <div data-mid={fileMessage.id}>
                <UserFileBubble name={fileMessage.file.name} size={fileMessage.file.size} />
              </div>
            ) : null}

            {fileMessage || phase === 'analyzing' || phase === 'error' ? (
              <div className={chat.aiRow}>
                <Avatar size={30} />
                <div className={chat.aiBody}>
                  {phase === 'error' ? (
                    <ErrorState
                      message={error ?? t('common.error')}
                      // Неудачный анализ удаляет свой пустой чат — повтор заводит новый.
                      onRetry={() => fileMessage?.file && void startAnalysis(fileMessage.file, undefined, { newSession: !serverSessionId })}
                    />
                  ) : (
                    <>
                      <AnalysisCard
                        steps={steps}
                        activeStep={activeStep}
                        done={phase === 'analyzed'}
                        startedAt={analysisStartedAt}
                        onCancel={cancelAnalysis}
                      />
                      {phase === 'analyzed' && analysis ? (
                        <SummaryCard
                          analysis={analysis}
                          onOpenWorkspace={openWorkspace}
                          onOpenFinding={(redlineId) => {
                            requestAnchor(redlineId);
                            openWorkspace();
                          }}
                          onAsk={(q) => sendMessage(q)}
                          onAskCustom={() =>
                            document.querySelector<HTMLTextAreaElement>('textarea[data-chat-input]')?.focus()
                          }
                        />
                      ) : null}
                    </>
                  )}
                </div>
              </div>
            ) : null}

            {textMessages.map((m, i) => renderText(m, textMessages[i - 1]))}
          </div>
        </div>
      )}

      {onWelcome ? null : (
        // Нижний док композера. Обёртка layoutId без initial — при смене
        // welcome → диалог motion сам ведёт FLIP из середины экрана вниз
        // (эталон: transition 0.5s EASE на layoutId="composer").
        <div className={chat.composer}>
          {/* Скрытая кнопка остаётся в DOM (visibility: hidden — вне фокуса и
              диктора), чтобы появление и исчезновение шли плавно. */}
          <button
            type="button"
            className={`${chat.jumpBtn} ${showJump ? chat.jumpBtnOn : ''}`}
            onClick={jumpToBottom}
            aria-label={t('chat.scrollDown')}
            title={t('chat.scrollDown')}
          >
            <Icon name="arrowDown" size={18} strokeWidth={2} />
          </button>
          {/* Пока ИИ ждёт решения (вопросы / одобрение плана), карточка стоит
              на месте поля ввода; после выбора или Esc поле возвращается
              (черновик сохраняется). */}
          {askQuestions && lastReply ? (
            <div className={chat.dockSlide}>
              <QuestionCard key={lastReply.id} questions={askQuestions} onDone={onQuestionsDone} />
            </div>
          ) : showPlanCard && lastReply ? (
            <div className={chat.dockSlide}>
              <PlanApprovalCard
                key={lastReply.id}
                onApprove={onApprovePlan}
                onChanges={onChangePlan}
                onDismiss={() => setDismissedPlan(lastReply.id)}
              />
            </div>
          ) : (
            // layout="position": переезд — только сдвиг. Без этого motion
            // анимировал и РАЗМЕР — растяжением (scale): при появлении карточки
            // файла или новой строки текста поле на полсекунды сплющивалось.
            // layoutDependency (постоянный): в доке поле растёт вверх сразу,
            // анимируется только сам переезд из середины экрана при появлении.
            <motion.div
              layoutId="composer"
              layout="position"
              layoutDependency="dock"
              transition={{ duration: 0.5, ease: EASE }}
              className={chat.dockSlide}
            >
              {composerEl}
            </motion.div>
          )}
        </div>
      )}

      <Modal
        open={draftOpen}
        title={t('chat.draft.title')}
        onClose={() => {
          if (!drafting) setDraftOpen(false);
        }}
        footer={
          <>
            <Button variant="secondary" onClick={() => setDraftOpen(false)} disabled={drafting}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="primary"
              icon="pen"
              onClick={() => void runDraft(draftPrompt)}
              disabled={drafting || !draftPrompt.trim()}
            >
              {drafting ? t('chat.draft.generating') : t('chat.draft.generate')}
            </Button>
          </>
        }
      >
        {drafting ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, padding: '24px 0' }}>
            <ScalesMascot size={96} />
            <div style={{ color: 'var(--dim)', fontSize: 14 }}>{t('chat.draft.generating')}</div>
          </div>
        ) : (
          <>
            <textarea
              value={draftPrompt}
              onChange={(e) => setDraftPrompt(e.target.value)}
              placeholder={t('chat.draft.placeholder')}
              rows={4}
              autoFocus
              style={{
                width: '100%',
                resize: 'vertical',
                minHeight: 96,
                padding: '12px 14px',
                borderRadius: 'var(--r-md)',
                border: '1px solid var(--border)',
                background: 'var(--panel-2)',
                color: 'var(--text)',
                font: 'inherit',
                fontSize: 15,
                lineHeight: 1.5,
                outline: 'none',
              }}
            />
            <p style={{ marginTop: 10, fontSize: 13, color: 'var(--mut)', lineHeight: 1.5 }}>{t('chat.draft.hint')}</p>
          </>
        )}
      </Modal>

      <CloudImportModal
        open={cloudOpen}
        onClose={() => setCloudOpen(false)}
        // Файл уже лежит на сервере — карточка сразу готова (по id загрузки,
        // а не по совпадению имени), без повторной отправки.
        onImported={(file) => {
          if (attachments.length >= maxFiles) return limitToast();
          setAttachments((list) => [
            ...list,
            { key: `att_${++attachSeq.current}`, name: file.name, size: file.size, status: 'ready', uploadId: file.uploadId },
          ]);
        }}
      />

      {dragging ? (
        <div className={chat.dropOverlay}>
          <div className={chat.dropInner}>
            <Icon name="upload" size={34} />
            {t('chat.dropHere')}
          </div>
        </div>
      ) : null}
    </div>
    {/* Progress / Context — в переписке; открытый документ занимает его место. */}
    {!panel && !onWelcome && messages.length > 0 ? (
      <TaskSidebar messages={messages} sessionKey={serverSessionId ?? (USE_MOCK ? 'local' : null)} onOpenArtifact={openArtifact} />
    ) : null}
    {panel ? <ArtifactPanel artifact={panel} onClose={() => setPanel(null)} /> : null}
    </div>
  );
}
