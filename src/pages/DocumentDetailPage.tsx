import { useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { TopBar } from '@/components/layout/TopBar';
import { Icon } from '@/components/icons/Icon';
import { Badge, RiskBadge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { ErrorState, SkeletonRows } from '@/components/ui/States';
import { SendForSignatureModal } from '@/components/workspace/SendForSignatureModal';
import { useAsync, clearAsyncCache } from '@/hooks/useAsync';
import { analysisApi, documentsApi, versionsApi } from '@/api';
import { approvalsApi, type NewApprovalStep } from '@/api/approvals.api';
import { billingApi } from '@/api/billing.api';
import { TextField } from '@/components/ui/TextField';
import { DatePicker } from '@/components/ui/DatePicker';
import { RoleSelect } from '@/components/ui/RoleSelect';
import { useChatStore } from '@/store/useChatStore';
import { useUIStore } from '@/store/useUIStore';
import { useI18n } from '@/i18n/I18nProvider';
import type { ContractStatus } from '@/types/domain';
import styles from './pages.module.css';

const STATUS_TONE: Record<ContractStatus, string> = {
  Draft: 'var(--mut)',
  'In review': 'var(--sev-med)',
  Reviewed: 'var(--accent)',
  Signed: 'var(--sev-low)',
};

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
  const { data: versions } = useAsync((signal) => versionsApi.list(id, signal), [id]);
  const approvals = useAsync((signal) => approvalsApi.forDocument(id, signal), [id]);
  const { data: limits } = useAsync((signal) => billingApi.limits(signal), []);

  const flow = (approvals.data ?? [])[0] ?? null;
  const planAllowsApprovals = ['Pro', 'Business', 'Enterprise'].includes(limits?.plan ?? '');

  // Create-approval modal state. Steps carry a stable key (so removing one
  // doesn't leak select state into its neighbour) and the deadline as a plain
  // local day — it becomes an ISO timestamp only on submit (no TZ off-by-one).
  interface StepDraft {
    key: number;
    name: string;
    email: string;
    role: string;
    day: string | null;
  }
  const stepKeyRef = useRef(0);
  const emptyStep = (): StepDraft => ({ key: ++stepKeyRef.current, name: '', email: '', role: '', day: null });
  const [apprOpen, setApprOpen] = useState(false);
  const [apprSteps, setApprSteps] = useState<StepDraft[]>(() => [emptyStep()]);
  const [apprBusy, setApprBusy] = useState(false);
  const [apprError, setApprError] = useState<string | null>(null);

  const updateStep = (key: number, patch: Partial<StepDraft>) =>
    setApprSteps((s) => s.map((x) => (x.key === key ? { ...x, ...patch } : x)));

  const startApproval = () => {
    if (!planAllowsApprovals) {
      pushToast(t('appr.upgrade'), 'error');
      navigate('/plans');
      return;
    }
    setApprSteps([emptyStep()]);
    setApprError(null);
    setApprOpen(true);
  };

  const submitApproval = async () => {
    const cleaned: NewApprovalStep[] = apprSteps
      .map((s) => ({
        name: s.name.trim(),
        email: s.email.trim(),
        role: s.role.trim() || undefined,
        // 18:00 local time on the picked day.
        dueAt: s.day ? new Date(`${s.day}T18:00:00`).toISOString() : undefined,
      }))
      .filter((s) => s.name || s.email);
    if (cleaned.length === 0 || cleaned.some((s) => !s.name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.email))) {
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
      const blob = await documentsApi.exportFile(doc.id, 'docx');
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${doc.name.replace(/\.[^.]+$/, '') || 'document'}.docx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
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
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  {apprSteps.map((s, i) => (
                    <div key={s.key} className={styles.apprStepForm}>
                      <div className={styles.apprStepFormHead}>
                        <span className={styles.apprStepNum}>{t('appr.stepN', { n: i + 1 })}</span>
                        {apprSteps.length > 1 ? (
                          <button type="button" className={styles.apprRemove} onClick={() => setApprSteps((x) => x.filter((step) => step.key !== s.key))}>
                            <Icon name="x" size={14} />
                          </button>
                        ) : null}
                      </div>
                      <div className={styles.formRow}>
                        <TextField placeholder={t('appr.name')} value={s.name} onChange={(e) => updateStep(s.key, { name: e.target.value })} />
                        <TextField placeholder="email@company.com" type="email" value={s.email} onChange={(e) => updateStep(s.key, { email: e.target.value })} />
                      </div>
                      <div className={styles.formRow}>
                        <RoleSelect
                          ariaLabel={t('appr.role')}
                          value={s.role}
                          onChange={(role) => updateStep(s.key, { role })}
                        />
                        <DatePicker
                          ariaLabel={t('appr.deadline')}
                          placeholder={t('appr.deadline')}
                          value={s.day}
                          onChange={(day) => updateStep(s.key, { day })}
                        />
                      </div>
                    </div>
                  ))}
                </div>
                {apprError ? <p style={{ color: 'var(--danger)', fontSize: 13, margin: '10px 0 0' }}>{apprError}</p> : null}
                {apprSteps.length < 10 ? (
                  <button type="button" className={styles.apprAdd} onClick={() => setApprSteps((x) => [...x, emptyStep()])}>
                    <Icon name="plus" size={15} /> {t('appr.addStep')}
                  </button>
                ) : null}
              </Modal>

              <section className={styles.section} style={{ marginTop: 24 }}>
                <h2 className={styles.sectionTitle} style={{ marginBottom: 14 }}>
                  {t('ws.versionsTitle')}
                </h2>
                {(versions ?? []).length === 0 ? (
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
