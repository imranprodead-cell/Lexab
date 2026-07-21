import { useEffect, useRef, useState, type DragEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { TopBar } from '@/components/layout/TopBar';
import { TopBarActions } from '@/components/layout/TopBarActions';
import { BrandMenu } from '@/components/layout/BrandMenu';
import { Icon } from '@/components/icons/Icon';
import { WelcomeScreen } from '@/components/chat/WelcomeScreen';
import { UserFileBubble } from '@/components/chat/UserFileBubble';
import { AnalysisCard } from '@/components/chat/AnalysisCard';
import { SummaryCard } from '@/components/chat/SummaryCard';
import { ChatInput } from '@/components/chat/ChatInput';
import { CloudImportModal } from '@/components/chat/CloudImportModal';
import { MessageActions } from '@/components/chat/MessageActions';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { ScalesMascot } from '@/components/ui/ScalesMascot';
import { Modal } from '@/components/ui/Modal';
import { ErrorState, SkeletonRows } from '@/components/ui/States';
import { billingApi } from '@/api/billing.api';
import { analysisApi } from '@/api/analysis.api';
import { useAsync } from '@/hooks/useAsync';
import { useChatStore } from '@/store/useChatStore';
import { useChatHistoryStore } from '@/store/useChatHistoryStore';
import { useUIStore } from '@/store/useUIStore';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useI18n } from '@/i18n/I18nProvider';
import { formatFileSize } from '@/lib/format';
import { COUNTRIES } from '@/data/countries';
import type { ChatMessage } from '@/types/domain';
import chat from '@/components/chat/chat.module.css';

const ACCEPTED = /\.(pdf|docx?|txt)$/i;

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
  const adoptAnalysis = useChatStore((s) => s.adoptAnalysis);
  const addSession = useChatHistoryStore((s) => s.addSession);

  const pushToast = useUIStore((s) => s.pushToast);
  const country = useUIStore((s) => s.country);
  const threadRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const [cloudOpen, setCloudOpen] = useState(false);
  const [ghostConfirm, setGhostConfirm] = useState(false);
  const [draftOpen, setDraftOpen] = useState(false);
  const [draftPrompt, setDraftPrompt] = useState('');
  const [drafting, setDrafting] = useState(false);

  // The Free-plan upsell above the composer (hidden on every paid plan).
  const { data: limits } = useAsync((signal) => billingApi.limits(signal), []);
  const isFree = limits?.plan === 'Free';

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

  const onThreadScroll = () => {
    const el = threadRef.current;
    if (!el) return;
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  useEffect(() => {
    const el = threadRef.current;
    if (!el) return;
    const ids = messages.map((m) => m.id).join(',');
    const prevIds = prevIdsRef.current;
    const appended = ids !== prevIds && ids.startsWith(prevIds) && (prevIds !== '' || messages.length <= 3);
    prevIdsRef.current = ids;
    const lastUser = [...messages].reverse().find((m) => m.role === 'user');

    if (lastUser && lastUser.id !== anchorRef.current) {
      anchorRef.current = lastUser.id;
      if (appended) {
        // Just sent: reserve room below, then pin the message to the top.
        setTailPad(Math.max(0, el.clientHeight - 150));
        stickRef.current = false;
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

  const setServerSession = useChatStore((s) => s.setServerSession);

  const analyze = (file: { name: string; size: string }, rawFile?: File) => {
    // Create the sidebar entry and tie it to this canvas, so follow-up
    // questions land in the same session instead of creating a second one.
    void addSession(file.name).then((session) => {
      if (session) setServerSession(session.id);
    });
    void startAnalysis(file, rawFile);
  };

  const handleFile = (file: File) => {
    if (ghost) {
      pushToast(t('ghost.noFiles'), 'default');
      return;
    }
    if (!ACCEPTED.test(file.name)) {
      pushToast(t('chat.fileTypes'), 'error');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      pushToast(t('chat.fileTooBig'), 'error');
      return;
    }
    // Pass the file itself so its text reaches the AI (POST /uploads).
    analyze({ name: file.name, size: formatFileSize(file.size) }, file);
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  };

  const onDragOver = (e: DragEvent) => {
    e.preventDefault();
    if (!dragging && !ghost) setDragging(true);
  };

  const onExitGhost = () => {
    exitGhost();
    pushToast(t('ghost.left'), 'default');
  };

  const fileMessage = messages.find((m) => m.kind === 'file');
  const textMessages = messages.filter((m) => m.kind === 'text');

  const renderText = (m: ChatMessage) =>
    m.role === 'user' ? (
      <div key={m.id} className={chat.msgUser} data-mid={m.id}>
        <UserBubble text={m.text ?? ''} />
      </div>
    ) : m.streaming && !m.text ? (
      // Waiting for the first token: the animated scales mascot ponders the
      // question instead of a blinking cursor.
      <div key={m.id} className={chat.msgAssistant}>
        <ScalesMascot size={46} />
        <div className={`${chat.msgAssistantText} ${chat.thinkingText}`}>{t('chat.thinking')}</div>
      </div>
    ) : (
      <div key={m.id} className={chat.msgAssistant}>
        <Avatar size={30} />
        <div className={chat.msgAssistantBody}>
          <div className={`${chat.msgAssistantText} ${chat.textIn}`}>{m.text}</div>
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
            <TopBarActions />
          </div>
        }
      />

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
          />
        )
      ) : (
        <div className={`${chat.thread} scroll`} ref={threadRef} onScroll={onThreadScroll}>
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
                    <ErrorState message={error ?? t('common.error')} onRetry={() => fileMessage?.file && void startAnalysis(fileMessage.file)} />
                  ) : (
                    <>
                      <AnalysisCard steps={steps} activeStep={activeStep} done={phase === 'analyzed'} />
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

      <ChatInput
        key={ghost ? 'ghost' : 'chat'}
        ephemeral={ghost}
        onAnalyze={() => pushToast(ghost ? t('ghost.noFiles') : t('chat.attachFirst'), 'default')}
        onFile={ghost ? undefined : (file) => handleFile(file)}
        onCloudImport={ghost ? undefined : () => setCloudOpen(true)}
        onSend={(text) => {
          const lower = text.trim().toLowerCase();
          if (lower.startsWith('/compare')) return navigate('/compare');
          if (lower.startsWith('/draft')) return void runDraft(text.trim().replace(/^\/draft\s*/i, ''));
          return sendMessage(text);
        }}
        banner={
          isFree ? (
            <div className={chat.upsellBar}>
              <span className={chat.upsellText}>
                <Icon name="diamond" size={14} color="var(--accent)" />
                {t('chat.upsell.title')}
              </span>
              <button type="button" className={chat.upsellBtn} onClick={() => navigate('/plans')}>
                {t('chat.upsell.cta')}
              </button>
            </div>
          ) : null
        }
      />

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
        // The imported file already sits on the server as an upload, so the
        // analysis pipeline picks it up by name — no re-upload needed.
        onImported={(file) => analyze(file)}
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
