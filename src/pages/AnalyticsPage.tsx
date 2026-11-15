import { useState, type CSSProperties } from 'react';
import { useNavigate } from 'react-router-dom';
import { TopBar } from '@/components/layout/TopBar';
import { Button } from '@/components/ui/Button';
import { EmptyState, ErrorState, SkeletonRows } from '@/components/ui/States';
import an from '@/components/ux/analytics.module.css';
import { analyticsApi } from '@/api';
import { useAsync } from '@/hooks/useAsync';
import { usePageTitle } from '@/hooks/usePageTitle';
import { localeFor } from '@/i18n/dates';
import { useI18n } from '@/i18n/I18nProvider';
import { useUxT } from '@/i18n/uxMessages';
import type { AnalyticsSummary, RiskLevel } from '@/types/domain';
import styles from './pages.module.css';

/*
 * Analytics (ui-test 2026-11-15) — по образцу Harvey: не «оценки» (сэкономленные
 * часы, средний риск, кольцо серьёзности, свежесть базы законов), а
 * 1) как фирма пользуется Lexab за 30 дней и по неделям,
 * 2) что требует работы юриста (решения по находкам, сроки отказа, риск),
 * 3) где чаще всего риски (темы находок, контрагенты).
 * Цвет данных — один синий (без фиолетового); риск — статусный цвет + подпись.
 */

const RISK_COLOR: Record<RiskLevel, string> = { High: 'var(--sev-high)', Elevated: 'var(--sev-med)', Low: 'var(--sev-low)' };

/** Верх оси: 1, 2, 5 × 10^k — подписи круглые, столбцы не упираются в край. */
function niceMax(v: number): number {
  if (v <= 4) return 4;
  const p = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 5, 10]) if (v <= m * p) return m * p;
  return 10 * p;
}

function Delta({ now, prev }: { now: number; prev: number }) {
  const u = useUxT();
  const d = now - prev;
  if (d === 0) return <span>{u('an2.deltaSame')}</span>;
  return <span>{u(d > 0 ? 'an2.deltaUp' : 'an2.deltaDown', { n: Math.abs(d) })}</span>;
}

function WeeklyChart({ weeks }: { weeks: NonNullable<AnalyticsSummary['weekly']> }) {
  const u = useUxT();
  const { lang } = useI18n();
  const [series, setSeries] = useState<'reviews' | 'questions'>('reviews');
  const fmt = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString(localeFor(lang), { day: 'numeric', month: 'short' });
  const values = weeks.map((w) => w[series]);
  const max = niceMax(Math.max(...values, 0));
  const label = u(series === 'reviews' ? 'an2.tabReviews' : 'an2.tabQuestions');
  const ticks = [max, max / 2, 0];
  return (
    <div className={an.panel}>
      <div className={an.panelHead}>
        <div>
          <h2 className={an.panelTitle}>{u('an2.activity')}</h2>
          <span className={an.panelSub}>{u('an2.weeks')}</span>
        </div>
        <div className={an.seg} role="group" aria-label={u('an2.activity')}>
          <button type="button" aria-pressed={series === 'reviews'} onClick={() => setSeries('reviews')}>
            {u('an2.tabReviews')}
          </button>
          <button type="button" aria-pressed={series === 'questions'} onClick={() => setSeries('questions')}>
            {u('an2.tabQuestions')}
          </button>
        </div>
      </div>
      <div>
        <div className={an.chart}>
          <div className={an.yAxis} aria-hidden="true">
            {ticks.map((v) => (
              <span key={v} className={an.yTick} style={{ top: `${((max - v) / max) * 100}%` }}>
                {Number.isInteger(v) ? v : v.toFixed(1)}
              </span>
            ))}
          </div>
          <div className={an.plot}>
            {ticks.slice(0, 2).map((v) => (
              <span key={v} className={an.grid} style={{ top: `${((max - v) / max) * 100}%` }} aria-hidden="true" />
            ))}
            {weeks.map((w, i) => {
              const v = w[series];
              const edge = i < 2 ? an.tipLeft : i > weeks.length - 3 ? an.tipRight : '';
              const tip = `${fmt(w.start)} – ${fmt(w.end)}: ${label.toLowerCase()} ${v}`;
              return (
                <div key={w.start} className={an.col} tabIndex={0} aria-label={tip}>
                  <span className={`${an.tip} ${edge}`}>{tip}</span>
                  <span className={`${an.bar} ${v === 0 ? an.barZero : ''}`} style={{ height: v === 0 ? 2 : `${(v / max) * 100}%` }} />
                </div>
              );
            })}
          </div>
        </div>
        <div className={an.xAxis} aria-hidden="true">
          <span />
          {weeks.map((w, i) => (
            <span key={w.start}>{i % 3 === 2 || i === weeks.length - 1 ? fmt(w.start) : ''}</span>
          ))}
        </div>
      </div>
    </div>
  );
}

export function AnalyticsPage() {
  const { t, lang } = useI18n();
  const u = useUxT();
  const navigate = useNavigate();
  usePageTitle(t('an.title'));
  const { data, loading, error, reload } = useAsync((signal) => analyticsApi.summary(signal), []);
  const num = (n: number) => n.toLocaleString(localeFor(lang));
  const date = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString(localeFor(lang), { day: 'numeric', month: 'long' });
  const daysTo = (iso: string) => Math.max(0, Math.round((Date.parse(`${iso}T00:00:00Z`) - Date.UTC(new Date().getFullYear(), new Date().getMonth(), new Date().getDate())) / 86_400_000));

  const body = () => {
    if (loading) return <SkeletonRows rows={4} height={110} />;
    if (error || !data) return <ErrorState message={error ?? t('common.error')} onRetry={reload} />;
    const s = data;
    const pulse = s.pulse ?? { reviews30d: 0, reviewsPrev30d: 0, questions30d: 0, questionsPrev30d: 0 };
    const nothing = s.contractsReviewed === 0 && pulse.questions30d === 0 && pulse.questionsPrev30d === 0;
    if (nothing) {
      return (
        <EmptyState
          icon="analytics"
          title={u('an2.emptyTitle')}
          body={u('an2.empty')}
          action={
            <Button variant="primary" icon="upload" onClick={() => navigate('/chat')}>
              {u('sm.upload')}
            </Button>
          }
        />
      );
    }
    const cited = s.compliance.verified + s.compliance.unverified;
    const verifiedPct = cited ? Math.round((s.compliance.verified / cited) * 100) : null;
    const decisions = s.decisions;
    const topics = s.topics?.items ?? [];
    const topicMax = Math.max(1, ...topics.map((x) => x.total));
    const parties = s.riskCenter.byCounterparty;
    const partyMax = Math.max(1, ...parties.map((x) => x.total));

    return (
      <div className={an.an}>
        {/* 1. Пульс за 30 дней — как Harvey: использование, а не «сэкономленные часы». */}
        <div className={an.kpis}>
          <div className={an.kpi}>
            <span className={an.kpiLabel}>{u('an2.reviews')}</span>
            <span className={an.kpiValue}>{num(pulse.reviews30d)}</span>
            <span className={an.kpiSub}>
              <Delta now={pulse.reviews30d} prev={pulse.reviewsPrev30d} />
            </span>
          </div>
          <div className={an.kpi}>
            <span className={an.kpiLabel}>{u('an2.questions')}</span>
            <span className={an.kpiValue}>{num(pulse.questions30d)}</span>
            <span className={an.kpiSub}>
              <Delta now={pulse.questions30d} prev={pulse.questionsPrev30d} />
            </span>
          </div>
          <div className={an.kpi}>
            <span className={an.kpiLabel}>{u('an2.waiting')}</span>
            <span className={an.kpiValue}>{decisions ? num(decisions.waiting) : '—'}</span>
            <span className={an.kpiSub}>
              {decisions?.top[0] ? (
                <button type="button" className={an.kpiLink} onClick={() => navigate(`/documents/${decisions.top[0].documentId}`)}>
                  {u('an2.openFirst')}
                </button>
              ) : (
                <span>{u('an2.waitingSub')}</span>
              )}
            </span>
          </div>
          <div className={an.kpi}>
            <span className={an.kpiLabel}>{u('an2.verified')}</span>
            <span className={an.kpiValue}>
              {verifiedPct === null ? '—' : verifiedPct}
              {verifiedPct === null ? null : <small>%</small>}
            </span>
            {verifiedPct !== null ? (
              <>
                <div className={an.meter} aria-hidden="true">
                  <span style={{ width: `${verifiedPct}%` }} />
                </div>
                <span className={an.kpiSub}>{u('an2.verifiedSub', { n: num(cited) })}</span>
              </>
            ) : null}
          </div>
        </div>

        {/* 2. Активность по неделям: один ряд и одна ось, переключатель вместо второй серии. */}
        {s.weekly?.length ? <WeeklyChart weeks={s.weekly} /> : null}

        {/* 3. Что требует внимания + самые рискованные договоры. */}
        <div className={an.two}>
          <div className={an.panel}>
            <h2 className={an.panelTitle}>{u('an2.attention')}</h2>
            <h3 className={an.subhead}>{u('an2.attentionWaiting')}</h3>
            {decisions?.top.length ? (
              <div className={an.list}>
                {decisions.top.map((d) => (
                  <button key={d.analysisId} type="button" className={`${an.row} ${an.rowBtn}`} onClick={() => navigate(`/documents/${d.documentId}`)}>
                    <span className={an.name} title={d.name}>
                      {d.name}
                    </span>
                    <span className={an.right}>{u('an2.waitingRow', { n: d.waiting, total: d.total })}</span>
                  </button>
                ))}
              </div>
            ) : (
              <p className={an.empty}>{u('an2.noneWaiting')}</p>
            )}
            <h3 className={an.subhead}>{u('an2.renewals')}</h3>
            {s.renewals === null ? (
              <p className={an.empty}>{u('an2.renewalsLocked')}</p>
            ) : s.renewals?.top.length ? (
              <div className={an.list}>
                {s.renewals.top.map((r) => {
                  const d = daysTo(r.last);
                  return (
                    <button key={r.documentId} type="button" className={`${an.row} ${an.rowBtn}`} onClick={() => navigate('/contracts')}>
                      <span style={{ minWidth: 0 }}>
                        <span className={an.name} title={r.name} style={{ display: 'block' }}>
                          {r.name}
                        </span>
                        <span className={an.sub}>
                          {date(r.last)}
                          {r.counterparty && r.counterparty !== '—' ? `, ${r.counterparty}` : ''}
                        </span>
                      </span>
                      <span className={an.chip} style={{ '--chip': d <= 7 ? 'color-mix(in srgb, var(--sev-high) 80%, var(--text))' : 'color-mix(in srgb, var(--sev-med) 62%, var(--text))' } as CSSProperties}>
                        {u('rn.inDays', { n: d })}
                      </span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <p className={an.empty}>{u('an2.noneRenewals')}</p>
            )}
          </div>

          <div className={an.panel}>
            <h2 className={an.panelTitle}>{u('an2.topRisk')}</h2>
            {s.riskCenter.topContracts.length ? (
              <div className={an.list}>
                {s.riskCenter.topContracts.map((c) => (
                  <button key={c.id} type="button" className={`${an.row} ${an.rowBtn}`} onClick={() => navigate(`/documents/${c.id}`)}>
                    <span style={{ minWidth: 0 }}>
                      <span className={an.name} title={c.name} style={{ display: 'block' }}>
                        {c.name}
                      </span>
                      {c.counterparty && c.counterparty !== '—' ? <span className={an.sub}>{c.counterparty}</span> : null}
                    </span>
                    <span className={an.riskCell}>
                      <span className={`${an.riskMeter} ${an.hideNarrow}`} style={{ '--risk': RISK_COLOR[c.riskLevel] } as CSSProperties} aria-hidden="true">
                        <span style={{ width: `${c.riskScore}%` }} />
                      </span>
                      <span className={an.right}>
                        {t(`risk.${c.riskLevel}`)}, {c.riskScore}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <p className={an.empty}>{t('an.noData')}</p>
            )}
          </div>
        </div>

        {/* 4. Где чаще всего риски: темы находок и контрагенты (ранжированные полосы, один цвет). */}
        <div className={an.two}>
          <div className={an.panel}>
            <div className={an.panelHead}>
              <h2 className={an.panelTitle}>{u('an2.byTopic')}</h2>
              <span className={an.panelSub}>{u('an2.byTopicSub')}</span>
            </div>
            {topics.length ? (
              <div>
                {topics.map((x) => (
                  <div key={x.topic} className={an.rank}>
                    <span className={an.rankLabel}>{u(`bm.topic.${x.topic}`)}</span>
                    <span className={an.rankTrack} aria-hidden="true">
                      <span className={an.rankFill} style={{ width: `${(x.total / topicMax) * 100}%`, display: 'block' }} />
                    </span>
                    <span className={an.rankValue}>
                      <b>{x.total}</b>{x.high ? `, ${u('an2.topicHigh', { n: x.high })}` : ''}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className={an.empty}>{t('an.noData')}</p>
            )}
            {s.topics?.unlabeled ? <p className={an.empty}>{u('an2.topicUnlabeled', { n: s.topics.unlabeled })}</p> : null}
          </div>

          <div className={an.panel}>
            <div className={an.panelHead}>
              <h2 className={an.panelTitle}>{u('an2.byCounterparty')}</h2>
              <span className={an.panelSub}>{u('an2.byCounterpartySub')}</span>
            </div>
            {parties.length ? (
              <div>
                {parties.map((x) => (
                  <div key={x.counterparty} className={an.rank}>
                    <span className={an.rankLabel} title={x.counterparty}>
                      {x.counterparty}
                    </span>
                    <span className={an.rankTrack} aria-hidden="true">
                      <span className={an.rankFill} style={{ width: `${(x.total / partyMax) * 100}%`, display: 'block' }} />
                    </span>
                    <span className={an.rankValue}>
                      <b>{x.total}</b>{x.high ? `, ${u('an2.topicHigh', { n: x.high })}` : ''}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className={an.empty}>{t('an.noData')}</p>
            )}
          </div>
        </div>

        {/* 5. Деньги под риском — только когда в договорах есть суммы. */}
        {s.valueAtRisk.currencies.length ? (
          <div className={an.panel}>
            <div className={an.panelHead}>
              <h2 className={an.panelTitle}>{t('an.var')}</h2>
              <span className={an.panelSub}>{t('an.varSub')}</span>
            </div>
            <table className={an.table}>
              <thead>
                <tr>
                  <th>{u('an2.currency')}</th>
                  <th>{t('an.varHigh')}</th>
                  <th className={an.hideNarrow}>{t('an.varElevated')}</th>
                  <th className={an.hideNarrow}>{t('an.varLow')}</th>
                  <th>{t('an.varTotal')}</th>
                </tr>
              </thead>
              <tbody>
                {s.valueAtRisk.currencies.map((c) => (
                  <tr key={c.currency}>
                    <td>{c.currency === '—' ? t('an.varNoCurrency') : c.currency}</td>
                    <td>{num(c.high)}</td>
                    <td className={an.hideNarrow}>{num(c.elevated)}</td>
                    <td className={an.hideNarrow}>{num(c.low)}</td>
                    <td>{num(c.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}

        {/* 6. Команда — только владельцу команды (как и раньше). */}
        {s.team?.length ? (
          <div className={an.panel}>
            <div className={an.panelHead}>
              <h2 className={an.panelTitle}>{t('an.team')}</h2>
              <span className={an.panelSub}>{t('an.teamSub')}</span>
            </div>
            <table className={an.table}>
              <thead>
                <tr>
                  <th>{t('an.teamMember')}</th>
                  <th>{t('an.teamReviews30')}</th>
                  <th className={an.hideNarrow}>{t('an.teamTotal')}</th>
                  <th className={an.hideNarrow}>{t('an.teamLastActive')}</th>
                </tr>
              </thead>
              <tbody>
                {s.team.map((m) => (
                  <tr key={m.id}>
                    <td>{m.name}</td>
                    <td>{m.reviews30d}</td>
                    <td className={an.hideNarrow}>{m.reviewsTotal}</td>
                    <td className={an.hideNarrow}>{m.lastActive ? new Date(m.lastActive).toLocaleDateString(localeFor(lang)) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>
    );
  };

  return (
    <div className={styles.page}>
      <TopBar title={t('an.title')} hideCountry />
      <div className={`${styles.body} scroll`}>
        <div className={styles.container}>
          <div className={styles.pageHead}>
            <h1 className={styles.pageTitle}>{t('an.title')}</h1>
            <p className={styles.pageSub}>{u('an2.sub')}</p>
          </div>
          {body()}
        </div>
      </div>
    </div>
  );
}
