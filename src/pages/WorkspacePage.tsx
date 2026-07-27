import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Avatar } from '@/components/ui/Avatar';
import { toneColor } from '@/components/ui/Badge';
import { CitationLine } from '@/components/ui/VerifiedBadge';
import { Icon } from '@/components/icons/Icon';
import { Button, IconButton } from '@/components/ui/Button';
import { SkeletonRows } from '@/components/ui/States';
import { Spinner } from '@/components/ui/Spinner';
import { ChatInput } from '@/components/chat/ChatInput';
import { MarkdownMessage } from '@/components/chat/MarkdownMessage';
import { DocumentViewer, type ActiveBlock, type DocEditorHandle } from '@/components/workspace/DocumentViewer';
import { EditorToolbar } from '@/components/workspace/EditorToolbar';
import { FloatingToolbar } from '@/components/workspace/FloatingToolbar';
import { SendForSignatureModal } from '@/components/workspace/SendForSignatureModal';
import { VersionHistoryModal } from '@/components/workspace/VersionHistoryModal';
import { analysisApi, documentsApi, templatesApi, versionsApi } from '@/api';
import { shareApi } from '@/api/growth.api';
import { Modal } from '@/components/ui/Modal';
import { downloadBlob } from '@/lib/download';
import { formatFileSize } from '@/lib/format';
import { draftBlocksToText, useChatStore } from '@/store/useChatStore';
import { useChatHistoryStore } from '@/store/useChatHistoryStore';
import { useUIStore } from '@/store/useUIStore';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useI18n } from '@/i18n/I18nProvider';
import type { DocBlock } from '@/types/domain';
import styles from '@/components/workspace/workspace.module.css';

/** Пределы перетаскиваемой границы: чат нельзя схлопнуть или растянуть во весь
 *  экран — обе панели всегда остаются рабочими. */
const SPLIT_MIN = 26;
const SPLIT_MAX = 62;
const SPLIT_DEFAULT = 40;
const SPLIT_KEY = 'lexai.wsSplit';

/**
 * Split review workspace: chat/findings on the left (40%), the document viewer
 * with tracked-change redlines on the right (60%). The left input is a real
 * document Q&A — replies are grounded in the analysed contract. Paragraphs on
 * the right are click-to-edit (pencil icon) and persist to the server.
 */
export function WorkspacePage() {
  const navigate = useNavigate();
  const { sessionId } = useParams();
  const { t } = useI18n();

  const analysis = useChatStore((s) => s.analysis);
  const messages = useChatStore((s) => s.messages);
  const sendMessage = useChatStore((s) => s.sendMessage);
  const draftSource = useChatStore((s) => s.draftSource);
  const phase = useChatStore((s) => s.phase);
  const analysisError = useChatStore((s) => s.error);
  const startAnalysis = useChatStore((s) => s.startAnalysis);
  const setServerSession = useChatStore((s) => s.setServerSession);
  const addSession = useChatHistoryStore((s) => s.addSession);
  const acceptAll = useChatStore((s) => s.acceptAllRedlines);
  const revertRedlines = useChatStore((s) => s.revertRedlines);
  const updateDocument = useChatStore((s) => s.updateDocument);
  const updateDraftContent = useChatStore((s) => s.updateDraftContent);
  const reanalyze = useChatStore((s) => s.reanalyze);
  const showEdits = useChatStore((s) => s.showEdits);
  const toggleShowEdits = useChatStore((s) => s.toggleShowEdits);
  const undoDocument = useChatStore((s) => s.undoDocument);
  const redoDocument = useChatStore((s) => s.redoDocument);
  const canUndo = useChatStore((s) => s.docUndo.length > 0);
  const canRedo = useChatStore((s) => s.docRedo.length > 0);
  const pushToast = useUIStore((s) => s.pushToast);
  usePageTitle(analysis?.fileName || t('ws.review'));

  // The rich editor's imperative handle + which block is focused (toolbar state).
  const editorRef = useRef<DocEditorHandle>(null);
  const [activeBlock, setActiveBlock] = useState<ActiveBlock | null>(null);
  const [versionLabel, setVersionLabel] = useState<string | null>(null);

  const analysisReadOnly = () => useChatStore.getState().analysis?.canEdit === false;
  const [signOpen, setSignOpen] = useState(false);
  // Публичная ссылка на отчёт: модалка с URL + копирование + отзыв.
  const [shareOpen, setShareOpen] = useState(false);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [shareBusy, setShareBusy] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [reanalyzing, setReanalyzing] = useState(false);
  const [anchor, setAnchor] = useState<{ redlineId: string; nonce: number } | null>(null);
  // A pending anchor set from the chat SummaryCard (open workspace at a clause).
  const pendingAnchor = useChatStore((s) => s.pendingAnchor);
  const clearPendingAnchor = useChatStore((s) => s.clearPendingAnchor);
  useEffect(() => {
    if (pendingAnchor) {
      setAnchor({ redlineId: pendingAnchor, nonce: Date.now() });
      clearPendingAnchor();
    }
  }, [pendingAnchor, clearPendingAnchor]);

  // Драфт из «Моих шаблонов»: документ без анализа. Чат слева открыт сразу
  // (его можно свернуть в рейку); на мобильной раскладке панели всегда обе видны.
  const isDraft = Boolean(draftSource);
  const isMobile = useMediaQuery('(max-width: 900px)');
  const [chatOpen, setChatOpen] = useState(true);
  const chatVisible = chatOpen || isMobile;
  const analyzing = phase === 'analyzing';

  // Перетаскиваемая граница между чатом и документом (см. SPLIT_*):
  // курсор col-resize, кламп 26–62%, двойной клик — сброс, ширина запоминается.
  const containerRef = useRef<HTMLDivElement>(null);
  const [leftPct, setLeftPct] = useState(() => {
    const v = Number(localStorage.getItem(SPLIT_KEY));
    return Number.isFinite(v) && v >= SPLIT_MIN && v <= SPLIT_MAX ? v : SPLIT_DEFAULT;
  });
  const leftPctRef = useRef(leftPct);
  const [dragging, setDragging] = useState(false);
  const startSplitDrag = (e: ReactPointerEvent) => {
    if (isMobile) return;
    e.preventDefault();
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return;
    setDragging(true);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    const move = (ev: globalThis.PointerEvent) => {
      const pct = Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, ((ev.clientX - rect.left) / rect.width) * 100));
      leftPctRef.current = pct;
      setLeftPct(pct);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      setDragging(false);
      localStorage.setItem(SPLIT_KEY, String(Math.round(leftPctRef.current)));
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  const resetSplit = () => {
    leftPctRef.current = SPLIT_DEFAULT;
    setLeftPct(SPLIT_DEFAULT);
    localStorage.removeItem(SPLIT_KEY);
  };

  // The toolbar shows the latest version label (e.g. "v3 — current"). Best
  // effort: versions are a plan-gated feature, so a 402/empty just hides it.
  const analysisId = analysis?.id;
  useEffect(() => {
    if (!analysisId || analysisId.startsWith('draft_')) return;
    let cancelled = false;
    versionsApi
      .list(analysisId)
      .then((versions) => !cancelled && setVersionLabel(versions[0]?.label ?? null))
      .catch(() => !cancelled && setVersionLabel(null));
    return () => {
      cancelled = true;
    };
  }, [analysisId]);

  const runReanalysis = () => {
    if (analysisReadOnly()) {
      pushToast(t('ws.readOnly'), 'error');
      return;
    }
    if (reanalyzing) return;
    setReanalyzing(true);
    pushToast(t('ws.reanalyzing'), 'default');
    reanalyze()
      .then((r) => pushToast(t('ws.reanalyzed', { score: r.riskScore, n: r.redlines.length }), 'success'))
      .catch((err) => pushToast(err instanceof Error && err.message ? err.message : t('common.error'), 'error'))
      .finally(() => setReanalyzing(false));
  };

  // Драфт шаблона → настоящий анализ: открываем чат слева и гоняем текст через
  // обычный конвейер (загрузка файла → анализ). keepCanvas держит документ на
  // экране; по завершении стор заменит черновик готовым разбором с находками.
  const analyzeDraft = () => {
    const src = useChatStore.getState().draftSource;
    if (!src || analyzing) return;
    setChatOpen(true);
    const base = src.title.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120) || 'template';
    const name = `${base}.txt`;
    const file = new File([src.content], name, { type: 'text/plain' });
    void addSession(name).then((session) => {
      if (session) setServerSession(session.id);
    });
    void startAnalysis({ name, size: formatFileSize(file.size) }, file, { keepCanvas: true });
  };

  const downloadDraft = async () => {
    if (!draftSource) return;
    try {
      const blob = await templatesApi.exportDocx(draftSource.title, draftSource.content);
      downloadBlob(blob, `${draftSource.title.replace(/[^\wа-яА-ЯёЁ -]+/g, '').slice(0, 80) || 'contract'}.docx`);
    } catch (err) {
      pushToast(err instanceof Error && err.message ? err.message : t('common.error'), 'error');
    }
  };

  const copyDraft = async () => {
    if (!draftSource) return;
    try {
      await navigator.clipboard.writeText(draftSource.content);
      pushToast(t('tpl.copied'), 'success');
    } catch {
      pushToast(t('common.error'), 'error');
    }
  };

  // Правки черновика пишутся в САМ сохранённый шаблон (PATCH), не в анализ —
  // серверного анализа у драфта нет. draftSource.content держим в синхроне,
  // чтобы «Скачать», «Копировать» и «Анализ рисков» брали правленый текст.
  const syncDraftToServer = () => {
    const st = useChatStore.getState();
    const src = st.draftSource;
    const doc = st.analysis?.document;
    if (!src || !doc) return;
    const content = draftBlocksToText(doc);
    // Пустой текст не сохраняем: стереть шаблон целиком правкой нельзя.
    if (!content || content === src.content) return;
    updateDraftContent(content);
    templatesApi
      .updateSaved(src.savedTemplateId, { content })
      .then(() => pushToast(t('ws.saved'), 'success'))
      .catch(() => pushToast(t('common.error'), 'error'));
  };

  const persistDraft = (document: DocBlock[]) => {
    // Шаблон хранится как plain text, поэтому инлайн-форматирование сплющиваем
    // сразу при сохранении блока — на экране всегда ровно то, что в файле.
    updateDocument(
      document.map((b) => (b.type === 'heading' ? b : { ...b, segments: [draftBlocksToText([b])] })),
    );
    syncDraftToServer();
  };

  const undoDraft = () => {
    editorRef.current?.exitEdit(); // don't let a stale open editor re-save
    undoDocument();
    syncDraftToServer();
  };
  const redoDraft = () => {
    editorRef.current?.exitEdit();
    redoDocument();
    syncDraftToServer();
  };

  // No analysis here (refresh / direct link) — send the user to the chat
  // to upload their own document instead of showing any demo content.
  useEffect(() => {
    if (!analysis) {
      pushToast(t('ws.noAnalysisRedirect'), 'default');
      navigate(sessionId ? `/chat/${sessionId}` : '/chat', { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analysis]);

  if (!analysis) {
    return (
      <div style={{ padding: '28px 36px' }}>
        <SkeletonRows rows={7} height={52} />
      </div>
    );
  }

  const canEdit = analysis.canEdit !== false;

  const pendingCount = analysis.redlines.filter((r) => r.status === 'pending').length;
  const textMessages = messages.filter((m) => m.kind === 'text');

  // Из драфта шаблона «назад» ведёт в «Шаблоны», откуда он был открыт.
  const closeWorkspace = () => navigate(isDraft ? '/templates' : sessionId ? `/chat/${sessionId}` : '/chat');

  // Persist a document edit from the rich editor (blocks already assembled by
  // the viewer). updateDocument records an undo snapshot; the server stores it.
  const persistDocument = (document: DocBlock[]) => {
    if (isDraft) {
      persistDraft(document);
      return;
    }
    updateDocument(document);
    analysisApi
      .saveDocument(analysis.id, document)
      .then(() => pushToast(t('ws.saved'), 'success'))
      .catch(() => pushToast(t('common.error'), 'error'));
  };

  // Server-rendered DOCX: 'tracked' = real Word tracked changes (accept/reject
  // in Word), 'clean' = final text. Needs the owning document id.
  const openShare = async () => {
    if (!analysis || shareBusy) return;
    setShareOpen(true);
    setShareBusy(true);
    try {
      const link = await shareApi.create(analysis.id);
      setShareUrl(link.url);
    } catch (err) {
      setShareOpen(false);
      pushToast(err instanceof Error && err.message ? err.message : t('common.error'), 'error');
    } finally {
      setShareBusy(false);
    }
  };

  const revokeShare = async () => {
    if (!analysis || shareBusy) return;
    setShareBusy(true);
    try {
      await shareApi.revoke(analysis.id);
      setShareUrl(null);
      setShareOpen(false);
      pushToast(t('ws.shareRevoked'), 'default');
    } catch (err) {
      pushToast(err instanceof Error && err.message ? err.message : t('common.error'), 'error');
    } finally {
      setShareBusy(false);
    }
  };

  const downloadDocx = async (mode: 'tracked' | 'clean') => {
    if (!analysis.documentId) {
      pushToast(t('common.error'), 'error');
      return;
    }
    pushToast(t('ws.docxStarted'), 'success');
    try {
      const blob = await documentsApi.exportFile(analysis.documentId, 'docx', mode);
      downloadBlob(blob, `${analysis.fileName.replace(/\.[^.]+$/, '') || 'document'}.docx`);
    } catch (err) {
      pushToast(err instanceof Error && err.message ? err.message : t('common.error'), 'error');
    }
  };

  return (
    <div className={styles.workspace} ref={containerRef}>
      {/* Свёрнутый чат: узкая рейка-кнопка, чтобы всегда было видно, как вернуть. */}
      {!chatVisible ? (
        <button type="button" className={styles.chatRail} onClick={() => setChatOpen(true)} title={t('ws.openChat')}>
          <Icon name="chat" size={17} />
          <span className={styles.chatRailLabel}>{t('ws.openChat')}</span>
        </button>
      ) : null}

      {/* Left: review conversation + findings + document Q&A */}
      {chatVisible ? (
      <div className={styles.leftPane} style={!isMobile ? { width: `${leftPct}%` } : undefined}>
        <div className={styles.leftHeader}>
          <IconButton icon="back" label={t('ws.backToChat')} size="sm" iconSize={18} onClick={closeWorkspace} />
          <span className={styles.leftTitle}>{t('ws.review')}</span>
          <span style={{ marginLeft: 'auto' }}>
            <IconButton icon="sidebar" label={t('ws.hideChat')} size="sm" iconSize={16} onClick={() => setChatOpen(false)} />
          </span>
        </div>

        <div className={`${styles.leftBody} scroll`}>
          {analyzing ? (
            <div className={styles.draftProgress}>
              <Spinner size={16} />
              <span>{t('ws.analyzingDraft')}</span>
            </div>
          ) : null}
          {isDraft && phase === 'error' && analysisError ? (
            <div className={styles.draftError}>
              <span>{analysisError}</span>
              <Button size="sm" variant="primary" onClick={analyzeDraft}>
                {t('error.retry')}
              </Button>
            </div>
          ) : null}
          <div className={styles.reviewIntro}>
            <Avatar size={28} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <p className={styles.reviewIntroText}>
                {isDraft ? t('ws.draftIntro') : t('ws.intro', { n: analysis.redlines.length })}
              </p>
              <div className={styles.findingCards}>
                {analysis.findings.map((f) => {
                  // A finding with a matching redline is clickable → jump to the clause.
                  const clickable = Boolean(f.redlineId);
                  return (
                    <div
                      key={f.id}
                      className={`${styles.findingCard} ${clickable ? styles.findingCardClickable : ''}`}
                      {...(clickable
                        ? {
                            role: 'button',
                            tabIndex: 0,
                            title: t('ws.jumpToClause'),
                            onClick: () => setAnchor({ redlineId: f.redlineId as string, nonce: Date.now() }),
                            onKeyDown: (e: KeyboardEvent) => {
                              // Enter/Space вложенных кнопок (текст нормы, «Обсудить»)
                              // всплывают сюда — реагируем только на саму карточку.
                              if (e.target !== e.currentTarget) return;
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                setAnchor({ redlineId: f.redlineId as string, nonce: Date.now() });
                              }
                            },
                          }
                        : {})}
                    >
                      <span className={styles.findingCardDot} style={{ background: toneColor(f.severity) }} />
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div className={styles.findingCardTitle}>{f.title}</div>
                        <CitationLine finding={f} />
                      </div>
                      {/* «Обсудить в чате»: вопрос по находке ложится в плашку
                          (НЕ отправляется сам — пользователь правит и шлёт). */}
                      <button
                        type="button"
                        className={styles.discussBtn}
                        title={t('ws.discuss')}
                        aria-label={t('ws.discuss')}
                        onClick={(e) => {
                          e.stopPropagation();
                          setChatOpen(true);
                          setTimeout(() => {
                            window.dispatchEvent(
                              new CustomEvent('lexab:composer-prefill', {
                                detail: { draftKey: 'workspace', text: t('ws.discussPrompt', { title: f.title, citation: f.citation }) },
                              }),
                            );
                          }, 60); // панель чата могла быть закрыта — даём плашке смонтироваться
                        }}
                      >
                        <Icon name="chat" size={14} />
                      </button>
                      {clickable ? <Icon name="chevron" size={14} color="var(--dim)" /> : null}
                    </div>
                  );
                })}
              </div>

              {textMessages.length > 0 ? (
                <div className={styles.qaThread}>
                  {textMessages.map((m) =>
                    m.role === 'user' ? (
                      <div key={m.id} className={styles.qaUser}>
                        {m.text}
                      </div>
                    ) : (
                      <div key={m.id} className={styles.qaAssistant}>
                        {/* «…» внутри текста: после блочного markdown-рендера
                            отдельный текстовый узел падал бы на свою строку. */}
                        <MarkdownMessage text={m.streaming ? `${m.text ?? ''}…` : (m.text ?? '')} />
                      </div>
                    ),
                  )}
                </div>
              ) : null}
            </div>
          </div>
        </div>

        {/* hideAttach: кнопка «+» подписана «Прикрепить», а onAnalyze здесь —
            платный повторный анализ; молчаливая трата запроса по мисклику
            недопустима. Переанализ остаётся явной кнопкой и /analyze. */}
        <ChatInput compact hideAttach draftKey="workspace" onAnalyze={isDraft ? analyzeDraft : runReanalysis} onSend={(text) => sendMessage(text)} />
      </div>
      ) : null}

      {/* Перетаскиваемая граница панелей (скрыта на мобильной раскладке). */}
      {chatVisible && !isMobile ? (
        <div
          className={`${styles.splitter} ${dragging ? styles.splitterActive : ''}`}
          role="separator"
          aria-orientation="vertical"
          aria-label={t('ws.dragResize')}
          title={t('ws.dragResize')}
          onPointerDown={startSplitDrag}
          onDoubleClick={resetSplit}
        >
          <span className={styles.splitterGrip} />
        </div>
      ) : null}

      {/* Right: top editing toolbar + document viewer with redlines + floating toolbar */}
      <DocumentViewer
        ref={editorRef}
        analysis={analysis}
        pendingCount={pendingCount}
        canEdit={canEdit}
        onChange={canEdit ? persistDocument : undefined}
        onActiveChange={setActiveBlock}
        anchor={anchor}
        hideHeader={isDraft}
        topBar={
          isDraft ? (
            // Черновик шаблона: вместо тулбара редактирования — панель действий.
            <div className={styles.draftBar}>
              <span className={styles.draftBadge}>
                <Icon name="docs" size={14} />
                {t('ws.draftBadge')}
              </span>
              <span className={styles.draftName} title={draftSource?.title}>
                {draftSource?.title}
              </span>
              <div className={styles.draftActions}>
                <IconButton icon="undo" label={t('editor.undo')} size="sm" iconSize={16} disabled={!canUndo} onClick={undoDraft} />
                <IconButton icon="redo" label={t('editor.redo')} size="sm" iconSize={16} disabled={!canRedo} onClick={redoDraft} />
                <Button size="sm" icon="download" onClick={() => void downloadDraft()}>
                  {t('tpl.download')}
                </Button>
                <Button size="sm" icon="docs" onClick={() => void copyDraft()}>
                  {t('tpl.copy')}
                </Button>
                <Button size="sm" variant="primary" icon="sparkle" disabled={analyzing} onClick={analyzeDraft}>
                  {analyzing ? t('ws.analyzingDraft') : t('ws.analyzeRisks')}
                </Button>
                <IconButton icon="x" label={t('common.close')} size="sm" iconSize={16} onClick={closeWorkspace} />
              </div>
            </div>
          ) : (
          <EditorToolbar
            canEdit={canEdit}
            active={activeBlock}
            editor={editorRef}
            showEdits={showEdits}
            onToggleShowEdits={toggleShowEdits}
            canUndo={canUndo}
            canRedo={canRedo}
            onUndo={() => {
              editorRef.current?.exitEdit(); // don't let a stale open editor re-save
              undoDocument();
            }}
            onRedo={() => {
              editorRef.current?.exitEdit();
              redoDocument();
            }}
            versionLabel={versionLabel}
            onVersionHistory={() => setHistoryOpen(true)}
            onClose={closeWorkspace}
          />
          )
        }
      >
        {!isDraft ? (
        <FloatingToolbar
          readOnly={!canEdit}
          pendingCount={pendingCount}
          onAcceptAll={() => {
            const ids = acceptAll();
            pushToast(t('ws.allAccepted'), 'success', {
              duration: 5000,
              actionLabel: t('common.undo'),
              onAction: () => {
                revertRedlines(ids);
                pushToast(t('ws.acceptAllUndone'), 'default');
              },
            });
          }}
          onDownload={(mode) => downloadDocx(mode)}
          onReport={() => {
            void analysisApi
              .downloadReport(analysis.id, analysis.fileName)
              .catch(() => pushToast(t('common.error'), 'error'));
          }}
          onSendForSignature={() => setSignOpen(true)}
          onVersionHistory={() => setHistoryOpen(true)}
          onShare={() => void openShare()}
        />
        ) : null}
      </DocumentViewer>

      {/* Публичная ссылка на отчёт для контрагента */}
      <Modal
        open={shareOpen}
        title={t('ws.shareTitle')}
        onClose={() => setShareOpen(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => void revokeShare()} disabled={shareBusy}>
              {t('ws.shareRevoke')}
            </Button>
            <Button
              variant="primary"
              icon="link"
              onClick={() => {
                void navigator.clipboard?.writeText(shareUrl ?? '');
                pushToast(t('ws.shareCopied'), 'success');
              }}
              disabled={!shareUrl}
            >
              {t('ws.shareCopy')}
            </Button>
          </>
        }
      >
        <p style={{ marginBottom: 10 }}>{t('ws.shareBody')}</p>
        {shareUrl ? (
          <code style={{ display: 'block', padding: '10px 12px', borderRadius: 10, background: 'var(--hover-2)', fontSize: 12.5, wordBreak: 'break-all', userSelect: 'all' }}>
            {shareUrl}
          </code>
        ) : (
          <Spinner size={16} />
        )}
      </Modal>

      <SendForSignatureModal
        open={signOpen}
        documentName={analysis.fileName}
        onClose={() => setSignOpen(false)}
        onSent={() => {
          setSignOpen(false);
          pushToast(t('ws.signSentToast'), 'success');
        }}
      />
      <VersionHistoryModal open={historyOpen} documentId={analysis.id} onClose={() => setHistoryOpen(false)} />
    </div>
  );
}
