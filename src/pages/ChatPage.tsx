import { useEffect, useRef, useState, type DragEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { TopBar } from '@/components/layout/TopBar';
import { Icon } from '@/components/icons/Icon';
import { WelcomeScreen } from '@/components/chat/WelcomeScreen';
import { UserFileBubble } from '@/components/chat/UserFileBubble';
import { AnalysisCard } from '@/components/chat/AnalysisCard';
import { SummaryCard } from '@/components/chat/SummaryCard';
import { ChatInput } from '@/components/chat/ChatInput';
import { Avatar } from '@/components/ui/Avatar';
import { ErrorState } from '@/components/ui/States';
import { useChatStore } from '@/store/useChatStore';
import { useChatHistoryStore } from '@/store/useChatHistoryStore';
import { useUIStore } from '@/store/useUIStore';
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

  const phase = useChatStore((s) => s.phase);
  const messages = useChatStore((s) => s.messages);
  const analysis = useChatStore((s) => s.analysis);
  const activeStep = useChatStore((s) => s.activeStep);
  const steps = useChatStore((s) => s.steps);
  const error = useChatStore((s) => s.error);
  const startAnalysis = useChatStore((s) => s.startAnalysis);
  const sendMessage = useChatStore((s) => s.sendMessage);
  const loadSession = useChatStore((s) => s.loadSession);
  const addSession = useChatHistoryStore((s) => s.addSession);

  const pushToast = useUIStore((s) => s.pushToast);
  const threadRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);

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

  const analyze = (file?: { name: string; size: string }) => {
    addSession(file?.name ?? 'Employment_Agreement_v3.docx');
    startAnalysis(file);
  };

  const handleFile = (file: File) => {
    if (!ACCEPTED.test(file.name)) {
      pushToast('Поддерживаются файлы PDF, DOC/DOCX, TXT.', 'error');
      return;
    }
    analyze({ name: file.name, size: formatFileSize(file.size) });
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  };

  const onDragOver = (e: DragEvent) => {
    e.preventDefault();
    if (!dragging) setDragging(true);
  };

  const fileMessage = messages.find((m) => m.kind === 'file');
  const textMessages = messages.filter((m) => m.kind === 'text');

  const renderText = (m: ChatMessage) =>
    m.role === 'user' ? (
      <div key={m.id} className={chat.msgUser}>
        <div className={chat.msgUserBubble}>{m.text}</div>
      </div>
    ) : (
      <div key={m.id} className={chat.msgAssistant}>
        <Avatar size={30} />
        <div className={chat.msgAssistantText}>
          {m.text}
          {m.streaming ? <span className={chat.cursor} /> : null}
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
      <TopBar title={t('nav.newReview')} />

      {phase === 'idle' && messages.length === 0 ? (
        <WelcomeScreen
          onAnalyze={() => analyze()}
          onDraft={() => sendMessage('/draft ')}
          onCompare={() => navigate('/compare')}
        />
      ) : (
        <div className={`${chat.thread} scroll`} ref={threadRef}>
          <div className={chat.threadInner}>
            {fileMessage?.file ? <UserFileBubble name={fileMessage.file.name} size={fileMessage.file.size} /> : null}

            {fileMessage || phase === 'analyzing' || phase === 'error' ? (
              <div className={chat.aiRow}>
                <Avatar size={30} />
                <div className={chat.aiBody}>
                  {phase === 'error' ? (
                    <ErrorState message={error ?? t('common.error')} onRetry={() => startAnalysis(fileMessage?.file)} />
                  ) : (
                    <>
                      <AnalysisCard steps={steps} activeStep={activeStep} done={phase === 'analyzed'} />
                      {phase === 'analyzed' && analysis ? (
                        <SummaryCard
                          analysis={analysis}
                          onOpenWorkspace={openWorkspace}
                          onFollowUp={() => sendMessage('Какие пункты требуют доработки в первую очередь?')}
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
        onAnalyze={() => analyze()}
        onFile={(file) => handleFile(file)}
        onSend={(text) => (text.trim().toLowerCase().startsWith('/compare') ? navigate('/compare') : sendMessage(text))}
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
