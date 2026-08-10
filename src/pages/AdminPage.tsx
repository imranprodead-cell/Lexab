/**
 * Админ-панель владельца: выдача тарифов и персональных лимитов.
 *
 * Страница не защищает ничего — защита на сервере (ADMIN_EMAILS). Здесь только
 * честное поведение для не-админа: сервер отвечает 404, показываем «раздела
 * нет» и уводим обратно. Пункт в меню появляется тоже по ответу сервера, а не
 * по догадке фронта.
 *
 * Тексты страницы намеренно НЕ переведены на шесть языков: интерфейс владельца
 * в одном лице, а лишние 40 ключей в словаре видели бы все пользователи.
 *
 * Оформление живёт в собственном `admin.module.css`, а не в классах вкладки
 * «API» и списка интеграций, как было раньше.
 */
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { adminApi, type AdminStats, type AdminUserCard, type AdminUserRow, type LimitValue } from '@/api/admin.api';
import { TopBar } from '@/components/layout/TopBar';
import { Icon } from '@/components/icons/Icon';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { SelectMenu } from '@/components/ui/SelectMenu';
import { ErrorState, SkeletonRows } from '@/components/ui/States';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useUIStore } from '@/store/useUIStore';
import shell from './pages.module.css';
import styles from './admin.module.css';

const PLANS = ['Free', 'Standard', 'Pro', 'Business', 'Enterprise'];
const TERMS: { label: string; months: number | null }[] = [
  { label: '1 мес', months: 1 },
  { label: '3 мес', months: 3 },
  { label: '6 мес', months: 6 },
  { label: '12 мес', months: 12 },
  { label: 'бессрочно', months: null },
];

/** Поля персональных лимитов в порядке показа. */
const LIMIT_FIELDS = [
  { key: 'ai', label: 'ИИ-запросов в месяц' },
  { key: 'docs', label: 'Документов в месяц' },
  { key: 'storageMb', label: 'Хранилище, МБ' },
  { key: 'seats', label: 'Мест в команде' },
  { key: 'apiMonthly', label: 'Вызовов API в месяц' },
] as const;
type LimitKey = (typeof LIMIT_FIELDS)[number]['key'];

const fmt = (v: number | null): string => (v === null ? '∞' : String(v));

/** Ввод лимита: пусто = «по тарифу», «∞»/«unlimited» = без ограничения. */
function parseInput(raw: string): LimitValue | undefined {
  const s = raw.trim();
  if (s === '') return null;
  if (s === '∞' || s.toLowerCase() === 'unlimited') return 'unlimited';
  const n = Number(s);
  return Number.isInteger(n) && n >= 0 ? n : undefined;
}

/** Бейдж тарифа: контур для бесплатного, ткань акцента для платных. */
function PlanBadge({ plan, children }: { plan: string; children?: React.ReactNode }) {
  const tone = plan === 'Free' ? styles.badgeFree : plan === 'Enterprise' ? styles.badgeTop : styles.badgePaid;
  return (
    <span className={`${styles.badge} ${tone}`}>
      {plan}
      {children}
    </span>
  );
}

/** Полоса расхода. Точные числа стоят над ней — цвет только подсказывает. */
function UsageBar({ name, used, limit, unit }: { name: string; used: number; limit: number | null; unit?: string }) {
  const ratio = limit === null || limit === 0 ? 0 : Math.min(used / limit, 1);
  const tone = ratio >= 0.9 ? styles.usageFillDanger : ratio >= 0.75 ? styles.usageFillWarn : '';
  return (
    <div className={styles.usageRow}>
      <div className={styles.usageHead}>
        <span className={styles.usageName}>{name}</span>
        <span className={styles.usageNum}>
          {used}
          {unit ?? ''} из {fmt(limit)}
          {limit === null ? '' : unit ?? ''}
        </span>
      </div>
      <div
        className={styles.usageTrack}
        role="progressbar"
        aria-label={name}
        aria-valuenow={used}
        aria-valuemin={0}
        aria-valuemax={limit ?? undefined}
      >
        <div className={`${styles.usageFill} ${tone}`} style={{ inlineSize: `${Math.round(ratio * 100)}%` }} />
      </div>
    </div>
  );
}

export function AdminPage() {
  usePageTitle('Админ-панель');
  const navigate = useNavigate();
  const pushToast = useUIStore((s) => s.pushToast);

  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<AdminUserRow[] | null>(null);
  const [card, setCard] = useState<AdminUserCard | null>(null);
  const [busy, setBusy] = useState(false);

  // Форма выдачи
  const [grantPlan, setGrantPlan] = useState('Business');
  const [grantMonths, setGrantMonths] = useState<number | null>(3);
  const [grantNote, setGrantNote] = useState('');
  // Форма лимитов: строка на поле, пусто = «по тарифу»
  const [limitDraft, setLimitDraft] = useState<Record<LimitKey, string>>({
    ai: '',
    docs: '',
    storageMb: '',
    seats: '',
    apiMonthly: '',
  });
  const [confirmGrant, setConfirmGrant] = useState(false);

  const search = useCallback(async (term: string) => {
    try {
      const res = await adminApi.users(term);
      setRows(res.users);
    } catch {
      setRows([]);
    }
  }, []);

  useEffect(() => {
    let alive = true;
    adminApi
      .whoami()
      .then(async () => {
        if (!alive) return;
        setAllowed(true);
        const [s] = await Promise.all([adminApi.stats(), search('')]);
        if (alive) setStats(s);
      })
      .catch(() => {
        if (alive) setAllowed(false);
      });
    return () => {
      alive = false;
    };
  }, [search]);

  const openCard = async (id: string) => {
    setBusy(true);
    try {
      const c = await adminApi.user(id);
      setCard(c);
      // Черновик лимитов заполняем ТОЛЬКО переопределёнными полями: пустая
      // строка означает «по тарифу», и подставлять туда тарифное значение
      // нельзя — сохранение превратило бы его в жёсткое переопределение.
      setLimitDraft({
        ai: c.limits.overridden.includes('ai') ? fmt(c.limits.ai) : '',
        docs: c.limits.overridden.includes('docs') ? fmt(c.limits.docs) : '',
        storageMb: c.limits.overridden.includes('storageMb') ? fmt(c.limits.storageMb) : '',
        seats: c.limits.overridden.includes('seats') ? fmt(c.limits.seats) : '',
        apiMonthly: c.limits.overridden.includes('apiMonthly') ? fmt(c.limits.apiMonthly) : '',
      });
      setGrantPlan(c.subscription.plan === 'Free' ? 'Business' : c.subscription.plan);
      setGrantNote(c.subscription.grantNote ?? '');
    } catch (e) {
      pushToast(e instanceof Error ? e.message : 'Не удалось открыть карточку', 'error');
    } finally {
      setBusy(false);
    }
  };

  const reload = async (id: string) => {
    const [c] = await Promise.all([adminApi.user(id), search(q)]);
    setCard(c);
    setStats(await adminApi.stats());
  };

  const doGrant = async () => {
    if (!card) return;
    setBusy(true);
    try {
      const res = await adminApi.grantPlan(card.user.id, {
        plan: grantPlan,
        months: grantMonths,
        note: grantNote.trim() || undefined,
      });
      pushToast(
        grantPlan === 'Free'
          ? `Доступ отозван: ${card.user.email}`
          : `${res.plan} выдан ${card.user.email}${res.renewsAt ? ` до ${new Date(res.renewsAt).toLocaleDateString('ru-RU')}` : ''}`,
        'success',
      );
      await reload(card.user.id);
    } catch (e) {
      pushToast(e instanceof Error ? e.message : 'Не удалось выдать тариф', 'error');
    } finally {
      setBusy(false);
      setConfirmGrant(false);
    }
  };

  const saveLimits = async () => {
    if (!card) return;
    const body: Partial<Record<LimitKey, LimitValue>> & { note?: string } = {};
    for (const f of LIMIT_FIELDS) {
      const v = parseInput(limitDraft[f.key]);
      if (v === undefined) {
        pushToast(`«${f.label}»: введите целое число ≥ 0, «∞» или оставьте пусто`, 'error');
        return;
      }
      body[f.key] = v;
    }
    setBusy(true);
    try {
      await adminApi.setLimits(card.user.id, body);
      pushToast('Лимиты сохранены', 'success');
      await reload(card.user.id);
    } catch (e) {
      pushToast(e instanceof Error ? e.message : 'Не удалось сохранить лимиты', 'error');
    } finally {
      setBusy(false);
    }
  };

  const resetLimits = async () => {
    if (!card) return;
    setBusy(true);
    try {
      await adminApi.resetLimits(card.user.id);
      pushToast('Персональные лимиты сняты — действуют тарифные', 'success');
      await openCard(card.user.id);
      await search(q);
    } catch (e) {
      pushToast(e instanceof Error ? e.message : 'Не удалось снять лимиты', 'error');
    } finally {
      setBusy(false);
    }
  };

  const resetUsage = async () => {
    if (!card) return;
    setBusy(true);
    try {
      await adminApi.resetUsage(card.user.id);
      pushToast('Счётчики месяца обнулены', 'success');
      await reload(card.user.id);
    } catch (e) {
      pushToast(e instanceof Error ? e.message : 'Не удалось обнулить счётчики', 'error');
    } finally {
      setBusy(false);
    }
  };

  if (allowed === null) {
    return (
      <div className={shell.page}>
        <TopBar title="Админ-панель" />
        <div className={`${shell.body} scroll`}>
          <div className={shell.container}>
            <SkeletonRows rows={4} />
          </div>
        </div>
      </div>
    );
  }

  if (!allowed) {
    return (
      <div className={shell.page}>
        <TopBar title="Раздел не найден" />
        <div className={`${shell.body} scroll`}>
          <div className={shell.container}>
            <ErrorState message="Такого раздела нет." onRetry={() => navigate('/chat')} />
          </div>
        </div>
      </div>
    );
  }

  const revoking = grantPlan === 'Free';

  return (
    <div className={shell.page}>
      <TopBar title="Админ-панель" />
      <div className={`${shell.body} scroll`}>
        <div className={shell.container}>
          {stats ? (
            <>
              <div className={styles.stats}>
                <div className={styles.stat}>
                  <div className={styles.statLabel}>
                    <Icon name="users" size={14} />
                    Аккаунтов
                  </div>
                  <div className={styles.statValue}>{stats.users}</div>
                </div>
                <div className={styles.stat}>
                  <div className={styles.statLabel}>
                    <Icon name="diamond" size={14} />
                    Выдач за 30 дней
                  </div>
                  <div className={styles.statValue}>{stats.grantsLast30Days}</div>
                </div>
                <div className={styles.stat}>
                  <div className={styles.statLabel}>
                    <Icon name="settings" size={14} />С персональными лимитами
                  </div>
                  <div className={styles.statValue}>{stats.customLimits}</div>
                </div>
              </div>

              <div className={styles.planChips}>
                <span className={styles.planChipsLabel}>По тарифам:</span>
                {stats.byPlan.map((p) => (
                  <PlanBadge key={p.plan} plan={p.plan}>
                    <span className={styles.planCount}>{p.count}</span>
                  </PlanBadge>
                ))}
              </div>
            </>
          ) : null}

          <section className={styles.panel}>
            <div className={styles.panelHead}>
              <h2 className={styles.panelTitle}>Аккаунты</h2>
              {rows ? <span className={styles.panelCount}>{rows.length}</span> : null}
              <div className={styles.searchRow}>
                <input
                  className={styles.searchField}
                  placeholder="Поиск по почте, имени или фирме"
                  aria-label="Поиск аккаунтов"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void search(q);
                  }}
                />
                <Button variant="primary" icon="search" onClick={() => void search(q)}>
                  Найти
                </Button>
              </div>
            </div>

            {rows === null ? (
              <div className={styles.skeletonBox}>
                <SkeletonRows rows={4} />
              </div>
            ) : rows.length === 0 ? (
              <p className={styles.empty}>Ничего не найдено.</p>
            ) : (
              <div className={styles.list}>
                {rows.map((u) => (
                  <button key={u.id} type="button" className={styles.row} onClick={() => void openCard(u.id)}>
                    <span className={styles.rowMain}>
                      <span className={styles.rowTitle}>{u.email}</span>
                      <span className={styles.rowMeta}>
                        {u.name}
                        {u.firm ? ` · ${u.firm}` : ''}
                        {u.renewsAt ? ` · до ${new Date(u.renewsAt).toLocaleDateString('ru-RU')}` : ''}
                        {u.grantNote ? ` · ${u.grantNote}` : ''}
                      </span>
                    </span>
                    <span className={styles.rowTags}>
                      {u.hasCustomLimits ? (
                        <span className={`${styles.badge} ${styles.badgeCustom}`}>свои лимиты</span>
                      ) : null}
                      <PlanBadge plan={u.plan} />
                    </span>
                    <span className={styles.rowChevron}>
                      <Icon name="chevron" size={15} />
                    </span>
                  </button>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>

      <Modal open={Boolean(card)} title={card ? card.user.email : ''} onClose={() => setCard(null)} maxWidth={760}>
        {card ? (
          <div className={styles.card}>
            <div className={styles.cardHead}>
              <PlanBadge plan={card.subscription.plan} />
              {card.limits.overridden.length ? (
                <span className={`${styles.badge} ${styles.badgeCustom}`}>свои лимиты</span>
              ) : null}
              <span className={styles.cardMeta}>
                {card.user.name}
                {card.user.firm ? ` · ${card.user.firm}` : ''} · с{' '}
                {new Date(card.user.createdAt).toLocaleDateString('ru-RU')}
              </span>
            </div>

            <section className={styles.section}>
              <h3 className={styles.sectionTitle}>Тариф</h3>
              <p className={styles.sectionNote}>
                Сейчас <strong>{card.subscription.plan}</strong>
                {card.subscription.renewsAt
                  ? ` до ${new Date(card.subscription.renewsAt).toLocaleDateString('ru-RU')}`
                  : ' (без срока)'}
                {card.subscription.grantedBy ? ` · выдал ${card.subscription.grantedBy}` : ''}
                {card.subscription.grantNote ? ` · «${card.subscription.grantNote}»` : ''}
              </p>
              <div className={styles.grantGrid}>
                <div>
                  <span className={styles.fieldLabel}>Тариф</span>
                  <SelectMenu
                    ariaLabel="Тариф для выдачи"
                    value={grantPlan}
                    onChange={setGrantPlan}
                    options={PLANS.map((p) => ({ value: p, label: p }))}
                  />
                </div>
                <div>
                  <span className={styles.fieldLabel}>Срок</span>
                  <SelectMenu
                    ariaLabel="Срок действия"
                    disabled={revoking}
                    value={grantMonths === null ? 'null' : String(grantMonths)}
                    onChange={(v) => setGrantMonths(v === 'null' ? null : Number(v))}
                    options={TERMS.map((tm) => ({
                      value: tm.months === null ? 'null' : String(tm.months),
                      label: tm.label,
                    }))}
                  />
                </div>
                <div>
                  <span className={styles.fieldLabel}>Комментарий</span>
                  <input
                    className={styles.searchField}
                    placeholder="За что / как оплатил"
                    aria-label="Комментарий к выдаче"
                    value={grantNote}
                    onChange={(e) => setGrantNote(e.target.value)}
                  />
                </div>
              </div>
              <div className={styles.actions}>
                {revoking ? (
                  <Button className={shell.dangerBtn} disabled={busy} onClick={() => setConfirmGrant(true)}>
                    Отозвать доступ
                  </Button>
                ) : (
                  <Button variant="primary" disabled={busy} onClick={() => setConfirmGrant(true)}>
                    Выдать {grantPlan}
                  </Button>
                )}
              </div>
            </section>

            <section className={styles.section}>
              <h3 className={styles.sectionTitle}>Персональные лимиты</h3>
              <p className={styles.sectionNote}>
                Пусто = как в тарифе. «∞» = без ограничения. Действует поверх тарифа и на всю команду владельца.
              </p>
              <div className={styles.limitGrid}>
                {LIMIT_FIELDS.map((f) => {
                  const set = limitDraft[f.key].trim() !== '';
                  return (
                    <label key={f.key} className={`${styles.limitField} ${set ? styles.limitFieldSet : ''}`}>
                      <span className={styles.limitLabel}>{f.label}</span>
                      <input
                        className={styles.limitInput}
                        inputMode="numeric"
                        value={limitDraft[f.key]}
                        placeholder={fmt(card.planLimits[f.key])}
                        onChange={(e) => setLimitDraft({ ...limitDraft, [f.key]: e.target.value })}
                      />
                      <span className={styles.limitBase}>по тарифу: {fmt(card.planLimits[f.key])}</span>
                    </label>
                  );
                })}
              </div>
              <div className={styles.actions}>
                <Button variant="primary" disabled={busy} onClick={() => void saveLimits()}>
                  Сохранить лимиты
                </Button>
                <Button variant="secondary" disabled={busy} onClick={() => void resetLimits()}>
                  Снять персональные
                </Button>
              </div>
            </section>

            <section className={styles.section}>
              <h3 className={styles.sectionTitle}>Расход в этом месяце</h3>
              <div className={styles.usage}>
                <UsageBar name="ИИ-запросы (чат)" used={card.usage.aiRequests} limit={card.limits.ai} />
                <UsageBar name="Документы" used={card.usage.documents} limit={card.limits.docs} />
                <UsageBar name="Хранилище" used={card.usage.storageMb} limit={card.limits.storageMb} unit=" МБ" />
              </div>
              <div className={styles.actions}>
                <Button
                  className={`${shell.dangerBtn} ${styles.actionsSpacer}`}
                  disabled={busy}
                  onClick={() => void resetUsage()}
                >
                  Обнулить счётчики месяца
                </Button>
              </div>
            </section>

            {card.history.length ? (
              <section className={styles.section}>
                <h3 className={styles.sectionTitle}>История</h3>
                <div className={styles.history}>
                  {card.history.map((h, i) => (
                    <div key={`${h.at}-${i}`} className={styles.historyRow}>
                      <span className={styles.historyKind}>
                        {h.kind}
                        {h.plan ? ` · ${h.plan}` : ''}
                      </span>
                      <span className={styles.historyNote}>
                        {typeof h.payload.note === 'string' && h.payload.note ? `«${h.payload.note}»` : ''}
                        {typeof h.payload.by === 'string' ? ` ${h.payload.by}` : ''}
                      </span>
                      <span className={styles.historyWhen}>{new Date(h.at).toLocaleString('ru-RU')}</span>
                    </div>
                  ))}
                </div>
              </section>
            ) : null}
          </div>
        ) : null}
      </Modal>

      {/* Подтверждение выдачи: опечатка в тарифе или сроке стоит денег. */}
      <Modal
        open={confirmGrant}
        title={revoking ? 'Отозвать доступ?' : 'Подтвердите выдачу'}
        onClose={() => setConfirmGrant(false)}
        footer={
          <>
            <Button variant="secondary" disabled={busy} onClick={() => setConfirmGrant(false)}>
              Отмена
            </Button>
            <Button
              variant={revoking ? 'secondary' : 'primary'}
              className={revoking ? shell.dangerBtn : ''}
              disabled={busy}
              onClick={() => void doGrant()}
            >
              {busy ? 'Сохраняем…' : revoking ? 'Отозвать' : 'Подтвердить'}
            </Button>
          </>
        }
      >
        <p className={styles.sectionNote}>
          {revoking ? (
            <>
              Отозвать платный доступ у <strong>{card?.user.email}</strong>? Аккаунт вернётся на бесплатный тариф.
            </>
          ) : (
            <>
              Выдать <strong>{grantPlan}</strong> аккаунту <strong>{card?.user.email}</strong>
              {grantMonths === null ? ' без срока окончания' : ` на ${grantMonths} мес.`}? Клиент получит письмо и
              уведомление.
            </>
          )}
        </p>
      </Modal>
    </div>
  );
}
