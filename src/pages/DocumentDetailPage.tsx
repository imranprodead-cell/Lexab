import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { TopBar } from '@/components/layout/TopBar';
import { Icon } from '@/components/icons/Icon';
import { Badge, RiskBadge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';
import { ErrorState, SkeletonRows } from '@/components/ui/States';
import { SendForSignatureModal } from '@/components/workspace/SendForSignatureModal';
import { ExpiryChip } from '@/components/contracts/ExpiryChip';
import { ObligationList } from '@/components/contracts/ObligationList';
import { useAsync, clearAsyncCache } from '@/hooks/useAsync';
import { usePageTitle } from '@/hooks/usePageTitle';
import { analysisApi, contractsApi, documentsApi, versionsApi, workflowsApi, ApiError } from '@/api';
import { approvalsApi, type NewApprovalStep } from '@/api/approvals.api';
import { downloadBlob } from '@/lib/download';
import { billingApi } from '@/api/billing.api';
import { TextField } from '@/components/ui/TextField';
import { DatePicker } from '@/components/ui/DatePicker';
import { RoleSelect } from '@/components/ui/RoleSelect';
import { useChatStore } from '@/store/useChatStore';
import { useUIStore } from '@/store/useUIStore';
import { useI18n } from '@/i18n/I18nProvider';
import type { ContractRow, ContractStatus, Severity, WorkflowRun, WorkflowStepInput } from '@/types/domain';
import styles from './pages.module.css';

const STATUS_TONE: Record<ContractStatus, string> = {
  Draft: 'var(--mut)',
  'In review': 'var(--sev-med)',
  Reviewed: 'var(--accent)',
  Signed: 'var(--sev-low)',
};

const WORKFLOW_POLL_MS = 2500;

/** One approver row draft. A stable `key` keeps select state from leaking into
 *  a neighbour when a row is removed; `day` is a plain local day (→ ISO only on
 *  submit, so no TZ off-by-one). Shared by the approval and workflow modals. */
interface ApproverDraft {
  key: number;
  name: string;
  email: string;
  role: string;
  day: string | null;
}

let approverKeySeq = 0;
const emptyApprover = (): ApproverDraft => ({ key: ++approverKeySeq, name: '', email: '', role: '', day: null });

/** Validate + convert approver drafts into API-ready steps; null when invalid. */
function draftsToApprovers(drafts: ApproverDraft[]): NewApprovalStep[] | null {
  const cleaned: NewApprovalStep[] = drafts
    .map((s) => ({
      name: s.name.trim(),
      email: s.email.trim(),
      role: s.role.trim() || undefined,
      // 18:00 local time on the picked day.
      dueAt: s.day ? new Date(`${s.day}T18:00:00`).toISOString() : undefined,
    }))
    .filter((s) => s.name || s.email);
  if (cleaned.length === 0 || cleaned.some((s) => !s.name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.email))) return null;
  return cleaned;
}

/** The ordered approver mini-form reused by the approval workflow modal and the
 *  agentic-workflow «send for approval» step. */
function ApproverStepsEditor({
  steps,
  setSteps,
  max = 10,
}: {
  steps: ApproverDraft[];
  setSteps: React.Dispatch<React.SetStateAction<ApproverDraft[]>>;
  max?: number;
}) {
  const { t } = useI18n();
  const update = (key: number, patch: Partial<ApproverDraft>) =>
    setSteps((s) => s.map((x) => (x.key === key ? { ...x, ...patch } : x)));
  return (
    <>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {steps.map((s, i) => (
          <div key={s.key} className={styles.apprStepForm}>
            <div className={styles.apprStepFormHead}>
              <span className={styles.apprStepNum}>{t('appr.stepN', { n: i + 1 })}</span>
              {steps.length > 1 ? (
                <button type="button" className={styles.apprRemove} onClick={() => setSteps((x) => x.filter((step) => step.key !== s.key))}>
                  <Icon name="x" size={14} />
                </button>
              ) : null}
            </div>
            <div className={styles.formRow}>
              <TextField placeholder={t('appr.name')} value={s.name} onChange={(e) => update(s.key, { name: e.target.value })} />
              <TextField placeholder="email@company.com" type="email" value={s.email} onChange={(e) => update(s.key, { email: e.target.value })} />
            </div>
            <div className={styles.formRow}>
              <RoleSelect ariaLabel={t('appr.role')} value={s.role} onChange={(role) => update(s.key, { role })} />
              <DatePicker
                ariaLabel={t('appr.deadline')}
                placeholder={t('appr.deadline')}
                value={s.day}
                onChange={(day) => update(s.key, { day })}
              />
            </div>
          </div>
        ))}
      </div>
      {steps.length < max ? (
        <button type="button" className={styles.apprAdd} onClick={() => setSteps((x) => [...x, emptyApprover()])}>
          <Icon name="plus" size={15} /> {t('appr.addStep')}
        </button>
      ) : null}
    </>
  );
}

/** «Сроки и обязательства» — key terms extracted from the contract (CLM).
 *  Renders nothing when the plan lacks the feature (402) or the document has
 *  no extracted terms (404). */
function ContractTermsCard({ documentId, reloadKey = 0 }: { documentId: string; reloadKey?: number }) {
  const { t, lang } = useI18n();
  const [row, setRow] = useState<ContractRow | null>(null);

  useEffect(() => {
    let alive = true;
    const controller = new AbortController();
    contractsApi
      .get(documentId, controller.signal)
      .then((r) => {
        if (alive) setRow(r);
      })
      .catch(() => undefined); // 404/402 → hide the card silently
    return () => {
      alive = false;
      controller.abort();
    };
  }, [documentId, reloadKey]);

  if (!row) return null;
  const { terms } = row;
  const formatDate = (iso: string): string =>
    new Date(iso).toLocaleDateString(lang === 'ru' ? 'ru-RU' : 'en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });

  return (
    <section className={styles.section} style={{ marginTop: 24 }}>
      <h2 className={styles.sectionTitle} style={{ marginBottom: 14 }}>
        {t('contracts.termsTitle')}
      </h2>
      <div className={styles.docMetaGrid} style={{ marginBottom: 16 }}>
        <div className={styles.docMetaCell}>
          <span className={styles.docMetaLabel}>{t('contracts.effective')}</span>
          <span className={styles.metaText}>{terms.effectiveDate ? formatDate(terms.effectiveDate) : '—'}</span>
        </div>
        <div className={styles.docMetaCell}>
          <span className={styles.docMetaLabel}>{t('contracts.col.expiry')}</span>
          {terms.expiryDate ? (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span className={styles.metaText}>{formatDate(terms.expiryDate)}</span>
              <ExpiryChip days={terms.daysToExpiry} />
            </span>
          ) : (
            <span className={styles.metaText}>—</span>
          )}
        </div>
        <div className={styles.docMetaCell}>
          <span className={styles.docMetaLabel}>{t('contracts.col.auto')}</span>
          {terms.autoRenew ? (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <Badge color="accent">{t('contracts.autoBadge')}</Badge>
              {terms.renewalNoticeDays != null ? (
                <span className={styles.metaText}>{t('contracts.noticeDays', { n: terms.renewalNoticeDays })}</span>
              ) : null}
            </span>
          ) : (
            <span className={styles.metaText}>—</span>
          )}
        </div>
        <div className={styles.docMetaCell}>
          <span className={styles.docMetaLabel}>{t('contracts.col.value')}</span>
          <span className={styles.metaText}>
            {terms.contractValue ? `${terms.contractValue}${terms.currency ? ` ${terms.currency}` : ''}` : '—'}
          </span>
        </div>
        <div className={styles.docMetaCell}>
          <span className={styles.docMetaLabel}>{t('contracts.col.law')}</span>
          <span className={styles.metaText}>{terms.governingLaw ?? '—'}</span>
        </div>
      </div>
      {row.obligations.length > 0 ? <ObligationList documentId={documentId} obligations={row.obligations} /> : null}
    </section>
  );
}

/** Detail view for a single contract: metadata, versions, and actions. */
export function DocumentDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { t, lang } = useI18n();

  const formatDate = (iso: string): string =>
    new Date(iso).toLocaleDateString(lang === 'ru' ? 'ru-RU' : 'en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  const pushToast = useUIStore((s) => s.pushToast);
  const adoptAnalysis = useChatStore((s) => s.adoptAnalysis);

  const { data: doc, loading, error, reload } = useAsync((signal) => documentsApi.get(id, signal), [id]);
  const { data: versions, error: versionsError } = useAsync((signal) => versionsApi.list(id, signal), [id]);
  const approvals = useAsync((signal) => approvalsApi.forDocument(id, signal), [id]);
  const { data: limits } = useAsync((signal) => billingApi.limits(signal), []);
  usePageTitle(doc?.name || t('nav.documents'));

  const flow = (approvals.data ?? [])[0] ?? null;
  const planAllowsApprovals = ['Pro', 'Business', 'Enterprise'].includes(limits?.plan ?? '');

  // Create-approval modal state. Rows carry a stable key + a plain local day
  // (see ApproverDraft) so the shared editor stays TZ-safe.
  const [apprOpen, setApprOpen] = useState(false);
  const [apprSteps, setApprSteps] = useState<ApproverDraft[]>(() => [emptyApprover()]);
  const [apprBusy, setApprBusy] = useState(false);
  const [apprError, setApprError] = useState<string | null>(null);

  const startApproval = () => {
    if (!planAllowsApprovals) {
      pushToast(t('appr.upgrade'), 'error');
      navigate('/plans');
      return;
    }
    setApprSteps([emptyApprover()]);
    setApprError(null);
    setApprOpen(true);
  };

  const submitApproval = async () => {
    const cleaned = draftsToApprovers(apprSteps);
    if (!cleaned) {
      setApprError(t('appr.errSteps'));
      return;
    }
    setApprBusy(true);
    setApprError(null);
    try {
      await approvalsApi.create(id, cleaned);
      setApprOpen(false);
      approvals.reload();
      pushToast(t('appr.started'), 'success');
    } catch (err) {
      setApprError(err instanceof Error && err.message ? err.message : t('common.error'));
    } finally {
      setApprBusy(false);
    }
  };

  // ── Agentic workflow: launcher (step-picker modal) + polled progress ──────
  const [wfOpen, setWfOpen] = useState(false);
  const [wfBusy, setWfBusy] = useState(false);
  const [wfError, setWfError] = useState<string | null>(null);
  const [wfAnalyze, setWfAnalyze] = useState(true);
  const [wfRedlines, setWfRedlines] = useState(true);
  const [wfSeverity, setWfSeverity] = useState<Severity>('High');
  const [wfApproval, setWfApproval] = useState(false);
  const [wfApprovers, setWfApprovers] = useState<ApproverDraft[]>(() => [emptyApprover()]);
  const [run, setRun] = useState<WorkflowRun | null>(null);
  const [termsKey, setTermsKey] = useState(0);
  const runDoneRef = useRef(false);

  const runActive = !!run && (run.status === 'queued' || run.status === 'running');

  const openWorkflow = () => {
    if (!planAllowsApprovals) {
      pushToast(t('workflow.upgrade'), 'error');
      navigate('/plans');
      return;
    }
    setWfAnalyze(true);
    setWfRedlines(true);
    setWfSeverity('High');
    setWfApproval(false);
    setWfApprovers([emptyApprover()]);
    setWfError(null);
    setWfOpen(true);
  };

  const submitWorkflow = async () => {
    const steps: WorkflowStepInput[] = [];
    if (wfAnalyze) steps.push({ kind: 'analyze' });
    if (wfRedlines) steps.push({ kind: 'apply-redlines', minSeverity: wfSeverity });
    if (wfApproval) {
      const approvers = draftsToApprovers(wfApprovers);
      if (!approvers) {
        setWfError(t('appr.errSteps'));
        return;
      }
      steps.push({ kind: 'send-for-approval', approvers });
    }
    if (steps.length === 0) {
      setWfError(t('workflow.errEmpty'));
      return;
    }
    setWfBusy(true);
    setWfError(null);
    try {
      const created = await workflowsApi.run(id, steps);
      runDoneRef.current = false;
      setRun(created);
      setWfOpen(false);
      pushToast(t('workflow.started'), 'success');
    } catch (err) {
      const status = err instanceof ApiError ? err.status : 0;
      const message = err instanceof Error && err.message ? err.message : t('common.error');
      // Plan gate / non-owner / already-active flow — surface the server message.
      if (status === 402 || status === 403 || status === 409) {
        pushToast(message, 'error');
        setWfOpen(false);
      } else {
        setWfError(message);
      }
    } finally {
      setWfBusy(false);
    }
  };

  // Poll the active run until it finishes, then stop. Re-armed only on id/status
  // change, so the interval survives progress updates and cleans up on unmount.
  const runId = run?.id;
  const runStatus = run?.status;
  useEffect(() => {
    if (!runId || runStatus === 'done' || runStatus === 'failed') return;
    let cancelled = false;
    const poll = () =>
      workflowsApi
        .get(runId)
        .then((r) => {
          if (!cancelled) setRun(r);
        })
        .catch(() => undefined);
    poll();
    const iv = setInterval(poll, WORKFLOW_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(iv);
    };
  }, [runId, runStatus]);

  // A finished run may have re-analysed, accepted redlines and started an
  // approval flow — pull fresh data so all of that shows up. Fires once per run.
  useEffect(() => {
    if (run?.status === 'done' && !runDoneRef.current) {
      runDoneRef.current = true;
      reload();
      approvals.reload();
      setTermsKey((k) => k + 1);
      pushToast(t('workflow.done'), 'success');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run?.status]);

  /** Per-step visual state for the progress checklist. */
  const wfStepState = (r: WorkflowRun, i: number): 'done' | 'active' | 'failed' | 'pending' => {
    if (r.status === 'done') return 'done';
    if (i < r.currentStep) return 'done';
    if (i === r.currentStep) return r.status === 'failed' ? 'failed' : 'active';
    return 'pending';
  };

  const cancelApproval = async () => {
    if (!flow) return;
    try {
      await approvalsApi.cancel(flow.id);
      approvals.reload();
      pushToast(t('appr.cancelled'), 'default');
    } catch (err) {
      pushToast(err instanceof Error && err.message ? err.message : t('common.error'), 'error');
    }
  };

  const copyApproveLink = async (token: string) => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/approve/${token}`);
      pushToast(t('appr.linkCopied'), 'success');
    } catch {
      pushToast(t('common.error'), 'error');
    }
  };

  const [signOpen, setSignOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [opening, setOpening] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const toggleShare = async () => {
    if (!doc || sharing) return;
    setSharing(true);
    try {
      await documentsApi.share(doc.id, !doc.teamShared);
      reload();
      pushToast(t(doc.teamShared ? 'docs.unshared' : 'docs.shared'), 'success');
    } catch (err) {
      pushToast(err instanceof Error && err.message ? err.message : t('common.error'), 'error');
    } finally {
      setSharing(false);
    }
  };

  const deleteDocument = async () => {
    if (!doc || deleting) return;
    setDeleting(true);
    try {
      await documentsApi.remove(doc.id);
      clearAsyncCache(); // the cached list/detail must forget the deleted doc
      pushToast(t('docs.deleted'), 'default');
      navigate('/documents');
    } catch (err) {
      pushToast(err instanceof Error && err.message ? err.message : t('common.error'), 'error');
      setDeleting(false);
    }
  };

  // Open the workspace with THIS document's own latest AI review.
  const openWorkspace = async () => {
    if (opening) return;
    setOpening(true);
    try {
      const analysis = await analysisApi.latestForDocument(id);
      adoptAnalysis(analysis);
      navigate('/workspace');
    } catch {
      pushToast(t('docs.noAnalysis'), 'error');
    } finally {
      setOpening(false);
    }
  };

  const downloadDocx = async () => {
    if (!doc || exporting) return;
    setExporting(true);
    try {
      // 'clean' = полный финальный документ (оригинальный текст с принятыми
      // правками) — из вкладки «Документы» пользователь ждёт весь договор,
      // а не выжимку правок для Word.
      const blob = await documentsApi.exportFile(doc.id, 'docx', 'clean');
      downloadBlob(blob, `${doc.name.replace(/\.[^.]+$/, '') || 'document'}.docx`);
      pushToast(t('docs.docxReady'), 'success');
    } catch (err) {
      pushToast(err instanceof Error && err.message ? err.message : t('common.error'), 'error');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className={styles.page}>
      <TopBar
        title={t('nav.documents')}
        left={
          <button
            className={styles.backBtn}
            onClick={() => navigate('/documents')}
            aria-label={t('common.back')}
          >
            <Icon name="back" size={18} />
          </button>
        }
      />
      <div className={`${styles.body} scroll`}>
        <div className={styles.container} style={{ maxWidth: 820 }}>
          {loading ? (
            <SkeletonRows rows={6} height={48} />
          ) : error || !doc ? (
            <ErrorState message={error ?? t('common.error')} onRetry={reload} />
          ) : (
            <>
              <div className={styles.docDetailHead}>
                <div className={styles.docDetailIcon}>
                  <Icon name="docs" size={26} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <h1 className={styles.docDetailName}>{doc.name}</h1>
                  <p className={styles.docDetailMeta}>{doc.counterparty}</p>
                </div>
              </div>

              <div className={styles.docMetaGrid}>
                <div className={styles.docMetaCell}>
                  <span className={styles.docMetaLabel}>{t('docs.col.status')}</span>
                  <Badge color={STATUS_TONE[doc.status]} plain>{t(`status.${doc.status}`)}</Badge>
                </div>
                <div className={styles.docMetaCell}>
                  <span className={styles.docMetaLabel}>{t('docs.col.risk')}</span>
                  <RiskBadge risk={doc.risk} plain />
                </div>
                <div className={styles.docMetaCell}>
                  <span className={styles.docMetaLabel}>{t('docs.col.jurisdiction')}</span>
                  <span className={styles.mono}>{doc.jurisdiction}</span>
                </div>
                <div className={styles.docMetaCell}>
                  <span className={styles.docMetaLabel}>{t('docs.col.updated')}</span>
                  <span className={styles.metaText}>{formatDate(doc.updatedAt)}</span>
                </div>
              </div>

              {doc.sharedBy ? (
                <p className={styles.docSharedNote}>
                  <Icon name="users" size={14} /> {t('docs.sharedByNote', { name: doc.sharedBy })}
                </p>
              ) : null}

              <div className={styles.docActions}>
                <Button variant="primary" icon="layout" disabled={opening} onClick={() => void openWorkspace()}>
                  {opening ? t('common.loading') : t('analysis.openWorkspace')}
                </Button>
                <Button variant="secondary" icon="esign" onClick={() => setSignOpen(true)}>
                  {t('nav.signatures')}
                </Button>
                <Button variant="secondary" icon="download" disabled={exporting} onClick={() => void downloadDocx()}>
                  {exporting ? t('common.loading') : 'DOCX'}
                </Button>
                {doc.mine !== false ? (
                  <>
                    <Button variant="secondary" icon="users" disabled={sharing} onClick={() => void toggleShare()}>
                      {doc.teamShared ? t('docs.unshare') : t('docs.share')}
                    </Button>
                    <Button variant="ghost" icon="trash" onClick={() => setDeleteOpen(true)}>
                      {t('docs.delete')}
                    </Button>
                  </>
                ) : null}
              </div>

              <SendForSignatureModal
                open={signOpen}
                documentName={doc.name}
                onClose={() => setSignOpen(false)}
                onSent={() => {
                  setSignOpen(false);
                  pushToast(t('docs.signSent'), 'success');
                }}
              />

              <Modal
                open={deleteOpen}
                title={t('docs.deleteTitle')}
                onClose={() => setDeleteOpen(false)}
                maxWidth={440}
                footer={
                  <>
                    <Button variant="ghost" onClick={() => setDeleteOpen(false)}>
                      {t('common.cancel')}
                    </Button>
                    <Button variant="primary" icon="trash" disabled={deleting} onClick={() => void deleteDocument()}>
                      {deleting ? t('common.loading') : t('docs.deleteConfirm')}
                    </Button>
                  </>
                }
              >
                <p style={{ margin: 0, fontSize: 14, color: 'var(--dim)', lineHeight: 1.6 }}>
                  {t('docs.deleteBody', { name: doc.name })}
                </p>
              </Modal>

              <ContractTermsCard documentId={id} reloadKey={termsKey} />

              <section className={styles.section} style={{ marginTop: 24 }}>
                <div className={styles.apprHead}>
                  <h2 className={styles.sectionTitle} style={{ margin: 0 }}>
                    {t('workflow.title')}
                  </h2>
                  {doc.mine !== false && !runActive ? (
                    <Button size="sm" icon={planAllowsApprovals ? 'sparkle' : 'shield'} onClick={openWorkflow}>
                      {t('workflow.run')}
                    </Button>
                  ) : null}
                </div>

                {!run ? (
                  <p className={styles.apprEmpty}>{planAllowsApprovals ? t('workflow.empty') : t('workflow.upgrade')}</p>
                ) : (
                  <>
                    <div className={styles.apprStatusRow}>
                      <Badge
                        color={
                          run.status === 'done'
                            ? 'var(--sev-low)'
                            : run.status === 'failed'
                              ? 'var(--sev-high)'
                              : 'var(--accent)'
                        }
                        plain
                      >
                        {run.status === 'done'
                          ? t('workflow.badgeDone')
                          : run.status === 'failed'
                            ? t('workflow.badgeFailed')
                            : t('workflow.badgeRunning')}
                      </Badge>
                    </div>
                    <div className={styles.wfChecklist}>
                      {run.steps.map((step, i) => {
                        const state = wfStepState(run, i);
                        return (
                          <div key={i} className={styles.wfStep}>
                            <span className={styles.wfStepIcon}>
                              {state === 'done' ? (
                                <Icon name="check" size={16} color="var(--sev-low)" />
                              ) : state === 'active' ? (
                                <Spinner size={14} />
                              ) : state === 'failed' ? (
                                <Icon name="x" size={16} color="var(--sev-high)" />
                              ) : (
                                <span className={styles.apprDot} style={{ background: 'var(--border)' }} />
                              )}
                            </span>
                            <span className={`${styles.wfStepLabel} ${state === 'pending' ? styles.wfStepPending : ''}`}>
                              {step.label}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                    {run.status === 'failed' && run.error ? <p className={styles.wfRunError}>{run.error}</p> : null}
                  </>
                )}
              </section>

              <section className={styles.section} style={{ marginTop: 24 }}>
                <div className={styles.apprHead}>
                  <h2 className={styles.sectionTitle} style={{ margin: 0 }}>
                    {t('appr.title')}
                  </h2>
                  {doc.mine !== false && (!flow || flow.status !== 'active') ? (
                    <Button size="sm" icon={planAllowsApprovals ? 'send' : 'shield'} onClick={startApproval}>
                      {t('appr.start')}
                    </Button>
                  ) : null}
                  {doc.mine !== false && flow?.status === 'active' ? (
                    <Button size="sm" variant="ghost" icon="x" onClick={() => void cancelApproval()}>
                      {t('appr.cancel')}
                    </Button>
                  ) : null}
                </div>

                {!flow ? (
                  <p className={styles.apprEmpty}>
                    {planAllowsApprovals ? t('appr.empty') : t('appr.upgrade')}
                  </p>
                ) : (
                  <div className={styles.apprChain}>
                    <div className={styles.apprStatusRow}>
                      <Badge
                        color={
                          flow.status === 'approved'
                            ? 'var(--sev-low)'
                            : flow.status === 'rejected'
                              ? 'var(--sev-high)'
                              : flow.status === 'cancelled'
                                ? 'var(--mut)'
                                : 'var(--accent)'
                        }
                        plain
                      >
                        {t(`appr.flow.${flow.status}`)}
                      </Badge>
                    </div>
                    {flow.steps.map((s) => (
                      <div key={s.id} className={styles.apprStep}>
                        <span
                          className={styles.apprDot}
                          style={{
                            background:
                              s.status === 'approved'
                                ? 'var(--sev-low)'
                                : s.status === 'rejected'
                                  ? 'var(--sev-high)'
                                  : s.status === 'pending'
                                    ? 'var(--sev-med)'
                                    : 'var(--border)',
                          }}
                        />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div className={styles.apprName}>
                            {s.ord + 1}. {s.name}
                            {s.role ? <span className={styles.apprRole}> · {s.role}</span> : null}
                          </div>
                          <div className={styles.apprMeta}>
                            {t(`appr.step.${s.status}`)}
                            {s.dueAt ? ` · ${t('appr.due')} ${formatDate(s.dueAt)}` : ''}
                            {s.comment ? ` · «${s.comment}»` : ''}
                          </div>
                        </div>
                        {s.status === 'pending' && s.token ? (
                          <Button size="sm" variant="ghost" icon="docs" onClick={() => void copyApproveLink(s.token as string)}>
                            {t('appr.copyLink')}
                          </Button>
                        ) : null}
                      </div>
                    ))}
                  </div>
                )}
              </section>

              <Modal
                open={apprOpen}
                title={t('appr.modalTitle')}
                onClose={() => setApprOpen(false)}
                maxWidth={560}
                footer={
                  <>
                    <Button variant="ghost" onClick={() => setApprOpen(false)}>
                      {t('common.cancel')}
                    </Button>
                    <Button variant="primary" icon="send" disabled={apprBusy} onClick={() => void submitApproval()}>
                      {apprBusy ? t('common.loading') : t('appr.submit')}
                    </Button>
                  </>
                }
              >
                <p className={styles.apprHint}>{t('appr.modalHint')}</p>
                <ApproverStepsEditor steps={apprSteps} setSteps={setApprSteps} />
                {apprError ? <p style={{ color: 'var(--danger)', fontSize: 13, margin: '10px 0 0' }}>{apprError}</p> : null}
              </Modal>

              <Modal
                open={wfOpen}
                title={t('workflow.modalTitle')}
                onClose={() => setWfOpen(false)}
                maxWidth={560}
                footer={
                  <>
                    <Button variant="ghost" onClick={() => setWfOpen(false)}>
                      {t('common.cancel')}
                    </Button>
                    <Button variant="primary" icon="sparkle" disabled={wfBusy} onClick={() => void submitWorkflow()}>
                      {wfBusy ? t('common.loading') : t('workflow.submit')}
                    </Button>
                  </>
                }
              >
                <p className={styles.apprHint}>{t('workflow.modalHint')}</p>
                <div className={styles.wfOptions}>
                  <div className={`${styles.wfOption} ${wfAnalyze ? styles.wfOptionOn : ''}`}>
                    <label className={styles.wfOptionHead}>
                      <input
                        type="checkbox"
                        className={styles.wfCheck}
                        checked={wfAnalyze}
                        onChange={(e) => setWfAnalyze(e.target.checked)}
                      />
                      <span className={styles.wfOptionText}>
                        <span className={styles.wfOptionTitle}>{t('workflow.stepAnalyze')}</span>
                        <span className={styles.wfOptionDesc}>{t('workflow.stepAnalyzeDesc')}</span>
                      </span>
                    </label>
                  </div>

                  <div className={`${styles.wfOption} ${wfRedlines ? styles.wfOptionOn : ''}`}>
                    <label className={styles.wfOptionHead}>
                      <input
                        type="checkbox"
                        className={styles.wfCheck}
                        checked={wfRedlines}
                        onChange={(e) => setWfRedlines(e.target.checked)}
                      />
                      <span className={styles.wfOptionText}>
                        <span className={styles.wfOptionTitle}>{t('workflow.stepRedlines')}</span>
                        <span className={styles.wfOptionDesc}>{t('workflow.stepRedlinesDesc')}</span>
                      </span>
                    </label>
                    {wfRedlines ? (
                      <div className={styles.wfOptionBody}>
                        <span className={styles.label}>{t('workflow.minSeverity')}</span>
                        <span className={styles.auditSelectWrap} style={{ display: 'flex', maxWidth: 220 }}>
                          <select
                            className={styles.auditFilter}
                            style={{ width: '100%' }}
                            aria-label={t('workflow.minSeverity')}
                            value={wfSeverity}
                            onChange={(e) => setWfSeverity(e.target.value as Severity)}
                          >
                            <option value="High">{t('sev.High')}</option>
                            <option value="Medium">{t('sev.Medium')}</option>
                            <option value="Low">{t('sev.Low')}</option>
                          </select>
                          <Icon name="chevron" size={14} className={styles.auditSelectChevron} />
                        </span>
                      </div>
                    ) : null}
                  </div>

                  <div className={`${styles.wfOption} ${wfApproval ? styles.wfOptionOn : ''}`}>
                    <label className={styles.wfOptionHead}>
                      <input
                        type="checkbox"
                        className={styles.wfCheck}
                        checked={wfApproval}
                        onChange={(e) => setWfApproval(e.target.checked)}
                      />
                      <span className={styles.wfOptionText}>
                        <span className={styles.wfOptionTitle}>{t('workflow.stepApproval')}</span>
                        <span className={styles.wfOptionDesc}>{t('workflow.stepApprovalDesc')}</span>
                      </span>
                    </label>
                    {wfApproval ? (
                      <div className={styles.wfOptionBody}>
                        <ApproverStepsEditor steps={wfApprovers} setSteps={setWfApprovers} />
                      </div>
                    ) : null}
                  </div>
                </div>
                {wfError ? <p style={{ color: 'var(--danger)', fontSize: 13, margin: '10px 0 0' }}>{wfError}</p> : null}
              </Modal>

              <section className={styles.section} style={{ marginTop: 24 }}>
                <h2 className={styles.sectionTitle} style={{ marginBottom: 14 }}>
                  {t('ws.versionsTitle')}
                </h2>
                {versionsError ? (
                  // Plan gate / network error — never present it as "no versions".
                  <p style={{ margin: 0, fontSize: 14, color: 'var(--dim)' }}>{versionsError}</p>
                ) : (versions ?? []).length === 0 ? (
                  <p style={{ margin: 0, fontSize: 14, color: 'var(--dim)' }}>{t('ws.noVersions')}</p>
                ) : (
                  (versions ?? []).map((v) => (
                    <div key={v.id} className={styles.versionRow}>
                      <span className={styles.versionDot} />
                      <div>
                        <div className={styles.versionLabel}>{v.label}</div>
                        <div className={styles.versionMeta}>
                          {v.author} · {formatDate(v.createdAt)}
                        </div>
                        <div className={styles.versionNote}>{v.note}</div>
                      </div>
                    </div>
                  ))
                )}
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
