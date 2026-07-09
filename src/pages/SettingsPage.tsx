import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { TopBar } from '@/components/layout/TopBar';
import { Icon } from '@/components/icons/Icon';
import { BrandLogo } from '@/components/icons/BrandLogos';
import { Button } from '@/components/ui/Button';
import { InitialsAvatar } from '@/components/ui/Avatar';
import { TextField } from '@/components/ui/TextField';
import { SkeletonRows } from '@/components/ui/States';
import { useAsync, useDismissable } from '@/hooks/useAsync';
import { billingApi, userApi } from '@/api';
import { authApi } from '@/api/auth.api';
import { integrationsApi, type CloudProvider } from '@/api/integrations.api';
import { USE_MOCK } from '@/api/client';
import { useUIStore } from '@/store/useUIStore';
import { useAuthStore } from '@/store/useAuthStore';
import { useI18n } from '@/i18n/I18nProvider';
import type { UserProfile } from '@/types/domain';
import styles from './pages.module.css';

/** OAuth returns already processed this session (claim grants are one-shot). */
const handledOAuthReturns = new Set<string>();

/** Primary-jurisdiction options: canonical English value + localized label. */
const JURISDICTIONS: { value: string; ru: string; en: string }[] = [
  { value: 'United States', ru: 'США', en: 'United States' },
  { value: 'United Kingdom', ru: 'Великобритания', en: 'United Kingdom' },
  { value: 'Germany', ru: 'Германия', en: 'Germany' },
  { value: 'Canada', ru: 'Канада', en: 'Canada' },
  { value: 'Kazakhstan', ru: 'Казахстан', en: 'Kazakhstan' },
  { value: 'Uzbekistan', ru: 'Узбекистан', en: 'Uzbekistan' },
];

/** Account settings. The profile form is fully validated. */
export function SettingsPage() {
  const { t, lang } = useI18n();
  const navigate = useNavigate();
  const pushToast = useUIStore((s) => s.pushToast);
  const authUser = useAuthStore((s) => s.user);
  const updateProfile = useAuthStore((s) => s.updateProfile);
  const adoptSession = useAuthStore((s) => s.adoptSession);
  const logout = useAuthStore((s) => s.logout);
  const fileRef = useRef<HTMLInputElement>(null);

  const { data, loading } = useAsync((signal) => userApi.me(signal), []);
  const limits = useAsync((signal) => billingApi.limits(signal), []);
  const integrations = useAsync((signal) => integrationsApi.list(signal), []);
  const [integrationBusy, setIntegrationBusy] = useState<CloudProvider | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();

  // Back from the provider's OAuth screen: claim the one-time grant with our
  // own auth (activates the connection), then show the outcome and clean the URL.
  useEffect(() => {
    const status = searchParams.get('status');
    const claim = searchParams.get('claim');
    if (!searchParams.get('integration') || !status) return;
    // A remount must not re-process the same return (the grant is one-shot —
    // a second claim would 404 and flash a bogus error toast).
    const marker = `${status}:${claim ?? ''}`;
    if (handledOAuthReturns.has(marker)) return;
    handledOAuthReturns.add(marker);
    setSearchParams({}, { replace: true });
    if (status === 'claim' && claim) {
      integrationsApi
        .claim(claim)
        .then(() => {
          pushToast(t('integr.connected'), 'success');
          integrations.reload();
        })
        .catch((err) => pushToast(err instanceof Error && err.message ? err.message : t('integr.connectFailed'), 'error'));
      return;
    }
    pushToast(t(status === 'connected' ? 'integr.connected' : 'integr.connectFailed'), status === 'connected' ? 'success' : 'error');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const connectIntegration = async (provider: CloudProvider) => {
    setIntegrationBusy(provider);
    try {
      const { url } = await integrationsApi.connectUrl(provider);
      window.location.href = url; // the provider redirects back to /settings
    } catch (err) {
      pushToast(err instanceof Error && err.message ? err.message : t('common.error'), 'error');
      setIntegrationBusy(null);
    }
  };

  const disconnectIntegration = async (provider: CloudProvider) => {
    setIntegrationBusy(provider);
    try {
      await integrationsApi.disconnect(provider);
      integrations.reload();
      pushToast(t('integr.disconnected'), 'default');
    } catch (err) {
      pushToast(err instanceof Error && err.message ? err.message : t('common.error'), 'error');
    } finally {
      setIntegrationBusy(null);
    }
  };

  const [form, setForm] = useState<UserProfile | null>(null);
  const [errors, setErrors] = useState<Partial<Record<keyof UserProfile, string>>>({});
  const [saving, setSaving] = useState(false);

  // Email is locked in the profile; the eye toggles between mask and value.
  const [emailVisible, setEmailVisible] = useState(false);

  // Animated jurisdiction dropdown (same look as the other profile fields).
  const [jurisOpen, setJurisOpen] = useState(false);
  const jurisRef = useDismissable<HTMLDivElement>(() => setJurisOpen(false), jurisOpen);
  const maskEmail = (email: string) => {
    const [local, domain] = email.split('@');
    if (!domain) return '•'.repeat(Math.max(email.length, 6));
    return `${'•'.repeat(Math.min(Math.max(local.length, 4), 10))}@${domain}`;
  };

  const jurisLabel = (value: string) => {
    const match = JURISDICTIONS.find((j) => j.value === value);
    return match ? (lang === 'ru' ? match.ru : match.en) : value;
  };

  // Security card state.
  const [curPass, setCurPass] = useState('');
  const [newPass, setNewPass] = useState('');
  const [newPass2, setNewPass2] = useState('');
  const [passBusy, setPassBusy] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState('');
  const [deleteBusy, setDeleteBusy] = useState(false);

  useEffect(() => {
    if (data) setForm(data);
  }, [data]);

  if (loading || !form) {
    return (
      <div className={styles.page}>
        <TopBar title={t('settings.title')} />
        <div style={{ padding: '24px 32px' }}>
          <SkeletonRows rows={6} height={56} />
        </div>
      </div>
    );
  }

  const update = (patch: Partial<UserProfile>) => setForm((f) => (f ? { ...f, ...patch } : f));

  const validate = (): boolean => {
    const next: Partial<Record<keyof UserProfile, string>> = {};
    if (!form.name.trim()) next.name = t('settings.errName');
    if (!form.firm.trim()) next.firm = t('settings.errFirm');
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const save = async () => {
    if (!validate()) return;
    setSaving(true);
    try {
      const saved = await userApi.update(form);
      updateProfile(saved); // keep the rail footer / auth session in sync
      pushToast(t('settings.saved'), 'success');
    } catch {
      pushToast(t('settings.saveFailed'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const onAvatarFile = (file: File | undefined) => {
    if (!file) return;
    if (!/\.(png|jpe?g|webp)$/i.test(file.name) || file.size > 2 * 1024 * 1024) {
      pushToast(t('settings.avatarHint'), 'error');
      return;
    }
    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = String(reader.result);
      try {
        await userApi.update({ avatarUrl: dataUrl }); // persist server-side
        updateProfile({ avatarUrl: dataUrl });
        pushToast(t('common.save'), 'success');
      } catch {
        pushToast(t('settings.photoFailed'), 'error');
      }
    };
    reader.readAsDataURL(file);
  };

  const removeAvatar = async () => {
    try {
      await userApi.update({ avatarUrl: '' }); // '' clears it server-side
      updateProfile({ avatarUrl: undefined });
    } catch {
      pushToast(t('settings.photoRemoveFailed'), 'error');
    }
  };

  const formatMb = (mb: number) => (mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb)} MB`);

  const changePassword = async () => {
    if (newPass.length < 8) {
      pushToast(t('auth.errPassword'), 'error');
      return;
    }
    if (newPass !== newPass2) {
      pushToast(t('settings.passwordMismatch'), 'error');
      return;
    }
    setPassBusy(true);
    try {
      if (!USE_MOCK) {
        const session = await authApi.changePassword(curPass, newPass);
        adoptSession(session.token, session.user); // old tokens are now invalid
      }
      setCurPass('');
      setNewPass('');
      setNewPass2('');
      pushToast(t('settings.passwordChanged'), 'success');
    } catch (err) {
      pushToast(err instanceof Error ? err.message : t('common.error'), 'error');
    } finally {
      setPassBusy(false);
    }
  };

  const deleteAccount = async () => {
    setDeleteBusy(true);
    try {
      if (!USE_MOCK) await authApi.deleteAccount(deleteConfirm.trim());
      pushToast(t('settings.deleted'), 'default');
      logout();
      navigate('/login', { replace: true });
    } catch (err) {
      pushToast(err instanceof Error ? err.message : t('common.error'), 'error');
    } finally {
      setDeleteBusy(false);
    }
  };

  return (
    <div className={styles.page}>
      <TopBar title={t('settings.title')} />
      <div className={`${styles.body} scroll`}>
        <div className={styles.container}>
          <div className={styles.pageHead}>
            <h1 className={styles.pageTitle}>{t('settings.title')}</h1>
            <p className={styles.pageSub}>{t('settings.sub')}</p>
          </div>

          <div className={styles.settingsGrid}>
            {/* Profile ------------------------------------------------------ */}
            <section className={styles.section}>
              <h2 className={styles.sectionTitle}>{t('settings.profile')}</h2>
              <p className={styles.sectionSub}>{t('settings.profileSub')}</p>

              <div className={styles.avatarRow}>
                <InitialsAvatar initials={authUser?.initials ?? form.initials} size={56} src={authUser?.avatarUrl} />
                <div>
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    style={{ display: 'none' }}
                    onChange={(e) => onAvatarFile(e.target.files?.[0])}
                  />
                  <div style={{ display: 'flex', gap: 8 }}>
                    <Button variant="secondary" size="sm" icon="upload" onClick={() => fileRef.current?.click()}>
                      {t('settings.avatarUpload')}
                    </Button>
                    {authUser?.avatarUrl ? (
                      <Button variant="ghost" size="sm" onClick={removeAvatar}>
                        {t('settings.avatarRemove')}
                      </Button>
                    ) : null}
                  </div>
                  <div className={styles.avatarHint}>{t('settings.avatarHint')}</div>
                </div>
              </div>

              <div className={styles.formRow}>
                <TextField
                  label={t('auth.name')}
                  name="name"
                  value={form.name}
                  error={errors.name}
                  onChange={(e) => update({ name: e.target.value, initials: initialsOf(e.target.value) })}
                />
                <TextField
                  label={t('settings.organisation')}
                  name="firm"
                  value={form.firm}
                  error={errors.firm}
                  onChange={(e) => update({ firm: e.target.value })}
                />
              </div>
              <div className={styles.formRow}>
                <div className={styles.jurisField}>
                  <span className={styles.jurisLabel}>{t('auth.email')}</span>
                  <div className={styles.emailLock} aria-readonly="true">
                    <span className={styles.emailLockText}>
                      {emailVisible ? form.email : maskEmail(form.email)}
                    </span>
                    <button
                      type="button"
                      className={styles.emailLockEye}
                      aria-label={emailVisible ? t('settings.emailHide') : t('settings.emailShow')}
                      title={emailVisible ? t('settings.emailHide') : t('settings.emailShow')}
                      onClick={() => setEmailVisible((v) => !v)}
                    >
                      <Icon name={emailVisible ? 'eyeOff' : 'eye'} size={17} />
                    </button>
                  </div>
                  <span className={styles.emailLockHint}>{t('settings.emailLocked')}</span>
                </div>
                <div className={styles.jurisField}>
                  <span className={styles.jurisLabel} id="jurisdiction-label">
                    {t('settings.jurisdiction')}
                  </span>
                  <div className={styles.jurisWrap} ref={jurisRef}>
                    <button
                      type="button"
                      className={styles.jurisSelect}
                      aria-haspopup="listbox"
                      aria-expanded={jurisOpen}
                      aria-labelledby="jurisdiction-label"
                      onClick={() => setJurisOpen((v) => !v)}
                    >
                      <span className={styles.jurisName}>{jurisLabel(form.jurisdiction)}</span>
                      <span className={`${styles.jurisChevron} ${jurisOpen ? styles.jurisChevronOpen : ''}`}>
                        <Icon name="chevron" size={14} />
                      </span>
                    </button>
                    {jurisOpen ? (
                      <div className={styles.jurisMenu} role="listbox">
                        {JURISDICTIONS.map((j) => (
                          <button
                            key={j.value}
                            type="button"
                            role="option"
                            aria-selected={form.jurisdiction === j.value}
                            className={`${styles.jurisOption} ${form.jurisdiction === j.value ? styles.jurisOptionActive : ''}`}
                            onClick={() => {
                              update({ jurisdiction: j.value });
                              setJurisOpen(false);
                            }}
                          >
                            <span className={styles.jurisName}>{lang === 'ru' ? j.ru : j.en}</span>
                            {form.jurisdiction === j.value ? (
                              <span className={styles.jurisCheck}>
                                <Icon name="check" size={14} />
                              </span>
                            ) : null}
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>

              <div className={styles.formActions}>
                <Button variant="primary" onClick={save} disabled={saving}>
                  {saving ? t('common.loading') : t('common.save')}
                </Button>
              </div>
            </section>

            {/* Plan & limits ------------------------------------------------ */}
            <section className={styles.section}>
              <h2 className={styles.sectionTitle}>{t('settings.plan')}</h2>
              <p className={styles.sectionSub}>{t('settings.planSub')}</p>

              {limits.data ? (
                <>
                  <div className={styles.planLine}>
                    <span className={styles.planLineName}>
                      <Icon name="diamond" size={15} color="var(--accent)" strokeWidth={2.2} />
                      {limits.data.plan}
                    </span>
                    <Button size="sm" iconRight="chevron" onClick={() => navigate('/plans')}>
                      {t('settings.changePlan')}
                    </Button>
                  </div>

                  <LimitRow
                    label={t('limits.ai')}
                    metric={limits.data.aiRequests}
                    format={(n) => String(Math.round(n))}
                    unlimitedLabel={t('limits.unlimited')}
                  />
                  <LimitRow
                    label={t('limits.docs')}
                    metric={limits.data.documents}
                    format={(n) => String(Math.round(n))}
                    unlimitedLabel={t('limits.unlimited')}
                  />
                  <LimitRow
                    label={t('limits.storage')}
                    metric={limits.data.storageMb}
                    format={formatMb}
                    unlimitedLabel={t('limits.unlimited')}
                  />
                </>
              ) : (
                <div style={{ padding: '24px 32px' }}>
          <SkeletonRows rows={6} height={56} />
        </div>
              )}
            </section>

            {/* Integrations -------------------------------------------------- */}
            <section className={styles.section}>
              <h2 className={styles.sectionTitle}>{t('integr.title')}</h2>
              <p className={styles.sectionSub}>{t('integr.sub')}</p>

              <div className={styles.integrList}>
                {(integrations.data ?? []).map((integ) => (
                  <div key={integ.provider} className={styles.integrRow}>
                    <span className={styles.integrIcon}>
                      <BrandLogo provider={integ.provider} size={24} />
                    </span>
                    <div className={styles.integrText}>
                      <span className={styles.integrName}>{integ.label}</span>
                      <span className={styles.integrStatus}>
                        {integ.connected
                          ? `${t('integr.statusConnected')}${integ.accountEmail ? ` · ${integ.accountEmail}` : ''}`
                          : integ.configured
                            ? t('integr.statusOff')
                            : t('integr.statusSoon')}
                      </span>
                    </div>
                    {integ.connected ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        className={styles.integrBtn}
                        disabled={integrationBusy === integ.provider}
                        onClick={() => void disconnectIntegration(integ.provider)}
                      >
                        {integrationBusy === integ.provider ? t('common.loading') : t('integr.disconnect')}
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="secondary"
                        icon="cloud"
                        className={styles.integrBtn}
                        disabled={integrationBusy === integ.provider || !integ.configured}
                        onClick={() => void connectIntegration(integ.provider)}
                      >
                        {integrationBusy === integ.provider ? t('common.loading') : t('integr.connect')}
                      </Button>
                    )}
                  </div>
                ))}
              </div>
              <p className={styles.integrHint}>{t('integr.hint')}</p>
            </section>

            {/* Security ------------------------------------------------------ */}
            <section className={styles.section}>
              <h2 className={styles.sectionTitle}>{t('settings.security')}</h2>
              <p className={styles.sectionSub}>{t('settings.securitySub')}</p>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <TextField
                  label={t('settings.currentPassword')}
                  name="currentPassword"
                  type="password"
                  autoComplete="current-password"
                  value={curPass}
                  onChange={(e) => setCurPass(e.target.value)}
                />
                <div className={styles.formRow}>
                  <TextField
                    label={t('settings.newPassword')}
                    name="newPassword"
                    type="password"
                    autoComplete="new-password"
                    value={newPass}
                    onChange={(e) => setNewPass(e.target.value)}
                  />
                  <TextField
                    label={t('settings.confirmPassword')}
                    name="newPassword2"
                    type="password"
                    autoComplete="new-password"
                    value={newPass2}
                    onChange={(e) => setNewPass2(e.target.value)}
                  />
                </div>
                <div>
                  <Button variant="primary" icon="shield" disabled={passBusy || !curPass || !newPass} onClick={() => void changePassword()}>
                    {passBusy ? t('common.loading') : t('settings.changePassword')}
                  </Button>
                </div>
              </div>

              <div className={styles.dangerZone}>
                <div className={styles.dangerTitle}>
                  <Icon name="alert" size={15} color="var(--danger)" />
                  {t('settings.deleteAccount')}
                </div>
                <p className={styles.dangerText}>{t('settings.deleteWarn')}</p>
                <TextField
                  label={t('settings.deleteConfirmLabel')}
                  name="deleteConfirm"
                  autoComplete="off"
                  placeholder={authUser?.email ?? ''}
                  value={deleteConfirm}
                  onChange={(e) => setDeleteConfirm(e.target.value)}
                />
                <div style={{ marginTop: 12 }}>
                  <Button
                    icon="trash"
                    className={styles.dangerBtn}
                    disabled={deleteBusy || deleteConfirm.trim().toLowerCase() !== (authUser?.email ?? '').toLowerCase()}
                    onClick={() => void deleteAccount()}
                  >
                    {deleteBusy ? t('common.loading') : t('settings.deleteAccount')}
                  </Button>
                </div>
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}

function LimitRow({
  label,
  metric,
  format,
  unlimitedLabel,
}: {
  label: string;
  metric: { used: number; limit: number | null };
  format: (n: number) => string;
  unlimitedLabel: string;
}) {
  const unlimited = metric.limit === null;
  const pct = unlimited ? 0 : Math.min(100, (metric.used / (metric.limit as number)) * 100);
  return (
    <div className={styles.limitRow}>
      <div className={styles.limitHead}>
        <span>{label}</span>
        <span className={styles.limitValue}>
          {unlimited ? `${format(metric.used)} · ${unlimitedLabel}` : `${format(metric.used)} / ${format(metric.limit as number)}`}
        </span>
      </div>
      <div className={styles.limitBar}>
        <div
          className={styles.limitFill}
          style={
            unlimited
              ? { width: '100%', opacity: 0.22 }
              : { width: `${pct}%`, background: pct >= 90 ? 'var(--danger)' : 'var(--accent)' }
          }
        />
      </div>
    </div>
  );
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
