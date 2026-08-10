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
import { usePageTitle } from '@/hooks/usePageTitle';
import { useReveal } from '@/hooks/useReveal';
import { billingApi, securityApi, userApi } from '@/api';
import type { TwoFactorSetup } from '@/api';
import { authApi } from '@/api/auth.api';
import { ApiError } from '@/api/util';
import { integrationsApi, type CloudProvider } from '@/api/integrations.api';
import { webhooksApi, type WebhookProvider } from '@/api/growth.api';
import { USE_MOCK } from '@/api/client';
import { useUIStore } from '@/store/useUIStore';
import { useAuthStore } from '@/store/useAuthStore';
import { useI18n } from '@/i18n/I18nProvider';
import { localeFor } from '@/i18n/dates';
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
  { value: 'United Arab Emirates', ru: 'ОАЭ', en: 'United Arab Emirates' },
];

/** Account settings. The profile form is fully validated. */
export function SettingsPage() {
  const { t, lang } = useI18n();
  const navigate = useNavigate();
  const pushToast = useUIStore((s) => s.pushToast);
  usePageTitle(t('nav.settings'));
  const authUser = useAuthStore((s) => s.user);
  const updateProfile = useAuthStore((s) => s.updateProfile);
  const adoptSession = useAuthStore((s) => s.adoptSession);
  const logout = useAuthStore((s) => s.logout);
  const fileRef = useRef<HTMLInputElement>(null);
  // Появление заголовка — хук зовётся до раннего return (скелет загрузки).
  const headReveal = useReveal<HTMLDivElement>();

  const { data, loading } = useAsync((signal) => userApi.me(signal), []);
  const limits = useAsync((signal) => billingApi.limits(signal), []);
  const sub = useAsync((signal) => billingApi.subscription(signal), []);
  const integrations = useAsync((signal) => integrationsApi.list(signal), []);
  // Почта: тумблер понедельничной сводки + адрес приёма договоров.
  const digest = useAsync((signal) => userApi.digest(signal), []);
  const intake = useAsync((signal) => userApi.intake(signal), []);
  const [digestBusy, setDigestBusy] = useState(false);
  const toggleDigest = async () => {
    if (!digest.data || digestBusy) return;
    setDigestBusy(true);
    try {
      await userApi.setDigest(!digest.data.enabled);
      digest.reload();
      pushToast(t('settings.saved'), 'success');
    } catch (err) {
      pushToast(err instanceof Error && err.message ? err.message : t('common.error'), 'error');
    } finally {
      setDigestBusy(false);
    }
  };
  const [integrationBusy, setIntegrationBusy] = useState<CloudProvider | null>(null);
  // Slack/Teams вебхуки: дубли уведомлений в мессенджер.
  const hooks = useAsync((signal) => webhooksApi.list(signal), []);
  const [hookEditing, setHookEditing] = useState<WebhookProvider | null>(null);
  const [hookUrl, setHookUrl] = useState('');
  const [hookBusy, setHookBusy] = useState(false);
  const saveHook = async (provider: WebhookProvider) => {
    if (hookBusy) return;
    setHookBusy(true);
    try {
      await webhooksApi.save(provider, hookUrl.trim());
      setHookEditing(null);
      setHookUrl('');
      hooks.reload();
      pushToast(t('hooks.saved'), 'success');
    } catch (err) {
      pushToast(err instanceof Error && err.message ? err.message : t('common.error'), 'error');
    } finally {
      setHookBusy(false);
    }
  };
  const removeHook = async (provider: WebhookProvider) => {
    if (hookBusy) return;
    setHookBusy(true);
    try {
      await webhooksApi.remove(provider);
      hooks.reload();
      pushToast(t('hooks.removed'), 'default');
    } catch (err) {
      pushToast(err instanceof Error && err.message ? err.message : t('common.error'), 'error');
    } finally {
      setHookBusy(false);
    }
  };
  const testHook = async (provider: WebhookProvider) => {
    if (hookBusy) return;
    setHookBusy(true);
    try {
      const { ok } = await webhooksApi.test(provider);
      pushToast(ok ? t('hooks.testOk') : t('hooks.testFail'), ok ? 'success' : 'error');
    } catch (err) {
      pushToast(err instanceof Error && err.message ? err.message : t('common.error'), 'error');
    } finally {
      setHookBusy(false);
    }
  };
  const [cancelConfirm, setCancelConfirm] = useState(false);
  const [cancelBusy, setCancelBusy] = useState(false);
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

  // Тихая фоновая ревалидация useAsync приносит НОВЫЙ объект data после
  // повторного захода — затирать ею форму, которую пользователь уже правит,
  // нельзя. Обновляем форму только пока она нетронута.
  const formDirty = useRef(false);
  useEffect(() => {
    if (data && !formDirty.current) setForm(data);
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

  const update = (patch: Partial<UserProfile>) => {
    formDirty.current = true;
    setForm((f) => (f ? { ...f, ...patch } : f));
  };

  const validate = (): boolean => {
    const next: Partial<Record<keyof UserProfile, string>> = {};
    if (!form.name.trim()) next.name = t('settings.errName');
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const save = async () => {
    if (!validate()) return;
    setSaving(true);
    try {
      // Аватар живёт своими операциями (onAvatarFile/removeAvatar) — из
      // сохранения профиля его выкидываем, иначе устаревший снимок формы
      // молча откатывал только что загруженное/удалённое фото.
      const { avatarUrl: _managedSeparately, ...profileFields } = form;
      void _managedSeparately;
      const saved = await userApi.update(profileFields);
      updateProfile(saved); // keep the rail footer / auth session in sync
      formDirty.current = false;
      setForm(saved);
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
        setForm((f) => (f ? { ...f, avatarUrl: dataUrl } : f)); // форма не должна помнить старое фото
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
      setForm((f) => (f ? { ...f, avatarUrl: undefined } : f));
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
          <div className={styles.pageHead} ref={headReveal}>
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
                {form.teamName ? (
                  // Named by the team owner/admin on the Team page — read-only here.
                  <div className={styles.jurisField}>
                    <span className={styles.jurisLabel}>{t('settings.organisation')}</span>
                    <div className={styles.emailLock} aria-readonly="true">
                      <span className={styles.emailLockText}>{form.teamName}</span>
                    </div>
                    <span className={styles.emailLockHint}>{t('settings.orgLocked')}</span>
                  </div>
                ) : null}
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
                    <span style={{ display: 'inline-flex', gap: 8 }}>
                      <Button size="sm" iconRight="chevron" onClick={() => navigate('/plans')}>
                        {t('settings.changePlan')}
                      </Button>
                    </span>
                  </div>

                  {/* Subscription status + cancellation (paid plans only). */}
                  {sub.data && sub.data.plan !== 'Free' ? (
                    <div className={styles.subStatus}>
                      {sub.data.status === 'past_due' ? (
                        <p className={styles.subStatusWarn}>
                          {t('settings.subPastDue', { date: sub.data.periodEnd ? new Date(sub.data.periodEnd).toLocaleDateString() : '' })}
                        </p>
                      ) : sub.data.cancelAtPeriodEnd ? (
                        <div className={styles.subStatusRow}>
                          <span className={styles.subStatusText}>
                            {t('settings.subCancelScheduled', { date: sub.data.periodEnd ? new Date(sub.data.periodEnd).toLocaleDateString() : '' })}
                          </span>
                          <Button
                            size="sm"
                            disabled={cancelBusy}
                            onClick={() => {
                              setCancelBusy(true);
                              billingApi
                                .revertCancel()
                                .then(() => {
                                  sub.reload();
                                  pushToast(t('settings.subResumed'), 'success');
                                })
                                .catch((e) => pushToast(e instanceof Error && e.message ? e.message : t('common.error'), 'error'))
                                .finally(() => setCancelBusy(false));
                            }}
                          >
                            {t('settings.subResume')}
                          </Button>
                        </div>
                      ) : (
                        <div className={styles.subStatusRow}>
                          <span className={styles.subStatusText}>
                            {t('settings.subActiveUntil', { date: sub.data.periodEnd ? new Date(sub.data.periodEnd).toLocaleDateString() : '' })}
                          </span>
                          {cancelConfirm ? (
                            <span className={styles.subCancelConfirm}>
                              <span className={styles.subCancelNote}>{t('settings.subCancelConfirm')}</span>
                              <button
                                className={styles.subCancelYes}
                                disabled={cancelBusy}
                                onClick={() => {
                                  setCancelBusy(true);
                                  billingApi
                                    .cancel()
                                    .then(() => {
                                      sub.reload();
                                      setCancelConfirm(false);
                                      pushToast(t('settings.subCancelled'), 'success');
                                    })
                                    .catch((e) => pushToast(e instanceof Error && e.message ? e.message : t('common.error'), 'error'))
                                    .finally(() => setCancelBusy(false));
                                }}
                              >
                                {t('settings.subCancelDo')}
                              </button>
                              <button className={styles.subCancelNo} disabled={cancelBusy} onClick={() => setCancelConfirm(false)}>
                                {t('common.cancel')}
                              </button>
                            </span>
                          ) : (
                            <button className={styles.subCancelLink} onClick={() => setCancelConfirm(true)}>
                              {t('settings.subCancel')}
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  ) : null}

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

            {/* Почта: дайджест + приём договоров по email --------------------- */}
            <section className={styles.section}>
              <h2 className={styles.sectionTitle}>{t('mail.title')}</h2>
              <p className={styles.sectionSub}>{t('mail.sub')}</p>

              <div className={styles.integrList}>
                <div className={styles.integrRow}>
                  <div className={styles.integrText}>
                    <span className={styles.integrName}>{t('mail.digest')}</span>
                    <span className={styles.integrStatus}>{t('mail.digestSub')}</span>
                  </div>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={digestBusy || !digest.data}
                    onClick={() => void toggleDigest()}
                  >
                    {digest.data?.enabled ? t('mail.digestOff') : t('mail.digestOn')}
                  </Button>
                </div>

                {/* Slack / Teams: дубли уведомлений в мессенджер команды. */}
                {(['slack', 'teams'] as const).map((provider) => {
                  const connected = (hooks.data ?? []).find((w) => w.provider === provider);
                  return (
                    <div key={provider} className={styles.integrRow}>
                      <div className={styles.integrText}>
                        <span className={styles.integrName}>{provider === 'slack' ? 'Slack' : 'Microsoft Teams'}</span>
                        <span className={styles.integrStatus}>
                          {connected ? `${t('hooks.connected')} · ${connected.maskedUrl}` : t('hooks.sub')}
                        </span>
                        {hookEditing === provider ? (
                          <span style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                            <span style={{ flex: 1, minWidth: 220 }}>
                              <TextField
                                aria-label={t('hooks.urlLabel')}
                                placeholder={provider === 'slack' ? 'https://hooks.slack.com/services/…' : 'https://….webhook.office.com/…'}
                                value={hookUrl}
                                onChange={(e) => setHookUrl(e.target.value)}
                              />
                            </span>
                            <Button size="sm" variant="secondary" disabled={hookBusy || hookUrl.trim().length < 20} onClick={() => void saveHook(provider)}>
                              {t('common.save')}
                            </Button>
                            <Button size="sm" onClick={() => setHookEditing(null)}>
                              {t('common.cancel')}
                            </Button>
                          </span>
                        ) : null}
                      </div>
                      {hookEditing === provider ? null : connected ? (
                        <span style={{ display: 'inline-flex', gap: 8 }}>
                          <Button size="sm" disabled={hookBusy} onClick={() => void testHook(provider)}>
                            {t('hooks.test')}
                          </Button>
                          <Button size="sm" variant="secondary" disabled={hookBusy} onClick={() => void removeHook(provider)}>
                            {t('hooks.disconnect')}
                          </Button>
                        </span>
                      ) : (
                        <Button size="sm" variant="secondary" onClick={() => { setHookEditing(provider); setHookUrl(''); }}>
                          {t('hooks.connect')}
                        </Button>
                      )}
                    </div>
                  );
                })}

                {intake.data?.enabled && intake.data.address ? (
                  <div className={styles.integrRow}>
                    <div className={styles.integrText}>
                      <span className={styles.integrName}>{t('mail.intake')}</span>
                      <span className={styles.integrStatus}>{t('mail.intakeSub')}</span>
                      <span className={styles.integrName} style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: 13 }}>
                        {intake.data.address}
                      </span>
                    </div>
                    <Button
                      size="sm"
                      onClick={() => {
                        void navigator.clipboard?.writeText(intake.data?.address ?? '');
                        pushToast(t('mail.intakeCopied'), 'success');
                      }}
                    >
                      {t('mail.intakeCopy')}
                    </Button>
                  </div>
                ) : null}
              </div>
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
                  <Button variant="secondary" icon="shield" disabled={passBusy || !curPass || !newPass} onClick={() => void changePassword()}>
                    {passBusy ? t('common.loading') : t('settings.changePassword')}
                  </Button>
                </div>
              </div>

              <TwoFactorSection />
              <SessionsSection />
              <DataExportSection />

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

/** Relative time in the interface language (falls back to the raw string). */
function relativeTime(iso: string | undefined, lang: string, fallback: string): string {
  if (!iso) return fallback;
  const ms = new Date(iso).getTime();
  if (Number.isNaN(ms)) return fallback;
  const rtf = new Intl.RelativeTimeFormat(localeFor(lang), { numeric: 'auto' });
  const minutes = Math.round((Date.now() - ms) / 60_000);
  if (minutes < 60) return rtf.format(-Math.max(minutes, 0), 'minute');
  const hours = Math.round(minutes / 60);
  if (hours < 24) return rtf.format(-hours, 'hour');
  return rtf.format(-Math.round(hours / 24), 'day');
}

/** Two-factor authentication (TOTP): enrol with an authenticator app, reveal
 *  the backup codes once, or disable with the account password. */
function TwoFactorSection() {
  const { t } = useI18n();
  const pushToast = useUIStore((s) => s.pushToast);
  const status = useAsync((signal) => securityApi.twofa.status(signal), []);
  const [setup, setSetup] = useState<TwoFactorSetup | null>(null);
  const [code, setCode] = useState('');
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null);
  const [disarming, setDisarming] = useState(false);
  const [arming, setArming] = useState(false);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  const copy = (text: string) => {
    void navigator.clipboard
      ?.writeText(text)
      .then(() => pushToast(t('sec.copied'), 'success'))
      .catch(() => undefined);
  };

  // Пароль запрашивается ДО начала настройки: включение 2FA — необратимая для
  // владельца операция, и тот, кто перехватил сессию, не должен привязать
  // второй фактор к своему телефону (аудит 2026-08-03).
  const begin = async () => {
    setBusy(true);
    try {
      setSetup(await securityApi.twofa.setup(password));
      setArming(false);
      setPassword('');
      setCode('');
    } catch (err) {
      const wrong = err instanceof ApiError && err.status === 401;
      pushToast(wrong ? t('sec.2fa.wrongPassword') : err instanceof Error && err.message ? err.message : t('common.error'), 'error');
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    setBusy(true);
    try {
      const r = await securityApi.twofa.enable(code.trim());
      setBackupCodes(r.backupCodes);
      setSetup(null);
      setCode('');
    } catch (err) {
      const wrong = err instanceof ApiError && err.status === 400;
      pushToast(wrong ? t('sec.2fa.invalidCode') : err instanceof Error && err.message ? err.message : t('common.error'), 'error');
    } finally {
      setBusy(false);
    }
  };

  const disable = async () => {
    setBusy(true);
    try {
      await securityApi.twofa.disable(password);
      setPassword('');
      setDisarming(false);
      pushToast(t('sec.2fa.disabled'), 'default');
      status.reload();
    } catch (err) {
      const wrong = err instanceof ApiError && err.status === 401;
      pushToast(wrong ? t('sec.2fa.wrongPassword') : err instanceof Error && err.message ? err.message : t('common.error'), 'error');
    } finally {
      setBusy(false);
    }
  };

  const grouped = (secret: string) => secret.replace(/(.{4})(?=.)/g, '$1 ');

  return (
    <div className={styles.secSub}>
      <h3 className={styles.secSubTitle}>{t('sec.2fa.title')}</h3>
      <p className={styles.secSubText}>{t('sec.2fa.sub')}</p>

      {backupCodes ? (
        <div className={styles.backupBox}>
          <div className={styles.backupWarn}>
            <Icon name="alert" size={15} color="var(--sev-med)" />
            <span>
              <strong>{t('sec.2fa.backupTitle')}</strong> — {t('sec.2fa.backupWarn')}
            </span>
          </div>
          <div className={styles.backupGrid}>
            {backupCodes.map((c) => (
              <code key={c} className={styles.backupCode}>
                {c}
              </code>
            ))}
          </div>
          <div className={styles.secActions}>
            <Button size="sm" variant="secondary" icon="copy" onClick={() => copy(backupCodes.join('\n'))}>
              {t('sec.2fa.copyCodes')}
            </Button>
            <Button size="sm" variant="secondary" icon="check" onClick={() => { setBackupCodes(null); status.reload(); }}>
              {t('sec.2fa.backupSaved')}
            </Button>
          </div>
        </div>
      ) : status.data?.enabled ? (
        <div>
          <span className={styles.secStatusOn}>
            <Icon name="shield" size={15} color="var(--sev-low)" />
            {t('sec.2fa.enabled')} · {t('sec.2fa.remaining', { n: status.data.backupCodesRemaining })}
          </span>
          {disarming ? (
            <div className={styles.secStack} style={{ marginTop: 12 }}>
              <TextField
                label={t('sec.2fa.passwordLabel')}
                name="disable2faPassword"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <div className={styles.secActions}>
                <Button size="sm" onClick={() => { setDisarming(false); setPassword(''); }}>
                  {t('common.cancel')}
                </Button>
                <Button size="sm" className={styles.dangerBtn} icon="shield" disabled={busy || !password} onClick={() => void disable()}>
                  {busy ? t('common.loading') : t('sec.2fa.confirmDisable')}
                </Button>
              </div>
            </div>
          ) : (
            <div style={{ marginTop: 12 }}>
              <Button size="sm" onClick={() => setDisarming(true)}>
                {t('sec.2fa.disable')}
              </Button>
            </div>
          )}
        </div>
      ) : setup ? (
        <div className={styles.secStack}>
          <p className={styles.secSubText} style={{ margin: 0 }}>{t('sec.2fa.setupIntro')}</p>
          <div className={styles.secKeyRow}>
            <span className={styles.label}>{t('sec.2fa.keyLabel')}</span>
            <code className={styles.secKey} onClick={() => copy(setup.secret)} title={t('sec.copyHint')}>
              {grouped(setup.secret)}
            </code>
          </div>
          <div className={styles.secKeyRow}>
            <span className={styles.label}>{t('sec.2fa.uriLabel')}</span>
            <code className={styles.secUri} onClick={() => copy(setup.otpauthUri)} title={t('sec.copyHint')}>
              {setup.otpauthUri}
            </code>
          </div>
          <TextField
            label={t('sec.2fa.codeLabel')}
            name="enable2faCode"
            inputMode="numeric"
            autoComplete="one-time-code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
          <div className={styles.secActions}>
            <Button size="sm" onClick={() => { setSetup(null); setCode(''); }}>
              {t('common.cancel')}
            </Button>
            <Button size="sm" variant="secondary" icon="check" disabled={busy || code.trim().length < 6} onClick={() => void confirm()}>
              {busy ? t('common.loading') : t('sec.2fa.confirm')}
            </Button>
          </div>
        </div>
      ) : arming ? (
        <div className={styles.secStack}>
          <TextField
            label={t('sec.2fa.passwordLabel')}
            name="enable2faPassword"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <div className={styles.secActions}>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setArming(false);
                setPassword('');
              }}
            >
              {t('common.cancel')}
            </Button>
            <Button size="sm" variant="secondary" icon="shield" disabled={busy || !password} onClick={() => void begin()}>
              {busy ? t('common.loading') : t('sec.2fa.enable')}
            </Button>
          </div>
        </div>
      ) : (
        <Button size="sm" variant="secondary" icon="shield" disabled={busy || status.loading} onClick={() => setArming(true)}>
          {busy ? t('common.loading') : t('sec.2fa.enable')}
        </Button>
      )}
    </div>
  );
}

/** Active sessions with a "sign out everywhere" that rotates the current token. */
function SessionsSection() {
  const { t, lang } = useI18n();
  const pushToast = useUIStore((s) => s.pushToast);
  const adoptSession = useAuthStore((s) => s.adoptSession);
  const sessions = useAsync((signal) => securityApi.sessions.list(signal), []);
  const [busy, setBusy] = useState(false);

  const revoke = async () => {
    setBusy(true);
    try {
      const rotated = await securityApi.sessions.revokeOthers();
      // Revoking rotates our own token — adopt it (same place login persists it)
      // or the next request signs us out.
      adoptSession(rotated.token, rotated.user);
      pushToast(t('sec.sessions.revoked'), 'success');
      sessions.reload();
    } catch (err) {
      pushToast(err instanceof Error && err.message ? err.message : t('common.error'), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.secSub}>
      <h3 className={styles.secSubTitle}>{t('sec.sessions.title')}</h3>
      <p className={styles.secSubText}>{t('sec.sessions.sub')}</p>

      {sessions.loading ? (
        <SkeletonRows rows={2} height={44} />
      ) : (
        <div className={styles.sessionList}>
          {(sessions.data ?? []).map((s) => (
            <div key={s.id} className={styles.sessionRow}>
              <Icon name="clock" size={16} color="var(--mut)" />
              <div className={styles.sessionText}>
                <span className={styles.sessionDevice}>{s.userAgent || t('sec.sessions.unknownDevice')}</span>
                <span className={styles.sessionMeta}>
                  {s.ip} · {relativeTime(s.lastSeenAt, lang, s.lastSeenAt)}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
      <div style={{ marginTop: 12 }}>
        <Button size="sm" icon="logout" disabled={busy} onClick={() => void revoke()}>
          {busy ? t('common.loading') : t('sec.sessions.signOutAll')}
        </Button>
      </div>
    </div>
  );
}

/** GDPR data portability: download the full account export as a JSON file. */
function DataExportSection() {
  const { t } = useI18n();
  const pushToast = useUIStore((s) => s.pushToast);
  const [busy, setBusy] = useState(false);

  const download = async () => {
    setBusy(true);
    try {
      await securityApi.exportData();
    } catch (err) {
      pushToast(err instanceof Error && err.message ? err.message : t('sec.export.failed'), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.secSub}>
      <h3 className={styles.secSubTitle}>{t('sec.export.title')}</h3>
      <p className={styles.secSubText}>{t('sec.export.sub')}</p>
      <Button size="sm" variant="secondary" icon="download" disabled={busy} onClick={() => void download()}>
        {busy ? t('common.loading') : t('sec.export.button')}
      </Button>
    </div>
  );
}
