/**
 * Раздел «API» (тариф Business): ключи публичного API, статистика вызовов и
 * документация с готовыми curl-примерами. Другие тарифы не видят пункт в меню
 * (SideRail фильтрует по плану), а по прямому URL получают апселл: сервер
 * отвечает 402 → { locked } → EmptyState, как в Playbooks.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ApiError } from '@/api/util';
import { API_SCOPES_FALLBACK, apiKeysApi, type ApiKeyCreated, type ApiKeyInfo, type ApiUsage } from '@/api/apiKeys.api';
import { TopBar } from '@/components/layout/TopBar';
import { Icon } from '@/components/icons/Icon';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { CountUp } from '@/components/ui/CountUp';
import { Modal } from '@/components/ui/Modal';
import { SelectMenu } from '@/components/ui/SelectMenu';
import { EmptyState, ErrorState, SkeletonRows } from '@/components/ui/States';
import { TextField } from '@/components/ui/TextField';
import { useAsync } from '@/hooks/useAsync';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useReveal } from '@/hooks/useReveal';
import { useI18n } from '@/i18n/I18nProvider';
import { localeFor } from '@/i18n/dates';
import { useUIStore } from '@/store/useUIStore';
import { MANAGER_TELEGRAM } from '@/lib/contacts';
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

/** Скоупы с переводом описания — для неизвестных (будущих) прав показываем id без подписи. */
const KNOWN_SCOPES = new Set(API_SCOPES_FALLBACK);

/** Под-навигация страницы: 4 вкладки, hash-часть URL = id вкладки
 *  (#keys/#usage/#docs/#plan). Неизвестный/пустой hash → первая вкладка. */
const API_TABS = ['keys', 'usage', 'topup', 'docs', 'plan'] as const;
type ApiTab = (typeof API_TABS)[number];
const tabFromHash = (): ApiTab => {
  const h = window.location.hash.replace(/^#/, '');
  return (API_TABS as readonly string[]).includes(h) ? (h as ApiTab) : 'keys';
};

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
  const location = useLocation();
  const pushToast = useUIStore((s) => s.pushToast);
  usePageTitle(t('api.title'));
  const headReveal = useReveal(0.1);

  // Активная вкладка синхронизирована с hash ЧЕРЕЗ РОУТЕР (react-router владеет
  // историей — прямой history.replaceState расходился бы с ним): пишем через
  // navigate({hash}, replace), а читаем из location.hash. Это ловит и deep-link,
  // и back/forward, и переход на /developer из меню (сброс на первую вкладку).
  const [tab, setTab] = useState<ApiTab>(tabFromHash);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  useEffect(() => {
    setTab(tabFromHash()); // location.hash в react-router всегда актуален
  }, [location.hash]);
  const selectTab = (next: ApiTab) => {
    setTab(next); // мгновенный отклик; navigate синхронизирует URL/роутер
    navigate({ hash: `#${next}` }, { replace: true });
  };
  const onTabKeyDown = (e: React.KeyboardEvent, idx: number) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const dir = e.key === 'ArrowRight' ? 1 : -1;
    const nextIdx = (idx + dir + API_TABS.length) % API_TABS.length;
    selectTab(API_TABS[nextIdx]);
    tabRefs.current[nextIdx]?.focus();
  };
  const tabLabels: Record<ApiTab, string> = {
    keys: t('api.keys'),
    usage: t('api.usage'),
    topup: t('api.tabTopup'),
    docs: t('api.docs'),
    plan: t('api.tabPlan'),
  };

  const keysState = useAsync<Gated<ApiKeyInfo[]>>((signal) => gated(() => apiKeysApi.list(signal)), []);
  const usageState = useAsync<Gated<ApiUsage>>((signal) => gated(() => apiKeysApi.usage(signal)), []);
  // Каталог прав — с фолбэком, чтобы модалка работала и до/без ответа сервера.
  const scopesState = useAsync<string[]>((signal) => apiKeysApi.scopes(signal), []);
  const allScopes = scopesState.data && scopesState.data.length > 0 ? scopesState.data : API_SCOPES_FALLBACK;

  // Создание ключа: модалка label+права+срок → показ секрета один раз.
  const [createOpen, setCreateOpen] = useState(false);
  const [label, setLabel] = useState('');
  const [creating, setCreating] = useState(false);
  const [createdKey, setCreatedKey] = useState<ApiKeyCreated | null>(null);
  const [selScopes, setSelScopes] = useState<string[]>([]);
  const [expiry, setExpiry] = useState(''); // '' = бессрочно, иначе дни строкой
  // Ротация показывает секрет в той же модалке — флаг меняет только заголовок.
  const [wasRotated, setWasRotated] = useState(false);
  // Отзыв: модалка подтверждения.
  const [revokeFor, setRevokeFor] = useState<ApiKeyInfo | null>(null);
  const [revoking, setRevoking] = useState(false);
  // Ротация: модалка подтверждения (+необязательный срок нового ключа).
  const [rotateFor, setRotateFor] = useState<ApiKeyInfo | null>(null);
  const [rotating, setRotating] = useState(false);
  const [rotateExpiry, setRotateExpiry] = useState('');

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
  // предыдущего ключа, «протёкший» из прошлого создания). По умолчанию отмечены
  // ВСЕ права (= полный доступ, старое поведение) и срок «бессрочно».
  const openCreate = () => {
    setCreatedKey(null);
    setWasRotated(false);
    setLabel('');
    setSelScopes(allScopes);
    setExpiry('');
    setCreateOpen(true);
  };
  // Закрыть модалку — запрещено, пока идёт создание (иначе await осиротел бы и
  // потом вписал секрет в закрытую модалку).
  const closeCreate = () => {
    if (creating) return;
    setCreateOpen(false);
    setCreatedKey(null);
  };

  const toggleScope = (s: string) =>
    setSelScopes((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));

  const createKey = async () => {
    if (!label.trim() || creating || selScopes.length === 0) return;
    setCreating(true);
    try {
      // Отмечены все права → scopes: [] (= полный доступ, как раньше).
      const scopes = selScopes.length === allScopes.length ? [] : allScopes.filter((s) => selScopes.includes(s));
      const created = await apiKeysApi.create(label.trim(), scopes, expiry === '' ? null : Number(expiry));
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

  // Ротация: старый ключ отзывается, новый секрет показываем тем же
  // одноразовым механизмом, что и при создании (та же модалка).
  const rotateKey = async () => {
    if (!rotateFor || rotating) return;
    setRotating(true);
    try {
      const rotated = await apiKeysApi.rotate(rotateFor.id, rotateExpiry === '' ? null : Number(rotateExpiry));
      setRotateFor(null);
      setWasRotated(true);
      setLabel('');
      setCreatedKey(rotated);
      setCreateOpen(true);
      keysState.reload();
      usageState.reload();
    } catch (err) {
      pushToast(err instanceof Error && err.message ? err.message : t('common.error'), 'error');
    } finally {
      setRotating(false);
    }
  };

  const expiryOptions = [
    { value: '', label: t('api.expiryNone') },
    { value: '30', label: t('api.expiryDays', { days: 30 }) },
    { value: '90', label: t('api.expiryDays', { days: 90 }) },
    { value: '365', label: t('api.expiryDays', { days: 365 }) },
  ];

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
  const curlDraft = `curl -X POST ${apiBase}/drafts \\
  -H "Authorization: Bearer YOUR_API_KEY" -H "Content-Type: application/json" \\
  -d '{"prompt": "Mutual NDA between Acme and Globex", "jurisdiction": "UK law"}'
# → 202 { "id": "apireq_…", "status": "processing" }
curl ${apiBase}/drafts/apireq_XXXXXXXX -H "Authorization: Bearer YOUR_API_KEY"
# → { "status": "done", "title": "…", "summary": "…", "document": [ … ] }`;
  const curlCompare = `curl -X POST ${apiBase}/compares \\
  -H "Authorization: Bearer YOUR_API_KEY" -H "Content-Type: application/json" \\
  -d '{"textA": "VERSION A…", "textB": "VERSION B…"}'
# файлы: -F "fileA=@v1.docx" -F "fileB=@v2.docx"
curl ${apiBase}/compares/apireq_XXXXXXXX -H "Authorization: Bearer YOUR_API_KEY"
# → { "status": "done", "summary": "…", "changes": [{ "heading": "…",
#     "kind": "modified", "severity": "High", "before": "…", "after": "…" }] }`;
  const curlTemplate = `curl ${apiBase}/templates -H "Authorization: Bearer YOUR_API_KEY"
# → { "items": [{ "id": "t1", "name": "Mutual NDA", "category": "…" }, … ] }
curl -X POST ${apiBase}/templates/t1/generate \\
  -H "Authorization: Bearer YOUR_API_KEY" -H "Content-Type: application/json" \\
  -d '{"partyA": "Acme Ltd", "partyB": "Globex Inc", "details": "Pilot NDA"}'
# → 202 { "id": "apireq_…" }  →  GET ${apiBase}/templates/requests/apireq_…
#    → { "status": "done", "title": "…", "content": "…full contract…" }`;
  const curlWebhook = `# Регистрируем вебхук — секрет подписи вернётся ОДИН раз:
curl -X POST ${apiBase}/webhooks \\
  -H "Authorization: Bearer YOUR_API_KEY" -H "Content-Type: application/json" \\
  -d '{"url": "https://your-app.com/lexab-callback"}'
# → { "id": "whep_…", "signingSecret": "whsec_…", "events": ["*"] }

# Когда задание готово, Lexab POST'ит на ваш URL:
#   X-Lexab-Signature: HMAC-SHA256(тело, signingSecret)  ← проверьте на своей стороне
#   тело: { "event":"analysis.done", "id":"apireq_…", "kind":"analysis", "status":"done" }

# Ссылка на страницу-отчёт (для показа человеку):
curl "${apiBase}/analyses/apireq_XXXXXXXX?report=1" -H "Authorization: Bearer YOUR_API_KEY"
# → { …, "reportUrl": "${window.location.origin}/share/…" }`;
  const curlIdem = `curl -X POST ${apiBase}/analyses \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Idempotency-Key: your-unique-id" \\
  -H "Content-Type: application/json" \\
  -d '{"text": "FULL CONTRACT TEXT…", "fileName": "msa.txt"}'
# повтор с тем же Idempotency-Key → тот же ответ, без дубля и списания юнита
# a retry with the same Idempotency-Key → same response, no duplicate, no unit spent

# ключ без нужного права / a key lacking the required scope:
# → 403 { "error": { "code": "insufficient_scope", "message": "…" } }`;

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
            <>
              <div className={styles.apiTabs} role="tablist" aria-label={t('api.tabsAria')}>
                {API_TABS.map((id, i) => (
                  <button
                    key={id}
                    ref={(el) => {
                      tabRefs.current[i] = el;
                    }}
                    type="button"
                    role="tab"
                    id={`api-tab-${id}`}
                    aria-selected={tab === id}
                    aria-controls={tab === id ? `api-panel-${id}` : undefined}
                    tabIndex={tab === id ? 0 : -1}
                    className={`${styles.apiTab} ${tab === id ? styles.apiTabActive : ''}`}
                    onClick={() => selectTab(id)}
                    onKeyDown={(e) => onTabKeyDown(e, i)}
                  >
                    {tabLabels[id]}
                  </button>
                ))}
              </div>

              <div className={styles.settingsGrid}>
              {/* Ключи ------------------------------------------------------ */}
              {tab === 'keys' && (
              <section className={styles.section} role="tabpanel" id="api-panel-keys" aria-labelledby="api-tab-keys">
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
                          <span className={styles.apiKeyMeta}>
                            {k.expired ? <Badge color="High">{t('api.expiredBadge')}</Badge> : null}
                            <span>{k.expiresAt ? t('api.expiresOn', { date: fmtDate(k.expiresAt) }) : t('api.noExpiry')}</span>
                            {k.createdBy ? <span>· {t('api.createdByLabel', { name: k.createdBy })}</span> : null}
                            <span>·</span>
                            {k.scopes.length === 0 ? (
                              <span>{t('api.fullAccess')}</span>
                            ) : (
                              k.scopes.map((s) => (
                                <span key={s} className={styles.apiScopeChip}>
                                  {s}
                                </span>
                              ))
                            )}
                          </span>
                        </div>
                        <span style={{ display: 'inline-flex', gap: 8 }}>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              setRotateExpiry('');
                              setRotateFor(k);
                            }}
                          >
                            {t('api.rotate')}
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setRevokeFor(k)}>
                            {t('api.revoke')}
                          </Button>
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </section>
              )}

              {/* Использование ---------------------------------------------- */}
              {tab === 'usage' && (
              <section className={styles.section} role="tabpanel" id="api-panel-usage" aria-labelledby="api-tab-usage">
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
              )}

              {/* Документация ----------------------------------------------- */}
              {tab === 'docs' && (
              <section className={styles.section} role="tabpanel" id="api-panel-docs" aria-labelledby="api-tab-docs">
                <div className={styles.apiSectionHead}>
                  <div>
                    <h2 className={styles.sectionTitle}>{t('api.docs')}</h2>
                    <p className={styles.sectionSub}>{t('api.docsSub')}</p>
                  </div>
                  {/* Полный интерактивный справочник по OpenAPI-спеке. */}
                  <Button size="sm" variant="secondary" iconRight="chevron" onClick={() => navigate('/developer/docs')}>
                    {t('api.docsPage.open')}
                  </Button>
                </div>

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

                <h3 className={styles.apiSubTitle}>{t('api.docsMore')}</h3>
                <p className={styles.apiDocText}>{t('api.docsMoreBody')}</p>
                <p className={styles.apiDocText}>
                  <strong>{t('api.docsDraft')}</strong>
                </p>
                <CodeBlock code={curlDraft} onCopied={() => pushToast(t('api.copiedCmd'), 'success')} onFailed={() => pushToast(t('api.copyFail'), 'error')} />
                <p className={styles.apiDocText}>
                  <strong>{t('api.docsCompare')}</strong>
                </p>
                <CodeBlock code={curlCompare} onCopied={() => pushToast(t('api.copiedCmd'), 'success')} onFailed={() => pushToast(t('api.copyFail'), 'error')} />
                <p className={styles.apiDocText}>
                  <strong>{t('api.docsTemplate')}</strong>
                </p>
                <CodeBlock code={curlTemplate} onCopied={() => pushToast(t('api.copiedCmd'), 'success')} onFailed={() => pushToast(t('api.copyFail'), 'error')} />

                <h3 className={styles.apiSubTitle}>{t('api.docsWebhooks')}</h3>
                <p className={styles.apiDocText}>{t('api.docsWebhooksBody')}</p>
                <CodeBlock code={curlWebhook} onCopied={() => pushToast(t('api.copiedCmd'), 'success')} onFailed={() => pushToast(t('api.copyFail'), 'error')} />

                <h3 className={styles.apiSubTitle}>{t('api.docsIdem')}</h3>
                <p className={styles.apiDocText}>{t('api.docsIdemBody')}</p>
                <CodeBlock code={curlIdem} onCopied={() => pushToast(t('api.copiedCmd'), 'success')} onFailed={() => pushToast(t('api.copyFail'), 'error')} />

                <h3 className={styles.apiSubTitle}>{t('api.docsErrors')}</h3>
                <p className={styles.apiDocText}>{t('api.docsErrorsBody')}</p>
              </section>
              )}

              {/* Пополнение баланса ------------------------------------------ */}
              {tab === 'topup' && (
              <section className={styles.section} role="tabpanel" id="api-panel-topup" aria-labelledby="api-tab-topup">
                <h2 className={styles.sectionTitle}>{t('api.topup.title')}</h2>
                {monthLimit === null ? (
                  <p className={styles.sectionSub}>{t('api.topup.unlimited')}</p>
                ) : (
                  <>
                    <p className={styles.sectionSub}>{t('api.topup.sub', { limit: monthLimit })}</p>
                    <div className={styles.statGrid}>
                      <div className={styles.stat}>
                        <div className={styles.statLabel}>
                          <Icon name="analytics" size={15} color="var(--accent)" />
                          {t('api.usedThisMonth')}
                        </div>
                        <div className={styles.statValue}>{usage ? <CountUp to={usage.month.used} /> : '—'}</div>
                      </div>
                      <div className={styles.stat}>
                        <div className={styles.statLabel}>
                          <Icon name="clock" size={15} color="var(--accent)" />
                          {t('api.remaining', { limit: monthLimit })}
                        </div>
                        <div className={styles.statValue}>
                          {usage && usage.month.remaining !== null ? <CountUp to={usage.month.remaining} /> : '—'}
                        </div>
                      </div>
                    </div>
                    {/* Самообслуживания нет намеренно: пакеты вызовов продаются
                        напрямую, поэтому кнопка ведёт в переписку, а не в оплату. */}
                    <div className={styles.apiTopupActions}>
                      <Button
                        icon="message"
                        iconRight="arrowUpRight"
                        onClick={() => window.open(MANAGER_TELEGRAM, '_blank', 'noopener,noreferrer')}
                      >
                        {t('api.topup.button')}
                      </Button>
                    </div>
                    <p className={styles.apiEmptyHint}>{t('api.topup.note')}</p>
                  </>
                )}
              </section>
              )}

              {/* Тариф и оплата --------------------------------------------- */}
              {tab === 'plan' && (
              <section className={styles.section} role="tabpanel" id="api-panel-plan" aria-labelledby="api-tab-plan">
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
              )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Создание ключа: label+права+срок → секрет один раз (и после ротации). */}
      <Modal
        open={createOpen}
        title={createdKey ? (wasRotated ? t('api.rotated') : t('api.keyCreated')) : t('api.createKey')}
        onClose={closeCreate}
        footer={
          createdKey ? (
            <Button onClick={closeCreate}>{t('api.done')}</Button>
          ) : (
            <Button onClick={() => void createKey()} disabled={creating || !label.trim() || selScopes.length === 0}>
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

            <span className={styles.label}>{t('api.scopesTitle')}</span>
            <div className={styles.apiScopeList}>
              {allScopes.map((s) => (
                <label key={s} className={styles.apiScopeCheck}>
                  <input type="checkbox" className={styles.wfCheck} checked={selScopes.includes(s)} onChange={() => toggleScope(s)} />
                  <span className={styles.apiScopeCode}>{s}</span>
                  {KNOWN_SCOPES.has(s) ? <span className={styles.apiScopeDesc}>{t(`api.scope.${s}`)}</span> : null}
                </label>
              ))}
            </div>
            <p className={styles.apiDocText}>{selScopes.length === 0 ? t('api.scopesNone') : t('api.scopesHint')}</p>

            <span className={styles.label}>{t('api.expiryTitle')}</span>
            <div className={styles.apiExpirySelect}>
              <SelectMenu ariaLabel={t('api.expiryTitle')} value={expiry} onChange={setExpiry} options={expiryOptions} />
            </div>
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

      {/* Подтверждение ротации: тот же confirm-паттерн, что и отзыв,
          плюс необязательный срок действия нового ключа. */}
      <Modal
        open={rotateFor !== null}
        title={t('api.rotate')}
        onClose={() => setRotateFor(null)}
        footer={
          <Button onClick={() => void rotateKey()} disabled={rotating}>
            {rotating ? t('common.loading') : t('api.rotate')}
          </Button>
        }
      >
        <p className={styles.apiDocText}>{t('api.rotateConfirm', { label: rotateFor?.label ?? '' })}</p>
        <span className={styles.label}>{t('api.expiryTitle')}</span>
        <div className={styles.apiExpirySelect}>
          <SelectMenu ariaLabel={t('api.expiryTitle')} value={rotateExpiry} onChange={setRotateExpiry} options={expiryOptions} />
        </div>
      </Modal>
    </div>
  );
}
