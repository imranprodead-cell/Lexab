import { useState, useEffect, type FormEvent } from 'react';
import { TopBar } from '@/components/layout/TopBar';
import { InitialsAvatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { Button, IconButton } from '@/components/ui/Button';
import { Icon } from '@/components/icons/Icon';
import { GlassCard } from '@/components/ui/GlassCard';
import { TextField } from '@/components/ui/TextField';
import { RoleSelect, type RolePresetKey } from '@/components/ui/RoleSelect';
import { EmptyState, ErrorState, SkeletonRows } from '@/components/ui/States';
import { useAsync, clearAsyncCache } from '@/hooks/useAsync';
import { usePageTitle } from '@/hooks/usePageTitle';
import { ROLE_COLORS, teamApi, userApi, type TeamRole } from '@/api';
import { auditApi, type AuditEvent } from '@/api/audit.api';
import { ssoApi, type SsoConfig } from '@/api/sso.api';
import { ApiError } from '@/api/util';
import { useAuthStore } from '@/store/useAuthStore';
import { useUIStore } from '@/store/useUIStore';
import { useI18n } from '@/i18n/I18nProvider';
import { initialsOf } from '@/lib/format';
import styles from './pages.module.css';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ROLES: Exclude<TeamRole, 'owner'>[] = ['admin', 'editor', 'viewer'];

/** A picked job title implies sensible access rights (still adjustable). */
const PRESET_ACCESS: Record<RolePresetKey, Exclude<TeamRole, 'owner'>> = {
  admin: 'admin',
  owner: 'admin',
  editor: 'editor',
  lawyer: 'editor',
  viewer: 'viewer',
};

/** Team management: member list, invite-by-email, accept/decline invitations. */
export function TeamPage() {
  const { t } = useI18n();
  const pushToast = useUIStore((s) => s.pushToast);
  usePageTitle(t('nav.team'));

  const authUser = useAuthStore((s) => s.user);
  const members = useAsync((signal) => teamApi.members(signal), []);
  const invitations = useAsync((signal) => teamApi.invitations(signal), []);
  const profile = useAsync((signal) => userApi.me(signal), []);

  // Inviting is the owner's power; members of someone else's team only look.
  const canInvite = (members.data ?? []).length === 0 || (members.data ?? []).some((m) => m.manageable);

  // Organisation name: the owner (or an admin) sets it; members only see it.
  const teamName = profile.data?.teamName ?? null;
  const myRow = (members.data ?? []).find((m) => m.email.toLowerCase() === (authUser?.email ?? '').toLowerCase());
  const hasTeam = (members.data ?? []).length > 0;
  const canManageName = hasTeam && profile.data !== null && (canInvite || myRow?.roleKey === 'team.role.admin');
  const [editingName, setEditingName] = useState(false);
  const showNameForm = canManageName && (!teamName || editingName);
  const [orgName, setOrgName] = useState('');
  const [orgSaving, setOrgSaving] = useState(false);

  const saveOrgName = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = orgName.trim();
    if (trimmed.length < 2) return;
    setOrgSaving(true);
    try {
      await teamApi.setName(trimmed);
      clearAsyncCache(); // Settings and this page must pick the name up at once
      profile.reload();
      setEditingName(false);
      pushToast(t('team.orgSaved'), 'success');
    } catch (err) {
      pushToast(err instanceof Error && err.message ? err.message : t('common.error'), 'error');
    } finally {
      setOrgSaving(false);
    }
  };

  const [modalOpen, setModalOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<TeamRole>('editor');
  const [title, setTitle] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [answering, setAnswering] = useState<string | null>(null);

  const openModal = () => {
    setEmail('');
    setRole('editor');
    setTitle('');
    setFormError(null);
    setModalOpen(true);
  };

  const sendInvite = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = email.trim();
    if (!EMAIL_RE.test(trimmed)) {
      setFormError(t('auth.errEmail'));
      return;
    }
    setFormError(null);
    setSending(true);
    try {
      await teamApi.invite(trimmed, role, title.trim() || undefined);
      setModalOpen(false);
      pushToast(t('team.inviteSent'), 'success');
      members.reload();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : t('common.error'));
    } finally {
      setSending(false);
    }
  };

  const removeMember = async (id: string, pending: boolean) => {
    try {
      await teamApi.remove(id);
      pushToast(t(pending ? 'team.revoked' : 'team.removed'), 'default');
      members.reload();
    } catch (err) {
      pushToast(err instanceof Error ? err.message : t('common.error'), 'error');
    }
  };

  const copyInviteLink = async (token: string) => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/login?invite=${token}`);
      pushToast(t('team.inviteCopied'), 'success');
    } catch {
      pushToast(t('common.error'), 'error');
    }
  };

  const answerInvitation = async (id: string, accept: boolean) => {
    setAnswering(id);
    try {
      if (accept) await teamApi.accept(id);
      else await teamApi.decline(id);
      pushToast(t(accept ? 'team.acceptedToast' : 'team.declinedToast'), accept ? 'success' : 'default');
      invitations.reload();
    } catch (err) {
      pushToast(err instanceof Error ? err.message : t('common.error'), 'error');
    } finally {
      setAnswering(null);
    }
  };

  return (
    <div className={styles.page}>
      <TopBar title={t('team.title')} />
      <div className={`${styles.body} scroll`}>
        <div className={styles.container}>
          <div
            className={styles.pageHead}
            style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 16, flexWrap: 'wrap' }}
          >
            <div>
              <h1 className={styles.pageTitle} style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
                {teamName || t('team.title')}
                {teamName && canManageName && !editingName ? (
                  <button
                    type="button"
                    className={styles.orgEditBtn}
                    onClick={() => {
                      setOrgName(teamName);
                      setEditingName(true);
                    }}
                  >
                    {t('team.orgEdit')}
                  </button>
                ) : null}
              </h1>
              <p className={styles.pageSub}>{teamName ? `${t('team.title')} · ${t('team.sub')}` : t('team.sub')}</p>
            </div>
            {canInvite ? (
              <Button variant="primary" icon="plus" onClick={openModal}>
                {t('team.invite')}
              </Button>
            ) : null}
          </div>

          {/* Organisation naming / renaming (owner or admin only). */}
          {showNameForm ? (
            <GlassCard className={styles.inviteBanner}>
              <form onSubmit={saveOrgName} style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', width: '100%' }}>
                <div style={{ flex: 1, minWidth: 220 }}>
                  <TextField
                    placeholder={t('team.orgPh')}
                    name="orgName"
                    value={orgName}
                    autoComplete="off"
                    onChange={(e) => setOrgName(e.target.value)}
                  />
                </div>
                <Button type="submit" variant="primary" icon="check" disabled={orgSaving || orgName.trim().length < 2}>
                  {orgSaving ? t('common.loading') : t('team.orgSave')}
                </Button>
                {editingName ? (
                  <button type="button" className={styles.orgEditBtn} onClick={() => setEditingName(false)}>
                    {t('common.cancel')}
                  </button>
                ) : null}
                <p className={styles.modalHint} style={{ margin: 0, width: '100%' }}>{t('team.orgHint')}</p>
              </form>
            </GlassCard>
          ) : null}

          {/* Invitations addressed to me — join only after accepting. */}
          {(invitations.data ?? []).map((inv) => (
            <GlassCard key={inv.id} className={styles.inviteBanner}>
              <div className={styles.inviteBannerText}>
                {t('team.invitedYou', { name: inv.inviterName, firm: inv.inviterFirm })}
                {' · '}
                <Badge color={ROLE_COLORS[inv.role] ?? 'var(--mut)'} plain>
                  {inv.title || t(inv.roleKey)}
                </Badge>
              </div>
              <div className={styles.inviteBannerActions}>
                <Button
                  variant="primary"
                  size="sm"
                  icon="check"
                  disabled={answering === inv.id}
                  onClick={() => answerInvitation(inv.id, true)}
                >
                  {t('team.accept')}
                </Button>
                <Button size="sm" icon="x" disabled={answering === inv.id} onClick={() => answerInvitation(inv.id, false)}>
                  {t('team.decline')}
                </Button>
              </div>
            </GlassCard>
          ))}

          {members.loading ? (
            <SkeletonRows rows={5} height={56} />
          ) : members.error ? (
            <ErrorState message={members.error} onRetry={members.reload} />
          ) : (members.data ?? []).length === 0 ? (
            <EmptyState title={t('team.title')} body={t('team.inviteHint')} />
          ) : (
            <div className={styles.tableCard}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th className={styles.th}>{t('team.col.member')}</th>
                    <th className={styles.th}>{t('team.col.role')}</th>
                    <th className={`${styles.th} ${styles.hideSm}`}>{t('team.col.status')}</th>
                    <th className={styles.th} style={{ width: 120 }} aria-label={t('team.col.actions')} />
                  </tr>
                </thead>
                <tbody>
                  {(members.data ?? []).map((m) => {
                    const pending = m.statusKey === 'team.status.invited';
                    return (
                      <tr key={m.id}>
                        <td className={styles.td}>
                          <div className={styles.docCell}>
                            <InitialsAvatar initials={initialsOf(m.name)} size={34} />
                            <div style={{ minWidth: 0 }}>
                              <div className={styles.docCellName}>{m.name}</div>
                              <div className={styles.docCellSub}>{m.email}</div>
                            </div>
                          </div>
                        </td>
                        <td className={styles.td}>
                          {/* Role/title is display-only — same look as the status text. */}
                          <span className={styles.metaText}>{m.title || t(m.roleKey)}</span>
                        </td>
                        <td className={`${styles.td} ${styles.hideSm} ${styles.metaText}`}>{t(m.statusKey)}</td>
                        <td className={styles.td}>
                          <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                            {m.manageable && pending && m.inviteToken ? (
                              <IconButton
                                icon="docs"
                                label={t('team.copyInvite')}
                                size="sm"
                                iconSize={15}
                                onClick={() => void copyInviteLink(m.inviteToken as string)}
                              />
                            ) : null}
                            {m.manageable ? (
                              <IconButton
                                icon="trash"
                                label={pending ? t('team.revoke') : t('team.remove')}
                                size="sm"
                                iconSize={15}
                                onClick={() => void removeMember(m.id, pending)}
                              />
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* SSO + audit log — team owner tools (Business feature). */}
          {canInvite ? <SsoSettingsSection /> : null}
          {canInvite ? <AuditLogSection /> : null}
        </div>
      </div>

      {modalOpen ? (
        <div className={styles.modalOverlay} onMouseDown={(e) => e.target === e.currentTarget && setModalOpen(false)}>
          <GlassCard className={styles.modalCard}>
            <h2 className={styles.modalTitle}>{t('team.invite')}</h2>
            <form onSubmit={sendInvite} noValidate>
              <TextField
                label={t('team.inviteEmail')}
                name="inviteEmail"
                type="email"
                value={email}
                autoComplete="off"
                autoFocus
                onChange={(e) => setEmail(e.target.value)}
              />

              <span className={styles.modalLabel}>{t('team.inviteTitle')}</span>
              <RoleSelect
                ariaLabel={t('team.inviteTitle')}
                value={title}
                onChange={(v, presetKey) => {
                  setTitle(v);
                  if (presetKey) setRole(PRESET_ACCESS[presetKey]); // access follows the title
                }}
              />

              <span className={styles.modalLabel}>{t('team.inviteRole')}</span>
              <div className={styles.roleChips} role="radiogroup" aria-label={t('team.inviteRole')}>
                {ROLES.map((r) => (
                  <button
                    key={r}
                    type="button"
                    role="radio"
                    aria-checked={role === r}
                    className={`${styles.roleChip} ${role === r ? styles.roleChipActive : ''}`}
                    onClick={() => setRole(r)}
                  >
                    <span className={styles.roleDot} style={{ background: ROLE_COLORS[r] }} />
                    {t(`team.role.${r}`)}
                  </button>
                ))}
              </div>

              {formError ? <p className={styles.modalError}>{formError}</p> : null}
              <p className={styles.modalHint}>{t('team.inviteHint')}</p>

              <div className={styles.modalActions}>
                <Button type="button" onClick={() => setModalOpen(false)}>
                  {t('common.cancel')}
                </Button>
                <Button type="submit" variant="primary" icon="send" disabled={sending}>
                  {sending ? t('common.loading') : t('team.inviteSend')}
                </Button>
              </div>
            </form>
          </GlassCard>
        </div>
      ) : null}
    </div>
  );
}

/** SSO settings card (Business feature; team owner). Configure OIDC, verify the
 *  domain by DNS, then enable / enforce. A 402 shows an upsell. */
function SsoSettingsSection() {
  const { t } = useI18n();
  const pushToast = useUIStore((s) => s.pushToast);
  const [cfg, setCfg] = useState<SsoConfig | null>(null);
  const [locked, setLocked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ issuerUrl: '', clientId: '', clientSecret: '', emailDomain: '', defaultRole: 'viewer' as 'admin' | 'editor' | 'viewer' });

  const load = () => {
    ssoApi
      .get()
      .then((c) => {
        setCfg(c);
        setLocked(false);
        if (c.configured) {
          setForm((f) => ({ ...f, issuerUrl: c.issuerUrl ?? '', clientId: c.clientId ?? '', emailDomain: c.emailDomain ?? '', defaultRole: c.defaultRole ?? 'viewer' }));
        }
      })
      .catch((err) => {
        if (err instanceof ApiError && err.status === 402) setLocked(true);
        else pushToast(err instanceof Error && err.message ? err.message : t('common.error'), 'error');
      });
  };
  useEffect(load, [pushToast, t]);

  const copy = (text: string) => {
    void navigator.clipboard?.writeText(text).then(() => pushToast(t('sso.copied'), 'success')).catch(() => undefined);
  };

  const save = async () => {
    if (!form.issuerUrl || !form.clientId || !form.emailDomain || (!cfg?.secretSet && !form.clientSecret)) {
      pushToast(t('sso.fillAll'), 'error');
      return;
    }
    setBusy(true);
    try {
      await ssoApi.save({
        issuerUrl: form.issuerUrl.trim(),
        clientId: form.clientId.trim(),
        ...(form.clientSecret ? { clientSecret: form.clientSecret } : {}),
        emailDomain: form.emailDomain.trim(),
        defaultRole: form.defaultRole,
      });
      setForm((f) => ({ ...f, clientSecret: '' }));
      pushToast(t('sso.saved'), 'success');
      load();
    } catch (err) {
      pushToast(err instanceof Error && err.message ? err.message : t('common.error'), 'error');
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    setBusy(true);
    try {
      const r = await ssoApi.verifyDomain();
      pushToast(r.verified ? t('sso.verifyOk') : t('sso.verifyFail'), r.verified ? 'success' : 'error');
      load();
    } catch (err) {
      pushToast(err instanceof Error && err.message ? err.message : t('common.error'), 'error');
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (patch: { enabled?: boolean; enforceSso?: boolean }) => {
    setBusy(true);
    try {
      await ssoApi.toggle(patch);
      load();
    } catch (err) {
      pushToast(err instanceof Error && err.message ? err.message : t('common.error'), 'error');
    } finally {
      setBusy(false);
    }
  };

  if (locked) {
    return (
      <div className={styles.auditSection}>
        <h2 className={styles.auditTitle}>{t('sso.title')}</h2>
        <EmptyState icon="shield" title={t('sso.upsellTitle')} body={t('sso.upsellBody')} />
      </div>
    );
  }

  return (
    <div className={styles.auditSection}>
      <h2 className={styles.auditTitle}>{t('sso.title')}</h2>
      <p className={styles.sectionSub}>{t('sso.sub')}</p>
      <div className={styles.ssoForm}>
        <TextField label={t('sso.issuer')} name="ssoIssuer" value={form.issuerUrl} placeholder="https://accounts.google.com" onChange={(e) => setForm({ ...form, issuerUrl: e.target.value })} />
        <TextField label={t('sso.clientId')} name="ssoClientId" value={form.clientId} onChange={(e) => setForm({ ...form, clientId: e.target.value })} />
        <TextField label={cfg?.secretSet ? t('sso.clientSecretSet') : t('sso.clientSecret')} name="ssoClientSecret" type="password" value={form.clientSecret} placeholder={cfg?.secretSet ? '•••••• ' + t('sso.secretStored') : ''} onChange={(e) => setForm({ ...form, clientSecret: e.target.value })} />
        <TextField label={t('sso.domain')} name="ssoDomain" value={form.emailDomain} placeholder="acme.com" onChange={(e) => setForm({ ...form, emailDomain: e.target.value })} />
        <div>
          <span className={styles.modalLabel}>{t('sso.defaultRole')}</span>
          <div className={styles.roleChips} role="radiogroup">
            {ROLES.map((r) => (
              <button key={r} type="button" role="radio" aria-checked={form.defaultRole === r} className={`${styles.roleChip} ${form.defaultRole === r ? styles.roleChipActive : ''}`} onClick={() => setForm({ ...form, defaultRole: r })}>
                <span className={styles.roleDot} style={{ background: ROLE_COLORS[r] }} />
                {t(`team.role.${r}`)}
              </button>
            ))}
          </div>
        </div>
        <Button variant="primary" icon="check" disabled={busy} onClick={() => void save()}>
          {busy ? t('common.loading') : t('sso.save')}
        </Button>
      </div>

      {cfg?.configured ? (
        <div className={styles.ssoStatus}>
          <div className={styles.ssoStatusRow}>
            <span className={styles.subStatusText}>{t('sso.redirectUri')}</span>
            <code className={styles.ssoCode} onClick={() => copy(cfg.redirectUri)}>{cfg.redirectUri}</code>
          </div>
          <div className={styles.ssoStatusRow}>
            <span className={styles.subStatusText}>{t('sso.dnsRecord')}</span>
            <code className={styles.ssoCode} onClick={() => cfg.dnsRecord && copy(cfg.dnsRecord)}>{cfg.dnsRecord}</code>
          </div>
          <div className={styles.ssoStatusRow}>
            <span className={styles.subStatusText}>
              {t('sso.domainStatus')}: {cfg.domainVerified ? <Badge color="Low">{t('sso.verified')}</Badge> : <Badge color="Medium">{t('sso.unverified')}</Badge>}
            </span>
            {!cfg.domainVerified ? (
              <Button size="sm" disabled={busy} onClick={() => void verify()}>
                {t('sso.verifyDomain')}
              </Button>
            ) : null}
          </div>
          {cfg.domainVerified ? (
            <>
              <label className={styles.ssoToggle}>
                <input type="checkbox" checked={cfg.enabled ?? false} disabled={busy} onChange={(e) => void toggle({ enabled: e.target.checked })} />
                {t('sso.enable')}
              </label>
              <label className={styles.ssoToggle}>
                <input type="checkbox" checked={cfg.enforceSso ?? false} disabled={busy || !cfg.enabled} onChange={(e) => void toggle({ enforceSso: e.target.checked })} />
                {t('sso.enforce')}
              </label>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

const AUDIT_GROUPS = ['', 'auth', 'document', 'ai', 'team', 'billing', 'signature', 'security'];
const PAGE_SIZE = 20;

/** The team owner's audit trail. Business feature — a 402 shows an upsell. */
function AuditLogSection() {
  const { t } = useI18n();
  const pushToast = useUIStore((s) => s.pushToast);
  const [group, setGroup] = useState('');
  const [search, setSearch] = useState('');
  /** Debounced copy of `search`: the server is asked 300ms after typing stops. */
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState<AuditEvent[]>([]);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [locked, setLocked] = useState(false); // 402 → not on Business
  const [hasMore, setHasMore] = useState(false);

  useEffect(() => {
    const id = setTimeout(() => {
      setQuery((prev) => {
        const next = search.trim();
        if (next !== prev) setPage(1);
        return next;
      });
    }, 300);
    return () => clearTimeout(id);
  }, [search]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    auditApi
      .list({ group: group || undefined, q: query || undefined, page, pageSize: PAGE_SIZE })
      .then((data) => {
        if (cancelled) return;
        setRows((prev) => (page === 1 ? data : [...prev, ...data]));
        setHasMore(data.length === PAGE_SIZE);
        setLocked(false);
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 402) setLocked(true);
        else pushToast(err instanceof Error && err.message ? err.message : t('common.error'), 'error');
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [group, query, page, pushToast, t]);

  const exportCsv = async () => {
    try {
      const blob = await auditApi.downloadCsv({ group: group || undefined, q: query || undefined });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'audit-log.csv';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      pushToast(err instanceof Error && err.message ? err.message : t('common.error'), 'error');
    }
  };

  if (locked) {
    return (
      <div className={styles.auditSection}>
        <h2 className={styles.auditTitle}>{t('audit.title')}</h2>
        <EmptyState icon="shield" title={t('audit.upsellTitle')} body={t('audit.upsellBody')} />
      </div>
    );
  }

  return (
    <div className={styles.auditSection}>
      <div className={styles.auditHead}>
        <h2 className={styles.auditTitle}>{t('audit.title')}</h2>
        <div className={styles.auditControls}>
          <span className={styles.auditSearchWrap}>
            <Icon name="search" size={14} />
            <input
              type="search"
              className={styles.auditSearch}
              placeholder={t('audit.searchPlaceholder')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </span>
          <span className={styles.auditSelectWrap}>
            <select
              className={styles.auditFilter}
              value={group}
              onChange={(e) => {
                setPage(1);
                setGroup(e.target.value);
              }}
            >
              {AUDIT_GROUPS.map((g) => (
                <option key={g || 'all'} value={g}>
                  {g ? t(`audit.group.${g}`) : t('audit.allGroups')}
                </option>
              ))}
            </select>
            <Icon name="chevron" size={14} className={styles.auditSelectChevron} />
          </span>
          <Button size="sm" icon="download" onClick={exportCsv}>
            {t('audit.exportCsv')}
          </Button>
        </div>
      </div>

      {rows.length === 0 && !loading ? (
        <EmptyState icon="history" title={t('audit.empty')} />
      ) : (
        <div className={styles.tableCard}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={styles.th}>{t('audit.colTime')}</th>
                <th className={styles.th}>{t('audit.colActor')}</th>
                <th className={styles.th}>{t('audit.colEvent')}</th>
                <th className={`${styles.th} ${styles.hideSm}`}>{t('audit.colTarget')}</th>
                <th className={`${styles.th} ${styles.hideSm}`}>{t('audit.colIp')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className={`${styles.td} ${styles.metaText}`}>{new Date(r.at).toLocaleString()}</td>
                  <td className={styles.td}>{r.actor ?? '—'}</td>
                  <td className={styles.td}>
                    <span className={styles.auditType} data-status={r.status}>
                      {r.type}
                    </span>
                  </td>
                  <td className={`${styles.td} ${styles.hideSm}`}>{r.target ?? '—'}</td>
                  <td className={`${styles.td} ${styles.hideSm} ${styles.metaText}`}>{r.ip ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {hasMore ? (
        <div className={styles.auditMore}>
          <Button size="sm" disabled={loading} onClick={() => setPage((p) => p + 1)}>
            {loading ? t('common.loading') : t('audit.loadMore')}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
