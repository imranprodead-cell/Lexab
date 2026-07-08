import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Avatar } from '@/components/ui/Avatar';
import { toneColor } from '@/components/ui/Badge';
import { CitationChip } from '@/components/ui/CitationChip';
import { IconButton } from '@/components/ui/Button';
import { LoadingState } from '@/components/ui/States';
import { ChatInput } from '@/components/chat/ChatInput';
import { DocumentViewer } from '@/components/workspace/DocumentViewer';
import { FloatingToolbar } from '@/components/workspace/FloatingToolbar';
import { SendForSignatureModal } from '@/components/workspace/SendForSignatureModal';
import { VersionHistoryModal } from '@/components/workspace/VersionHistoryModal';
import { exportDocx } from '@/lib/exportDocument';
import { analysisApi } from '@/api';
import { useChatStore } from '@/store/useChatStore';
import { useUIStore } from '@/store/useUIStore';
import { useI18n } from '@/i18n/I18nProvider';
import type { DocBlock } from '@/types/domain';
import styles from '@/components/workspace/workspace.module.css';

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
  const seedAnalyzed = useChatStore((s) => s.seedAnalyzed);
  const acceptAll = useChatStore((s) => s.acceptAllRedlines);
  const updateDocument = useChatStore((s) => s.updateDocument);
  const pushToast = useUIStore((s) => s.pushToast);

  const [signOpen, setSignOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  // Support landing directly on the workspace (refresh / deep link).
  useEffect(() => {
    if (!analysis) seedAnalyzed();
  }, [analysis, seedAnalyzed]);

  if (!analysis) return <LoadingState label="Preparing workspace…" />;

  const pendingCount = analysis.redlines.filter((r) => r.status === 'pending').length;
  const textMessages = messages.filter((m) => m.kind === 'text');

  const closeWorkspace = () => navigate(sessionId ? `/chat/${sessionId}` : '/chat');

  const saveBlock = (index: number, text: string) => {
    const document: DocBlock[] = analysis.document.map((b, i) =>
      i === index ? (b.type === 'heading' ? { type: 'heading', text } : { type: 'paragraph', segments: [text] }) : b,
    );
    updateDocument(document);
    analysisApi
      .saveDocument(analysis.id, document)
      .then(() => pushToast(t('ws.saved'), 'success'))
      .catch(() => pushToast(t('common.error'), 'error'));
  };

  return (
    <div className={styles.workspace}>
      {/* Left: review conversation + findings + document Q&A */}
      <div className={styles.leftPane}>
        <div className={styles.leftHeader}>
          <IconButton icon="back" label="Back to chat" size="sm" iconSize={18} onClick={closeWorkspace} />
          <span className={styles.leftTitle}>Review</span>
        </div>

        <div className={`${styles.leftBody} scroll`}>
          <div className={styles.reviewIntro}>
            <Avatar size={28} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <p className={styles.reviewIntroText}>
                I placed {analysis.redlines.length} tracked changes in the document. Accept or reject each on the right —
                or apply all at once. Ask me anything about this contract below.
              </p>
              <div className={styles.findingCards}>
                {analysis.findings.map((f) => (
                  <div key={f.id} className={styles.findingCard}>
                    <span className={styles.findingCardDot} style={{ background: toneColor(f.severity) }} />
                    <div style={{ minWidth: 0 }}>
                      <div className={styles.findingCardTitle}>{f.title}</div>
                      <CitationChip citation={f.citation} />
                    </div>
                  </div>
                ))}
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
                        {m.text}
                        {m.streaming ? '…' : ''}
                      </div>
                    ),
                  )}
                </div>
              ) : null}
            </div>
          </div>
        </div>

        <ChatInput
          compact
          onAnalyze={() => pushToast('Re-analysis will re-run against the current draft.')}
          onSend={(text) => sendMessage(text)}
        />
      </div>

      {/* Right: document viewer with redlines + floating toolbar */}
      <DocumentViewer analysis={analysis} pendingCount={pendingCount} onSaveBlock={saveBlock}>
        <FloatingToolbar
          pendingCount={pendingCount}
          onAcceptAll={() => {
            acceptAll();
            pushToast('All suggestions accepted.', 'success');
          }}
          onDownload={() => {
            exportDocx(analysis);
            pushToast('DOCX с применёнными правками загружается…', 'success');
          }}
          onReport={() => {
            void analysisApi
              .downloadReport(analysis.id, analysis.fileName)
              .catch(() => pushToast(t('common.error'), 'error'));
          }}
          onSendForSignature={() => setSignOpen(true)}
          onVersionHistory={() => setHistoryOpen(true)}
        />
      </DocumentViewer>

      <SendForSignatureModal
        open={signOpen}
        documentName={analysis.fileName}
        onClose={() => setSignOpen(false)}
        onSent={() => {
          setSignOpen(false);
          pushToast('Signature request sent.', 'success');
        }}
      />
      <VersionHistoryModal open={historyOpen} documentId={analysis.id} onClose={() => setHistoryOpen(false)} />
    </div>
  );
}
