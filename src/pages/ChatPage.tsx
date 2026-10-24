import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { motion } from 'motion/react';
import { EASE } from '@/lib/motion';
import { TopBar } from '@/components/layout/TopBar';
import { TopBarActions } from '@/components/layout/TopBarActions';
import { CountrySelector } from '@/components/layout/CountrySelector';
import { BrandMenu } from '@/components/layout/BrandMenu';
import { Icon } from '@/components/icons/Icon';
import { WelcomeScreen } from '@/components/chat/WelcomeScreen';
import { UserFileBubble } from '@/components/chat/UserFileBubble';
import { AnalysisCard } from '@/components/chat/AnalysisCard';
import { SummaryCard } from '@/components/chat/SummaryCard';
import { ChatInput } from '@/components/chat/ChatInput';
import { CloudImportModal } from '@/components/chat/CloudImportModal';
import { MessageActions } from '@/components/chat/MessageActions';
import { MarkdownMessage } from '@/components/chat/MarkdownMessage';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { ScalesMascot } from '@/components/ui/ScalesMascot';
import { Modal } from '@/components/ui/Modal';
import { ErrorState, SkeletonRows } from '@/components/ui/States';
import { billingApi } from '@/api/billing.api';
import { analysisApi } from '@/api/analysis.api';
import { useAsync } from '@/hooks/useAsync';
import { useChatStore } from '@/store/useChatStore';
import { useUIStore } from '@/store/useUIStore';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useI18n } from '@/i18n/I18nProvider';
import { formatFileSize } from '@/lib/format';
import { isDocFile, MAX_DOC_BYTES } from '@/lib/docFormats';
import { plansLabel } from '@/lib/planFeatures';
import { MAX_PHOTO_BYTES, MAX_PHOTOS } from '@/api/uploads.api';
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

// Декоративный фон «строк договора» (эталон app/page.tsx): тонкие полосы 2px
// с процентными ширинами, часть — золотые. Числа = ширина в %, 'gap' — пропуск
// строки (пустая «строка абзаца»).
type BackdropLine = number | { w: number; gold: true } | 'gap';
const TOP_LINES: BackdropLine[] = [62, 88, 74, 92, { w: 58, gold: true }, 81, 69, 90, 44, 'gap', 84, 71, 93, 52];
const BOTTOM_LINES: BackdropLine[] = [76, 91, 60, 86, 70, 'gap', 89, { w: 66, gold: true }, 94, 78, 55, 83, 47];

function ContractLines({ items }: { items: BackdropLine[] }) {
  return (
    <>
      {items.map((it, i) =>
        it === 'gap' ? (
          <div key={i} className={chat.backdropGap} />
        ) : (
          <div
            key={i}
            className={`${chat.backdropLine} ${typeof it === 'object' ? chat.backdropLineGold : ''}`}
            style={{ width: `${typeof it === 'number' ? it : it.w}%` }}
          />
        ),
      )}
    </>
  );
}

/** Чисто декоративный фон чата: «строки договора» по углам канваса. */
function ContractBackdrop() {
  return (
    <div aria-hidden className={chat.backdrop}>
      <div className={chat.backdropCol}>
        <ContractLines items={TOP_LINES} />
      </div>
      <div className={`${chat.backdropCol} ${chat.backdropColEnd}`}>
        <ContractLines items={BOTTOM_LINES} />
      </div>
    </div>
  );
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
function UserBubble({ text }: { text: string }) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const long = text.length > 550 || text.split('\n').length > 8;
  if (!long) return <div className={`${chat.msgUserBubble} ${chat.textIn}`}>{text}</div>;
  return (
    <div className={`${chat.msgUserBubble} ${chat.textIn}`}>
      <div className={expanded ? undefined : chat.bubbleClampText}>{text}</div>
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
  const ghost = useChatStore((s) => s.ghost);
  const enterGhost = useChatStore((s) => s.enterGhost);
  const exitGhost = useChatStore((s) => s.exitGhost);
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
  const [ghostConfirm, setGhostConfirm] = useState(false);
  const [draftOpen, setDraftOpen] = useState(false);
  const [draftPrompt, setDraftPrompt] = useState('');
  const [drafting, setDrafting] = useState(false);

  // The Free-plan upsell above the composer (hidden on every paid plan).
  const { data: limits } = useAsync((signal) => billingApi.limits(signal), []);
  const isFree = limits?.plan === 'Free';
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
    if (!serverSessionId || serverSessionId === sessionId || ghost) return;
    if (firstRun && sessionId) return;
    navigate(`/chat/${serverSessionId}`, { replace: true, state: { keepPage: true } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverSessionId]);

  const handleFile = (file: File) => {
    if (ghost) {
      pushToast(t('ghost.noFiles'), 'default');
      return;
    }
    if (!isDocFile(file.name)) {
      pushToast(t('chat.fileTypes'), 'error');
      return;
    }
    if (file.size > MAX_DOC_BYTES) {
      pushToast(t('chat.fileTooBig'), 'error');
      return;
    }
    // Pass the file itself so its text reaches the AI (POST /uploads).
    analyze({ name: file.name, size: formatFileSize(file.size) }, file);
  };

  /** Выбор из окна или перетаскивание: один документ ЛИБО фото страниц. */
  const handleFiles = (files: File[]) => {
    if (ghost) {
      pushToast(t('ghost.noFiles'), 'default');
      return;
    }
    const photos = files.filter(isPhoto);
    if (!photos.length) {
      if (files.length > 1) pushToast(t('chat.oneDoc'), 'error');
      else handleFile(files[0]);
      return;
    }
    if (photos.length < files.length) {
      pushToast(t('chat.mixedFiles'), 'error');
      return;
    }
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
    analyze(
      { name: photoDocName(t('chat.photoDocName')), size: t('chat.photoCount', { n: ordered.length }) },
      undefined,
      { photos: ordered },
    );
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const files = Array.from(e.dataTransfer.files ?? []);
    if (files.length) handleFiles(files);
  };

  const onDragOver = (e: DragEvent) => {
    e.preventDefault();
    if (!dragging && !ghost) setDragging(true);
  };

  const onExitGhost = () => {
    exitGhost();
    pushToast(t('ghost.left'), 'default');
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
  const onWelcome = emptyCanvas && !ghost;

  const composerEl = (
    <ChatInput
      key={ghost ? 'ghost' : 'chat'}
      bare
      hideDisclaimer={onWelcome}
      ephemeral={ghost}
      onAnalyze={() => pushToast(ghost ? t('ghost.noFiles') : t('chat.attachFirst'), 'default')}
      onFiles={ghost ? undefined : (files) => handleFiles(files)}
      onCloudImport={ghost ? undefined : () => setCloudOpen(true)}
      jurisdiction={<CountrySelector variant="composer" />}
      onSend={(text) => {
        const lower = text.trim().toLowerCase();
        if (lower.startsWith('/compare')) return navigate('/compare');
        if (lower.startsWith('/draft')) return void runDraft(text.trim().replace(/^\/draft\s*/i, ''));
        return sendMessage(text);
      }}
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

  const renderText = (m: ChatMessage) =>
    m.role === 'user' ? (
      <div key={m.id} className={chat.msgUser} data-mid={m.id}>
        <UserBubble text={m.text ?? ''} />
      </div>
    ) : m.streaming && !m.text ? (
      // Waiting for the first token: индикатор набора эталона — панель с
      // тремя пульсирующими точками рядом с логотипом (текст — для читалок).
      <div key={m.id} className={chat.msgAssistant}>
        <Avatar size={30} />
        <div className={chat.typingBubble} role="status" aria-label={t('chat.thinking')}>
          <span className={chat.typingDot} />
          <span className={chat.typingDot} />
          <span className={chat.typingDot} />
        </div>
      </div>
    ) : (
      <div key={m.id} className={chat.msgAssistant}>
        <Avatar size={30} />
        <div className={chat.msgAssistantBody}>
          <div className={`${chat.msgAssistantText} ${chat.textIn}`}>
            <MarkdownMessage text={m.text ?? ''} />
          </div>
          {!m.streaming && m.text ? <MessageActions message={m} onFeedback={setFeedback} /> : null}
        </div>
      </div>
    );

  return (
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
        title={ghost ? t('ghost.enter') : <BrandMenu />}
        right={
          <div className={chat.topRight}>
            <button
              type="button"
              className={`${chat.ghostToggle} ${ghost ? chat.ghostToggleOn : ''}`}
              aria-label={t('ghost.enter')}
              aria-pressed={ghost}
              title={t('ghost.enter')}
              disabled={phase === 'analyzing'}
              onClick={() => (ghost ? onExitGhost() : setGhostConfirm(true))}
            >
              <Icon name="ghost" size={18} />
            </button>
            <TopBarActions hideCountry />
          </div>
        }
      />

      {emptyCanvas ? <ContractBackdrop /> : null}

      {ghost ? (
        <div className={chat.ghostBanner} role="status">
          <Icon name="ghost" size={15} />
          <span className={chat.ghostBannerText}>{t('ghost.active')}</span>
          <button type="button" className={chat.ghostExitBtn} onClick={onExitGhost}>
            {t('ghost.exit')}
          </button>
        </div>
      ) : null}

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
        // «analyzed» без сообщений — канвас живёт в воркспейсе (черновик шаблона
        // через adoptDraft): в чате показываем приветствие, а не пустой экран.
        ghost ? (
          <div className={chat.ghostEmpty}>
            <div className={chat.ghostEmptyIcon}>
              <Icon name="ghost" size={26} />
            </div>
            <div className={chat.ghostEmptyTitle}>{t('ghost.enter')}</div>
            <p className={chat.ghostEmptyBody}>{t('ghost.warnBody')}</p>
          </div>
        ) : (
          <WelcomeScreen
            onAnalyze={() => pushToast(t('chat.attachFirst'), 'default')}
            onDraft={() => void runDraft('')}
            onCompare={() => navigate('/compare')}
            composer={
              // Эталонный вход композера (y:18, delay .24); layoutId связывает
              // его с нижним доком — при первом сообщении он уезжает на место.
              <motion.div
                layoutId="composer"
                initial={{ opacity: 0, y: 18 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.55, ease: EASE, delay: 0.24 }}
                className={chat.welcomeComposer}
              >
                {composerEl}
              </motion.div>
            }
          />
        )
      ) : (
        <div className={`${chat.thread} scroll`} ref={attachThread} onScroll={onThreadScroll}>
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

            {textMessages.map(renderText)}
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
          <motion.div layoutId="composer" transition={{ duration: 0.5, ease: EASE }} className={chat.dockSlide}>
            {composerEl}
          </motion.div>
        </div>
      )}

      <Modal
        open={ghostConfirm}
        title={t('ghost.warnTitle')}
        onClose={() => setGhostConfirm(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setGhostConfirm(false)}>
              {t('ghost.warnCancel')}
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                enterGhost();
                setGhostConfirm(false);
                // Leave the saved-session URL: a remount would reload that
                // session and silently kick the user out of ghost mode.
                if (sessionId) navigate('/chat');
              }}
            >
              {t('ghost.warnConfirm')}
            </Button>
          </>
        }
      >
        <p className={chat.ghostWarnBody}>{t('ghost.warnBody')}</p>
      </Modal>

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
        // Файл уже лежит на сервере — передаём его id, чтобы анализ пошёл
        // именно по нему (а не по совпадению имени) и без повторной отправки.
        onImported={(file) => analyze({ name: file.name, size: file.size }, undefined, { uploadId: file.uploadId })}
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
  );
}
