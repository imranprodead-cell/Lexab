import { useState, type FormEvent } from 'react';
import { TopBar } from '@/components/layout/TopBar';
import { InitialsAvatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { GlassCard } from '@/components/ui/GlassCard';
import { TextField } from '@/components/ui/TextField';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/States';
import { useAsync } from '@/hooks/useAsync';
import { ROLE_COLORS, teamApi, type TeamRole } from '@/api';
import { useUIStore } from '@/store/useUIStore';
import { useI18n } from '@/i18n/I18nProvider';
import { initialsOf } from '@/lib/format';
import styles from './pages.module.css';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ROLES: TeamRole[] = ['owner', 'admin', 'editor', 'viewer'];

/** Team management: member list, invite-by-email, accept/decline invitations. */
export function TeamPage() {
  const { t } = useI18n();
  const pushToast = useUIStore((s) => s.pushToast);

  const members = useAsync((signal) => teamApi.members(signal), []);
  const invitations = useAsync((signal) => teamApi.invitations(signal), []);

  const [modalOpen, setModalOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<TeamRole>('editor');
  const [formError, setFormError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [answering, setAnswering] = useState<string | null>(null);

  const openModal = () => {
    setEmail('');
    setRole('editor');
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
      await teamApi.invite(trimmed, role);
      setModalOpen(false);
      pushToast(t('team.inviteSent'), 'success');
      members.reload();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : t('common.error'));
    } finally {
      setSending(false);
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
              <h1 className={styles.pageTitle}>{t('team.title')}</h1>
              <p className={styles.pageSub}>{t('team.sub')}</p>
            </div>
            <Button variant="primary" icon="plus" onClick={openModal}>
              {t('team.invite')}
            </Button>
          </div>

          {/* Invitations addressed to me — join only after accepting. */}
          {(invitations.data ?? []).map((inv) => (
            <GlassCard key={inv.id} className={styles.inviteBanner}>
              <div className={styles.inviteBannerText}>
                {t('team.invitedYou', { name: inv.inviterName, firm: inv.inviterFirm })}
                {' · '}
                <Badge color={ROLE_COLORS[inv.role] ?? 'var(--mut)'} plain>
                  {t(inv.roleKey)}
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
            <LoadingState label={t('common.loading')} />
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
                  </tr>
                </thead>
                <tbody>
                  {(members.data ?? []).map((m) => (
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
                        <Badge color={m.color} plain>
                          {t(m.roleKey)}
                        </Badge>
                      </td>
                      <td className={`${styles.td} ${styles.hideSm} ${styles.metaText}`}>{t(m.statusKey)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
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
