import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Avatar } from '@/components/ui/Avatar';
import { toneColor } from '@/components/ui/Badge';
import { CitationChip } from '@/components/ui/CitationChip';
import { IconButton } from '@/components/ui/Button';
import { SkeletonRows } from '@/components/ui/States';
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
  const acceptAll = useChatStore((s) => s.acceptAllRedlines);
  const updateDocument = useChatStore((s) => s.updateDocument);
  const reanalyze = useChatStore((s) => s.reanalyze);
  const pushToast = useUIStore((s) => s.pushToast);

  const analysisReadOnly = () => useChatStore.getState().analysis?.canEdit === false;
  const [signOpen, setSignOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [reanalyzing, setReanalyzing] = useState(false);

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
          <IconButton icon="back" label={t('ws.backToChat')} size="sm" iconSize={18} onClick={closeWorkspace} />
          <span className={styles.leftTitle}>{t('ws.review')}</span>
        </div>

        <div className={`${styles.leftBody} scroll`}>
          <div className={styles.reviewIntro}>
            <Avatar size={28} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <p className={styles.reviewIntroText}>{t('ws.intro', { n: analysis.redlines.length })}</p>
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

        <ChatInput compact draftKey="workspace" onAnalyze={runReanalysis} onSend={(text) => sendMessage(text)} />
      </div>

      {/* Right: document viewer with redlines + floating toolbar */}
      <DocumentViewer analysis={analysis} pendingCount={pendingCount} onSaveBlock={canEdit ? saveBlock : undefined}>
        <FloatingToolbar
          readOnly={!canEdit}
          pendingCount={pendingCount}
          onAcceptAll={() => {
            acceptAll();
            pushToast(t('ws.allAccepted'), 'success');
          }}
          onDownload={() => {
            exportDocx(analysis);
            pushToast(t('ws.docxStarted'), 'success');
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
          pushToast(t('ws.signSentToast'), 'success');
        }}
      />
      <VersionHistoryModal open={historyOpen} documentId={analysis.id} onClose={() => setHistoryOpen(false)} />
    </div>
  );
}
