import { useEffect, useRef, useState, type DragEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { TopBar } from '@/components/layout/TopBar';
import { TopBarActions } from '@/components/layout/TopBarActions';
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
import { LogoLoader } from '@/components/ui/LogoLoader';
import { Modal } from '@/components/ui/Modal';
import { ErrorState } from '@/components/ui/States';
import { billingApi } from '@/api/billing.api';
import { useAsync } from '@/hooks/useAsync';
import { useChatStore } from '@/store/useChatStore';
import { useChatHistoryStore } from '@/store/useChatHistoryStore';
import { useUIStore } from '@/store/useUIStore';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useI18n } from '@/i18n/I18nProvider';
import { formatFileSize } from '@/lib/format';
import type { ChatMessage } from '@/types/domain';
import chat from '@/components/chat/chat.module.css';

const ACCEPTED = /\.(pdf|docx?|txt)$/i;

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
  const ghost = useChatStore((s) => s.ghost);
  const enterGhost = useChatStore((s) => s.enterGhost);
  const exitGhost = useChatStore((s) => s.exitGhost);
  const setFeedback = useChatStore((s) => s.setFeedback);
  const addSession = useChatHistoryStore((s) => s.addSession);

  const pushToast = useUIStore((s) => s.pushToast);
  const threadRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const [cloudOpen, setCloudOpen] = useState(false);
  const [ghostConfirm, setGhostConfirm] = useState(false);

  // The Free-plan upsell above the composer (hidden on every paid plan).
  const { data: limits } = useAsync((signal) => billingApi.limits(signal), []);
  const isFree = limits?.plan === 'Free';

  // Opening a previous session from the sidebar restores its conversation
  // (from the server in real mode; the demo state in mock mode).
  useEffect(() => {
    if (sessionId) void loadSession(sessionId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [phase, activeStep, analysis, messages]);

  const openWorkspace = () => navigate(sessionId ? `/chat/${sessionId}/workspace` : '/workspace');

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
      <div key={m.id} className={chat.msgUser}>
        <div className={`${chat.msgUserBubble} ${chat.textIn}`}>{m.text}</div>
      </div>
    ) : m.streaming && !m.text ? (
      // Waiting for the first token: the brand logo inside an infinite
      // progress ring instead of a blinking cursor.
      <div key={m.id} className={chat.msgAssistant}>
        <LogoLoader size={30} />
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
        title={ghost ? t('ghost.enter') : t('nav.newReview')}
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

      {phase === 'idle' && messages.length === 0 ? (
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
            onDraft={() => sendMessage('/draft ')}
            onCompare={() => navigate('/compare')}
          />
        )
      ) : (
        <div className={`${chat.thread} scroll`} ref={threadRef}>
          <div className={chat.threadInner}>
            {fileMessage?.file ? <UserFileBubble name={fileMessage.file.name} size={fileMessage.file.size} /> : null}

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
                          onFollowUp={() => sendMessage(t('chat.followUp'))}
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
        onSend={(text) => (text.trim().toLowerCase().startsWith('/compare') ? navigate('/compare') : sendMessage(text))}
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
