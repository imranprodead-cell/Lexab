/**
 * Раздел «API» (тариф Business): ключи публичного API, статистика вызовов и
 * документация с готовыми curl-примерами. Другие тарифы не видят пункт в меню
 * (SideRail фильтрует по плану), а по прямому URL получают апселл: сервер
 * отвечает 402 → { locked } → EmptyState, как в Playbooks.
 */
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ApiError } from '@/api/util';
import { apiKeysApi, type ApiKeyCreated, type ApiKeyInfo, type ApiUsage } from '@/api/apiKeys.api';
import { TopBar } from '@/components/layout/TopBar';
import { Icon } from '@/components/icons/Icon';
import { Button } from '@/components/ui/Button';
import { CountUp } from '@/components/ui/CountUp';
import { Modal } from '@/components/ui/Modal';
import { EmptyState, ErrorState, SkeletonRows } from '@/components/ui/States';
import { TextField } from '@/components/ui/TextField';
import { useAsync } from '@/hooks/useAsync';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useReveal } from '@/hooks/useReveal';
import { useI18n } from '@/i18n/I18nProvider';
import { localeFor } from '@/i18n/dates';
import { useUIStore } from '@/store/useUIStore';
import styles from './pages.module.css';

type Gated<T> = { locked: true } | { locked: false; data: T };

/** 402 от сервера → { locked } (единый апселл-паттерн Playbooks/Batch). */
async function gated<T>(load: () => Promise<T>): Promise<Gated<T>> {
  try {
    return { locked: false, data: await load() };
  } catch (err) {
    if (err instanceof ApiError && err.status === 402) return { locked: true };
    throw err;
  }
}

const statusColor = (s: string) => (s === 'done' ? 'var(--ok)' : s === 'error' ? 'var(--danger)' : 'var(--warn)');

/** Последние 30 дней с нулями (сервер отдаёт агрегаты за 30 дней, только дни
 *  с вызовами) — окно совпадает с подписью «за последние 30 дней». */
const USAGE_DAYS = 30;
function fillDays(days: ApiUsage['days']): { day: string; count: number }[] {
  const byDay = new Map(days.map((d) => [d.day, d.count]));
  return Array.from({ length: USAGE_DAYS }, (_, i) => {
    const day = new Date(Date.now() - (USAGE_DAYS - 1 - i) * 86_400_000).toISOString().slice(0, 10);
    return { day, count: byDay.get(day) ?? 0 };
  });
}

/** Скопировать в буфер с честным тостом: успех только когда копирование реально
 *  произошло (в небезопасном контексте navigator.clipboard может отсутствовать —
 *  а секрет ключа показывается один раз, ложный «скопировано» опасен). */
async function copyText(text: string, onOk: () => void, onFail: () => void): Promise<void> {
  try {
    if (!navigator.clipboard) throw new Error('clipboard unavailable');
    await navigator.clipboard.writeText(text);
    onOk();
  } catch {
    onFail();
  }
}

/** Дневной столбчатый график вызовов — разметка и классы MonthlyChart. */
function DailyChart({ days, lang }: { days: { day: string; count: number }[]; lang: string }) {
  const max = Math.max(1, ...days.map((d) => d.count));
  const ticks = [...new Set([2, 1, 0].map((i) => Math.round((max * i) / 2)))];
  return (
    <div className={styles.chartScroll}>
      <div className={styles.chartArea}>
        {ticks.map((v) => (
          <div key={v} className={styles.chartTick} style={{ top: `${((max - v) / max) * 100}%` }}>
            <span className={styles.chartTickLabel}>{v}</span>
            <span className={styles.chartTickLine} data-zero={v === 0 || undefined} />
            <span className={styles.chartTickLabel}>{v}</span>
          </div>
        ))}
        <div className={styles.chartCols}>
          {days.map((d, i) => (
            <div key={d.day} className={styles.chartCol}>
              <div className={styles.chartBars}>
                <div
                  className={styles.chartBar}
                  style={{
                    height: `${(d.count / max) * 100}%`,
                    background: 'var(--chart-accent)',
                    animationDelay: `${i * 35}ms`,
                  }}
                >
                  <span className={styles.chartBarValue}>{d.count}</span>
                </div>
              </div>
              <span className={styles.chartMonth}>
                {new Date(`${d.day}T00:00:00`).toLocaleDateString(localeFor(lang), { day: 'numeric', month: 'short' })}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** curl-пример с кнопкой копирования. */
function CodeBlock({ code, onCopied, onFailed }: { code: string; onCopied: () => void; onFailed: () => void }) {
  return (
    <div className={styles.apiCodeWrap}>
      <pre className={styles.apiCode}>{code}</pre>
      <button
        type="button"
        className={styles.apiCodeCopy}
        aria-label="Copy"
        onClick={() => void copyText(code, onCopied, onFailed)}
      >
        <Icon name="copy" size={15} />
      </button>
    </div>
  );
}

export function ApiPage() {
  const { t, lang } = useI18n();
  const navigate = useNavigate();
  const pushToast = useUIStore((s) => s.pushToast);
  usePageTitle(t('api.title'));
  const headReveal = useReveal(0.1);

  const keysState = useAsync<Gated<ApiKeyInfo[]>>((signal) => gated(() => apiKeysApi.list(signal)), []);
  const usageState = useAsync<Gated<ApiUsage>>((signal) => gated(() => apiKeysApi.usage(signal)), []);

  // Создание ключа: модалка label → показ секрета один раз.
  const [createOpen, setCreateOpen] = useState(false);
  const [label, setLabel] = useState('');
  const [creating, setCreating] = useState(false);
  const [createdKey, setCreatedKey] = useState<ApiKeyCreated | null>(null);
  // Отзыв: модалка подтверждения.
  const [revokeFor, setRevokeFor] = useState<ApiKeyInfo | null>(null);
  const [revoking, setRevoking] = useState(false);

  const locked = keysState.data?.locked === true;
  const keys = keysState.data && !keysState.data.locked ? keysState.data.data : [];
  const usage = usageState.data && !usageState.data.locked ? usageState.data.data : null;
  const days = useMemo(() => (usage ? fillDays(usage.days) : []), [usage]);

  const apiBase = `${window.location.origin}/api/v1`;
  // Пока usage не загрузился, показываем дефолтный лимит (1000), НЕ «безлимит» —
  // иначе Business на миг видел бы «Unlimited» в документации. null = именно
  // безлимит (Enterprise) и только когда usage реально загружен.
  const monthLimit = usage ? usage.month.limit : 1000;
  const limitLabel = monthLimit === null ? t('api.unlimited') : String(monthLimit);
  const fmtDate = (iso: string) =>
    new Date(iso).toLocaleDateString(localeFor(lang), { day: 'numeric', month: 'short', year: 'numeric' });

  // Открыть модалку создания — с чистого листа (иначе показался бы секрет
  // предыдущего ключа, «протёкший» из прошлого создания).
  const openCreate = () => {
    setCreatedKey(null);
    setLabel('');
    setCreateOpen(true);
  };
  // Закрыть модалку — запрещено, пока идёт создание (иначе await осиротел бы и
  // потом вписал секрет в закрытую модалку).
  const closeCreate = () => {
    if (creating) return;
    setCreateOpen(false);
    setCreatedKey(null);
  };

  const createKey = async () => {
    if (!label.trim() || creating) return;
    setCreating(true);
    try {
      const created = await apiKeysApi.create(label.trim());
      setCreatedKey(created);
      setLabel('');
      keysState.reload();
      usageState.reload();
    } catch (err) {
      pushToast(err instanceof Error && err.message ? err.message : t('common.error'), 'error');
    } finally {
      setCreating(false);
    }
  };

  const revokeKey = async () => {
    if (!revokeFor || revoking) return;
    setRevoking(true);
    try {
      await apiKeysApi.revoke(revokeFor.id);
      pushToast(t('api.revoked'), 'success');
      setRevokeFor(null);
      keysState.reload();
      usageState.reload();
    } catch (err) {
      pushToast(err instanceof Error && err.message ? err.message : t('common.error'), 'error');
    } finally {
      setRevoking(false);
    }
  };

  const curlCreate = `curl -X POST ${apiBase}/analyses \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"text": "FULL CONTRACT TEXT…", "fileName": "msa.txt", "jurisdiction": "Uzbekistan"}'

# файл вместо текста / file instead of text:
curl -X POST ${apiBase}/analyses \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -F "file=@contract.pdf"`;
  const curlPoll = `curl ${apiBase}/analyses/apireq_XXXXXXXX \\
  -H "Authorization: Bearer YOUR_API_KEY"

# → { "status": "done", "riskScore": 62, "riskLevel": "Elevated",
#     "summary": "…", "findings": [{ "severity": "High", "title": "…",
#     "citation": "…", "verified": true }] }`;
  const curlUsage = `curl ${apiBase}/usage -H "Authorization: Bearer YOUR_API_KEY"
# → { "month": "2026-08", "used": 137, "limit": ${monthLimit === null ? 'null' : monthLimit}, "remaining": ${monthLimit === null ? 'null' : Math.max(monthLimit - 137, 0)} }`;

  return (
    <div className={styles.page}>
      <TopBar title={t('api.title')} />
      <div className={`${styles.body} scroll`}>
        <div className={styles.container}>
          <div className={styles.pageHead} ref={headReveal}>
            <h1 className={styles.pageTitle}>{t('api.title')}</h1>
            <p className={styles.pageSub}>{t('api.sub')}</p>
          </div>

          {keysState.loading ? (
            <SkeletonRows rows={3} height={120} />
          ) : keysState.error ? (
            <ErrorState message={keysState.error} onRetry={keysState.reload} />
          ) : locked ? (
            <EmptyState
              icon="key"
              title={t('api.upsellTitle')}
              body={t('api.upsellBody')}
              action={
                <Button icon="diamond" onClick={() => navigate('/plans')}>
                  {t('api.upsellCta')}
                </Button>
              }
            />
          ) : (
            <div className={styles.settingsGrid}>
              {/* Ключи ------------------------------------------------------ */}
              <section className={styles.section}>
                <div className={styles.apiSectionHead}>
                  <div>
                    <h2 className={styles.sectionTitle}>{t('api.keys')}</h2>
                    <p className={styles.sectionSub}>{t('api.keysSub')}</p>
                  </div>
                  <Button size="sm" icon="plus" onClick={openCreate}>
                    {t('api.createKey')}
                  </Button>
                </div>

                {keys.length === 0 ? (
                  <p className={styles.apiEmptyHint}>{t('api.noKeys')}</p>
                ) : (
                  <div className={styles.integrList}>
                    {keys.map((k) => (
                      <div key={k.id} className={styles.integrRow}>
                        <span className={styles.integrIcon}>
                          <Icon name="key" size={20} />
                        </span>
                        <div className={styles.integrText}>
                          <span className={styles.integrName}>{k.label}</span>
                          <span className={`${styles.integrStatus} ${styles.mono}`}>
                            {k.keyPrefix} · {t('api.created')} {fmtDate(k.createdAt)} · {t('api.lastUsed')}:{' '}
                            {k.lastUsedAt ? fmtDate(k.lastUsedAt) : t('api.neverUsed')}
                          </span>
                        </div>
                        <Button size="sm" variant="ghost" className={styles.integrBtn} onClick={() => setRevokeFor(k)}>
                          {t('api.revoke')}
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              {/* Использование ---------------------------------------------- */}
              <section className={styles.section}>
                <h2 className={styles.sectionTitle}>{t('api.usage')}</h2>
                <p className={styles.sectionSub}>{t('api.usageSub')}</p>

                {usage ? (
                  <>
                    <div className={styles.statGrid}>
                      <div className={styles.stat}>
                        <div className={styles.statLabel}>
                          <Icon name="analytics" size={15} color="var(--accent)" />
                          {t('api.usedThisMonth')}
                        </div>
                        <div className={styles.statValue}>
                          <CountUp to={usage.month.used} />
                        </div>
                      </div>
                      <div className={styles.stat}>
                        <div className={styles.statLabel}>
                          <Icon name="clock" size={15} color="var(--accent)" />
                          {usage.month.limit === null ? t('api.unlimited') : t('api.remaining', { limit: usage.month.limit })}
                        </div>
                        <div className={styles.statValue}>
                          {usage.month.remaining === null ? '∞' : <CountUp to={usage.month.remaining} />}
                        </div>
                      </div>
                      <div className={styles.stat}>
                        <div className={styles.statLabel}>
                          <Icon name="key" size={15} color="var(--accent)" />
                          {t('api.activeKeys')}
                        </div>
                        <div className={styles.statValue}>
                          <CountUp to={usage.activeKeys} />
                        </div>
                      </div>
                    </div>

                    <DailyChart days={days} lang={lang} />

                    <h3 className={styles.apiSubTitle}>{t('api.recentCalls')}</h3>
                    {usage.recent.length === 0 ? (
                      <p className={styles.apiEmptyHint}>{t('api.noCalls')}</p>
                    ) : (
                      <div className={styles.integrList}>
                        {usage.recent.map((r) => (
                          <div key={r.id} className={styles.integrRow}>
                            <span className={styles.apiStatusDot} style={{ background: statusColor(r.status) }} />
                            <div className={styles.integrText}>
                              <span className={styles.integrName}>{r.fileName}</span>
                              <span className={styles.integrStatus}>
                                {t(`api.status.${r.status}` as 'api.status.done')}
                                {r.keyLabel ? ` · ${r.keyLabel}` : ''} ·{' '}
                                {new Date(r.createdAt).toLocaleString(localeFor(lang), {
                                  day: 'numeric',
                                  month: 'short',
                                  hour: '2-digit',
                                  minute: '2-digit',
                                })}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                ) : usageState.loading ? (
                  <SkeletonRows rows={2} height={80} />
                ) : usageState.error ? (
                  <ErrorState message={usageState.error} onRetry={usageState.reload} />
                ) : null}
              </section>

              {/* Документация ----------------------------------------------- */}
              <section className={styles.section}>
                <h2 className={styles.sectionTitle}>{t('api.docs')}</h2>
                <p className={styles.sectionSub}>{t('api.docsSub')}</p>

                <h3 className={styles.apiSubTitle}>{t('api.docsAuth')}</h3>
                <p className={styles.apiDocText}>{t('api.docsAuthBody')}</p>

                <h3 className={styles.apiSubTitle}>{t('api.docsCreate')}</h3>
                <p className={styles.apiDocText}>{t('api.docsCreateBody')}</p>
                <CodeBlock code={curlCreate} onCopied={() => pushToast(t('api.copiedCmd'), 'success')} onFailed={() => pushToast(t('api.copyFail'), 'error')} />

                <h3 className={styles.apiSubTitle}>{t('api.docsPoll')}</h3>
                <p className={styles.apiDocText}>{t('api.docsPollBody')}</p>
                <CodeBlock code={curlPoll} onCopied={() => pushToast(t('api.copiedCmd'), 'success')} onFailed={() => pushToast(t('api.copyFail'), 'error')} />

                <h3 className={styles.apiSubTitle}>{t('api.docsUsage')}</h3>
                <p className={styles.apiDocText}>{t('api.docsUsageBody', { limit: limitLabel })}</p>
                <CodeBlock code={curlUsage} onCopied={() => pushToast(t('api.copiedCmd'), 'success')} onFailed={() => pushToast(t('api.copyFail'), 'error')} />

                <h3 className={styles.apiSubTitle}>{t('api.docsErrors')}</h3>
                <p className={styles.apiDocText}>{t('api.docsErrorsBody')}</p>
              </section>

              {/* Тариф и оплата --------------------------------------------- */}
              <section className={styles.section}>
                <h2 className={styles.sectionTitle}>{t('api.plan')}</h2>
                <p className={styles.sectionSub}>{t('api.planSub')}</p>
                <div className={styles.planLine}>
                  <span className={styles.planLineName}>
                    <Icon name="diamond" size={15} color="var(--accent)" strokeWidth={2.2} />
                    Business
                  </span>
                  <span style={{ display: 'inline-flex', gap: 8 }}>
                    <Button size="sm" variant="secondary" onClick={() => navigate('/settings')}>
                      {t('api.openSettings')}
                    </Button>
                    <Button size="sm" iconRight="chevron" onClick={() => navigate('/plans')}>
                      {t('api.openPlans')}
                    </Button>
                  </span>
                </div>
              </section>
            </div>
          )}
        </div>
      </div>

      {/* Создание ключа: label → секрет один раз. */}
      <Modal
        open={createOpen}
        title={createdKey ? t('api.keyCreated') : t('api.createKey')}
        onClose={closeCreate}
        footer={
          createdKey ? (
            <Button onClick={closeCreate}>{t('api.done')}</Button>
          ) : (
            <Button onClick={() => void createKey()} disabled={creating || !label.trim()}>
              {creating ? t('common.loading') : t('api.createKey')}
            </Button>
          )
        }
      >
        {createdKey ? (
          <>
            <p className={styles.apiDocText}>{t('api.keyShownOnce')}</p>
            <div className={styles.apiKeyBox}>
              <code className={styles.apiKeyValue}>{createdKey.key}</code>
              <Button
                size="sm"
                variant="secondary"
                icon="copy"
                onClick={() =>
                  void copyText(
                    createdKey.key,
                    () => pushToast(t('api.copied'), 'success'),
                    () => pushToast(t('api.copyFail'), 'error'),
                  )
                }
              >
                {t('api.copy')}
              </Button>
            </div>
          </>
        ) : (
          <>
            <TextField
              label={t('api.keyLabel')}
              name="api-key-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void createKey();
              }}
            />
            <p className={styles.apiDocText}>{t('api.keyLabelHint')}</p>
          </>
        )}
      </Modal>

      {/* Подтверждение отзыва. */}
      <Modal
        open={revokeFor !== null}
        title={t('api.revoke')}
        onClose={() => setRevokeFor(null)}
        footer={
          <Button onClick={() => void revokeKey()} disabled={revoking}>
            {revoking ? t('common.loading') : t('api.revoke')}
          </Button>
        }
      >
        <p className={styles.apiDocText}>{t('api.revokeConfirm', { label: revokeFor?.label ?? '' })}</p>
      </Modal>
    </div>
  );
}
