import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Avatar } from '@/components/ui/Avatar';
import { toneColor } from '@/components/ui/Badge';
import { CitationLine } from '@/components/ui/VerifiedBadge';
import { Icon } from '@/components/icons/Icon';
import { IconButton } from '@/components/ui/Button';
import { SkeletonRows } from '@/components/ui/States';
import { ChatInput } from '@/components/chat/ChatInput';
import { DocumentViewer, type ActiveBlock, type DocEditorHandle } from '@/components/workspace/DocumentViewer';
import { EditorToolbar } from '@/components/workspace/EditorToolbar';
import { FloatingToolbar } from '@/components/workspace/FloatingToolbar';
import { SendForSignatureModal } from '@/components/workspace/SendForSignatureModal';
import { VersionHistoryModal } from '@/components/workspace/VersionHistoryModal';
import { analysisApi, documentsApi, versionsApi } from '@/api';
import { useChatStore } from '@/store/useChatStore';
import { useUIStore } from '@/store/useUIStore';
import { usePageTitle } from '@/hooks/usePageTitle';
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
  const revertRedlines = useChatStore((s) => s.revertRedlines);
  const updateDocument = useChatStore((s) => s.updateDocument);
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

  // The toolbar shows the latest version label (e.g. "v3 — current"). Best
  // effort: versions are a plan-gated feature, so a 402/empty just hides it.
  const analysisId = analysis?.id;
  useEffect(() => {
    if (!analysisId) return;
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

  // Persist a document edit from the rich editor (blocks already assembled by
  // the viewer). updateDocument records an undo snapshot; the server stores it.
  const persistDocument = (document: DocBlock[]) => {
    updateDocument(document);
    analysisApi
      .saveDocument(analysis.id, document)
      .then(() => pushToast(t('ws.saved'), 'success'))
      .catch(() => pushToast(t('common.error'), 'error'));
  };

  // Server-rendered DOCX: 'tracked' = real Word tracked changes (accept/reject
  // in Word), 'clean' = final text. Needs the owning document id.
  const downloadDocx = async (mode: 'tracked' | 'clean') => {
    if (!analysis.documentId) {
      pushToast(t('common.error'), 'error');
      return;
    }
    pushToast(t('ws.docxStarted'), 'success');
    try {
      const blob = await documentsApi.exportFile(analysis.documentId, 'docx', mode);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${analysis.fileName.replace(/\.[^.]+$/, '') || 'document'}.docx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      pushToast(err instanceof Error && err.message ? err.message : t('common.error'), 'error');
    }
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
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                setAnchor({ redlineId: f.redlineId as string, nonce: Date.now() });
                              }
                            },
                          }
                        : {})}
                    >
                      <span className={styles.findingCardDot} style={{ background: toneColor(f.severity) }} />
                      <div style={{ minWidth: 0 }}>
                        <div className={styles.findingCardTitle}>{f.title}</div>
                        <CitationLine finding={f} />
                      </div>
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

      {/* Right: top editing toolbar + document viewer with redlines + floating toolbar */}
      <DocumentViewer
        ref={editorRef}
        analysis={analysis}
        pendingCount={pendingCount}
        canEdit={canEdit}
        onChange={canEdit ? persistDocument : undefined}
        onActiveChange={setActiveBlock}
        anchor={anchor}
        topBar={
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
        }
      >
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
