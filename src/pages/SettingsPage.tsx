import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { TopBar } from '@/components/layout/TopBar';
import { Icon } from '@/components/icons/Icon';
import { Button } from '@/components/ui/Button';
import { InitialsAvatar } from '@/components/ui/Avatar';
import { TextField } from '@/components/ui/TextField';
import { LoadingState } from '@/components/ui/States';
import { useAsync } from '@/hooks/useAsync';
import { billingApi, userApi } from '@/api';
import { authApi } from '@/api/auth.api';
import { USE_MOCK } from '@/api/client';
import { ACCENT_OPTIONS, useUIStore } from '@/store/useUIStore';
import { useAuthStore } from '@/store/useAuthStore';
import { useI18n } from '@/i18n/I18nProvider';
import { LANGUAGES } from '@/i18n/messages';
import type { UserProfile } from '@/types/domain';
import styles from './pages.module.css';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const JURISDICTIONS = ['United Kingdom', 'European Union', 'United States', 'Singapore'];

/** Account + appearance settings. The profile form is fully validated. */
export function SettingsPage() {
  const { t, lang, setLang } = useI18n();
  const navigate = useNavigate();
  const pushToast = useUIStore((s) => s.pushToast);
  const authUser = useAuthStore((s) => s.user);
  const updateProfile = useAuthStore((s) => s.updateProfile);
  const adoptSession = useAuthStore((s) => s.adoptSession);
  const logout = useAuthStore((s) => s.logout);
  const fileRef = useRef<HTMLInputElement>(null);
  const accent = useUIStore((s) => s.accent);
  const setAccent = useUIStore((s) => s.setAccent);
  const reduceMotion = useUIStore((s) => s.reduceMotion);
  const setReduceMotion = useUIStore((s) => s.setReduceMotion);
  const railPinned = useUIStore((s) => s.railPinned);
  const toggleRailPinned = useUIStore((s) => s.toggleRailPinned);
  const theme = useUIStore((s) => s.theme);
  const setTheme = useUIStore((s) => s.setTheme);

  const { data, loading } = useAsync((signal) => userApi.me(signal), []);
  const limits = useAsync((signal) => billingApi.limits(signal), []);

  const [form, setForm] = useState<UserProfile | null>(null);
  const [errors, setErrors] = useState<Partial<Record<keyof UserProfile, string>>>({});
  const [saving, setSaving] = useState(false);

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
        <LoadingState label={t('common.loading')} />
      </div>
    );
  }

  const update = (patch: Partial<UserProfile>) => setForm((f) => (f ? { ...f, ...patch } : f));

  const validate = (): boolean => {
    const next: Partial<Record<keyof UserProfile, string>> = {};
    if (!form.name.trim()) next.name = 'Name is required.';
    if (!form.email.trim()) next.email = 'Email is required.';
    else if (!EMAIL_RE.test(form.email.trim())) next.email = 'Enter a valid email address.';
    if (!form.firm.trim()) next.firm = 'Organisation is required.';
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const save = async () => {
    if (!validate()) return;
    setSaving(true);
    try {
      const saved = await userApi.update(form);
      updateProfile(saved); // keep the rail footer / auth session in sync
      pushToast('Profile saved.', 'success');
    } catch {
      pushToast('Could not save profile.', 'error');
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
        pushToast('Could not save photo.', 'error');
      }
    };
    reader.readAsDataURL(file);
  };

  const removeAvatar = async () => {
    try {
      await userApi.update({ avatarUrl: '' }); // '' clears it server-side
      updateProfile({ avatarUrl: undefined });
    } catch {
      pushToast('Could not remove photo.', 'error');
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
            {/* Appearance --------------------------------------------------- */}
            <section className={styles.section}>
              <h2 className={styles.sectionTitle}>{t('settings.appearance')}</h2>
              <p className={styles.sectionSub}>{t('settings.sub')}</p>

              <div className={styles.field} style={{ marginBottom: 18 }}>
                <span className={styles.label}>{t('settings.theme')}</span>
                <div className={styles.segRow}>
                  <button
                    className={`${styles.segBtn} ${theme === 'light' ? styles.segBtnActive : ''}`}
                    onClick={() => setTheme('light')}
                  >
                    {t('settings.themeLight')}
                  </button>
                  <button
                    className={`${styles.segBtn} ${theme === 'dark' ? styles.segBtnActive : ''}`}
                    onClick={() => setTheme('dark')}
                  >
                    {t('settings.themeDark')}
                  </button>
                  <button
                    className={`${styles.segBtn} ${theme === 'system' ? styles.segBtnActive : ''}`}
                    onClick={() => setTheme('system')}
                  >
                    {t('settings.themeSystem')}
                  </button>
                </div>
              </div>

              <div className={styles.field} style={{ marginBottom: 18 }}>
                <span className={styles.label}>{t('settings.language')}</span>
                <div className={styles.segRow}>
                  {LANGUAGES.map((l) => (
                    <button
                      key={l.code}
                      className={`${styles.segBtn} ${lang === l.code ? styles.segBtnActive : ''}`}
                      onClick={() => setLang(l.code)}
                    >
                      {l.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className={styles.field} style={{ marginBottom: 18 }}>
                <span className={styles.label}>{t('settings.accent')}</span>
                <div className={styles.swatchRow}>
                  {ACCENT_OPTIONS.map((hex) => (
                    <button
                      key={hex}
                      className={`${styles.swatch} ${accent === hex ? styles.swatchActive : ''}`}
                      style={{ background: hex }}
                      onClick={() => setAccent(hex)}
                      aria-label={`Use accent ${hex}`}
                      aria-pressed={accent === hex}
                    />
                  ))}
                </div>
              </div>

              <Toggle
                label={t('settings.reduceMotion')}
                desc={t('settings.reduceMotionDesc')}
                on={reduceMotion}
                onToggle={() => setReduceMotion(!reduceMotion)}
              />
              <Toggle
                label={t('settings.pinRail')}
                desc={t('settings.pinRailDesc')}
                on={railPinned}
                onToggle={toggleRailPinned}
              />
            </section>

            {/* Profile ------------------------------------------------------ */}
            <section className={styles.section}>
              <h2 className={styles.sectionTitle}>{t('settings.profile')}</h2>
              <p className={styles.sectionSub}>Used across reviews, redlines, and signature requests.</p>

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
                  label="Organisation"
                  name="firm"
                  value={form.firm}
                  error={errors.firm}
                  onChange={(e) => update({ firm: e.target.value })}
                />
              </div>
              <div className={styles.formRow}>
                <TextField
                  label={t('auth.email')}
                  name="email"
                  type="email"
                  value={form.email}
                  error={errors.email}
                  onChange={(e) => update({ email: e.target.value })}
                />
                <div className={styles.field}>
                  <label className={styles.label} htmlFor="jurisdiction">
                    Primary jurisdiction
                  </label>
                  <select
                    id="jurisdiction"
                    className={styles.select}
                    value={form.jurisdiction}
                    onChange={(e) => update({ jurisdiction: e.target.value })}
                  >
                    {JURISDICTIONS.map((j) => (
                      <option key={j} value={j}>
                        {j}
                      </option>
                    ))}
                  </select>
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
                <LoadingState label={t('common.loading')} />
              )}
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

function Toggle({ label, desc, on, onToggle }: { label: string; desc: string; on: boolean; onToggle: () => void }) {
  return (
    <div className={styles.toggleRow}>
      <div>
        <div className={styles.toggleLabel}>{label}</div>
        <div className={styles.toggleDesc}>{desc}</div>
      </div>
      <button
        className={styles.switch}
        role="switch"
        aria-checked={on}
        aria-label={label}
        onClick={onToggle}
        style={{ background: on ? 'var(--accent)' : 'var(--border)' }}
      >
        <span className={styles.switchKnob} style={{ transform: on ? 'translateX(18px)' : 'none' }} />
      </button>
    </div>
  );
}
