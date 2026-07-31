import { useEffect, useState } from 'react';
import { TopBar } from '@/components/layout/TopBar';
import { Icon, type IconName } from '@/components/icons/Icon';
import { ErrorState, SkeletonRows } from '@/components/ui/States';
import { useAsync } from '@/hooks/useAsync';
import { usePageTitle } from '@/hooks/usePageTitle';
import { analyticsApi } from '@/api';
import { useI18n } from '@/i18n/I18nProvider';
import { localeFor } from '@/i18n/dates';
import type { AnalyticsSummary, RiskLevel, Severity } from '@/types/domain';
import styles from './pages.module.css';

const STAT_META: { key: keyof StatMap; labelKey: string; icon: IconName; unitKey?: string }[] = [
  { key: 'contractsReviewed', labelKey: 'an.contractsReviewed', icon: 'docs' },
  { key: 'avgRiskScore', labelKey: 'an.avgRisk', icon: 'shield', unitKey: '/ 100' },
  { key: 'highRiskFindings', labelKey: 'an.highRisk', icon: 'alert' },
  { key: 'hoursSaved', labelKey: 'an.hoursSaved', icon: 'clock', unitKey: 'an.hours' },
];

interface StatMap {
  contractsReviewed: number;
  avgRiskScore: number;
  highRiskFindings: number;
  hoursSaved: number;
}

const SEVERITY_COLOR: Record<Severity, string> = {
  High: 'var(--sev-high)',
  Medium: 'var(--sev-med)',
  Low: 'var(--sev-low)',
};

const RISK_COLOR: Record<RiskLevel, string> = {
  High: 'var(--sev-high)',
  Elevated: 'var(--sev-med)',
  Low: 'var(--sev-low)',
};

/** Round the axis maximum up to a "nice" number (5, 10, 20, 50, 100 …). */
function niceCeil(n: number): number {
  if (n <= 5) return 5;
  const pow = 10 ** Math.floor(Math.log10(n));
  for (const m of [1, 2, 5, 10]) {
    if (n <= m * pow) return m * pow;
  }
  return 10 * pow;
}

/** "2026-07" → localized short month label ("июл" / "Jul"). */
function monthLabel(key: string, lang: string): string {
  const [y, m] = key.split('-').map(Number);
  return new Date(Date.UTC(y, (m ?? 1) - 1, 1)).toLocaleDateString(localeFor(lang), {
    month: 'short',
    timeZone: 'UTC',
  });
}

/** Grouped monthly bars: reviews (accent) + findings (muted), animated growth. */
function MonthlyChart({ data }: { data: AnalyticsSummary['monthly'] }) {
  const { t, lang } = useI18n();
  const max = niceCeil(Math.max(1, ...data.flatMap((m) => [m.reviews, m.findings])));
  // Integer tick VALUES, each line positioned by its true value — so a bar of
  // exactly "3" always meets the "3" gridline (max 5 or 10 isn't divisible by 4).
  const ticks = [...new Set([4, 3, 2, 1, 0].map((i) => Math.round((max * i) / 4)))];

  return (
    <div className={styles.panel}>
      <div className={styles.chartHead}>
        <h2 className={styles.panelTitle}>{t('an.monthly')}</h2>
        <div className={styles.chartLegend}>
          <span className={styles.chartLegendItem}>
            <i className={styles.chartDot} style={{ background: 'var(--chart-accent)' }} />
            {t('an.series.reviews')}
          </span>
          <span className={styles.chartLegendItem}>
            <i className={styles.chartDot} style={{ background: 'var(--chart-muted)' }} />
            {t('an.series.findings')}
          </span>
        </div>
      </div>

      {/* On narrow screens the 12 months scroll sideways instead of squashing. */}
      <div className={styles.chartScroll}>
        <div className={styles.chartArea}>
          {/* Dashed gridlines with values on both sides, like a classic report chart. */}
          {ticks.map((v) => (
            <div key={v} className={styles.chartTick} style={{ top: `${((max - v) / max) * 100}%` }}>
              <span className={styles.chartTickLabel}>{v}</span>
              <span className={styles.chartTickLine} data-zero={v === 0 || undefined} />
              <span className={styles.chartTickLabel}>{v}</span>
            </div>
          ))}
          <div className={styles.chartCols}>
            {data.map((m, i) => (
              <div key={m.month} className={styles.chartCol}>
                <div className={styles.chartBars}>
                  <div
                    className={styles.chartBar}
                    style={{
                      height: `${(m.reviews / max) * 100}%`,
                      background: 'var(--chart-accent)',
                      animationDelay: `${i * 45}ms`,
                    }}
                  >
                    <span className={styles.chartBarValue}>{m.reviews}</span>
                  </div>
                  <div
                    className={styles.chartBar}
                    style={{
                      height: `${(m.findings / max) * 100}%`,
                      background: 'var(--chart-muted)',
                      animationDelay: `${i * 45 + 22}ms`,
                    }}
                  >
                    <span className={styles.chartBarValue}>{m.findings}</span>
                  </div>
                </div>
                <span className={styles.chartMonth}>{monthLabel(m.month, lang)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Round shares to integers that are GUARANTEED to sum to 100 (largest
 *  remainder): 1/1/1 must read 34/33/33, never 33+33+33 = 99. */
function percentShares(counts: number[]): number[] {
  const total = counts.reduce((s, n) => s + n, 0);
  if (total === 0) return counts.map(() => 0);
  const exact = counts.map((n) => (n / total) * 100);
  const floors = exact.map(Math.floor);
  let left = 100 - floors.reduce((s, n) => s + n, 0);
  const order = exact
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac);
  for (const { i } of order) {
    if (left <= 0) break;
    floors[i] += 1;
    left -= 1;
  }
  return floors;
}

/** Donut of findings by severity: green = Low, yellow = Medium, red = High. */
function SeverityDonut({ data }: { data: AnalyticsSummary['findingsBySeverity'] }) {
  const { t } = useI18n();
  const total = data.reduce((s, f) => s + f.count, 0);
  const R = 62;
  const C = 2 * Math.PI * R;
  // Draw-in animation: segments start at zero length and grow to target.
  const [drawn, setDrawn] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setDrawn(true));
    return () => cancelAnimationFrame(id);
  }, []);

  let acc = 0;
  const segments = data
    .filter((f) => f.count > 0)
    .map((f) => {
      const frac = f.count / total;
      const seg = { ...f, frac, start: acc };
      acc += frac;
      return seg;
    });

  return (
    <div className={styles.panel}>
      <h2 className={styles.panelTitle}>{t('an.bySeverity')}</h2>
      <div className={styles.donutWrap}>
        <svg viewBox="0 0 160 160" className={styles.donutSvg} role="img" aria-label={t('an.bySeverity')}>
          <g transform="rotate(-90 80 80)">
            <circle cx="80" cy="80" r={R} fill="none" stroke="var(--hover-2)" strokeWidth="21" />
            {segments.map((s) => (
              <circle
                key={s.severity}
                cx="80"
                cy="80"
                r={R}
                fill="none"
                stroke={SEVERITY_COLOR[s.severity as Severity]}
                strokeWidth="21"
                className={styles.donutSeg}
                strokeDasharray={drawn ? `${s.frac * C} ${C}` : `0 ${C}`}
                strokeDashoffset={-s.start * C}
              />
            ))}
          </g>
        </svg>
        <div className={styles.donutCenter}>
          <div className={styles.donutTotal}>{total}</div>
          <div className={styles.donutTotalLabel}>{t('an.donutTotal')}</div>
        </div>
      </div>
      <div className={styles.donutLegend}>
        {(() => {
          const pcts = percentShares(data.map((f) => f.count));
          return data.map((f, i) => (
            <div key={f.severity} className={styles.legendRow}>
              <span className={styles.legendLeft}>
                <i className={styles.chartDot} style={{ background: SEVERITY_COLOR[f.severity as Severity] }} />
                {t(`sev.${f.severity}`)}
              </span>
              <span className={styles.legendValue}>
                <b>{pcts[i]}%</b>
                <span className={styles.legendCount}>({f.count})</span>
              </span>
            </div>
          ));
        })()}
      </div>
    </div>
  );
}

/** A labelled row with a thin share bar — used by the risk-centre breakdowns. */
function ShareRow({ label, value, share, highCount, highLabel }: {
  label: string;
  value: number;
  share: number; // 0..1 of the largest row
  highCount: number;
  highLabel: string;
}) {
  return (
    <div className={styles.shareRow}>
      <div className={styles.shareTop}>
        <span className={styles.shareLabel} title={label}>{label}</span>
        <span className={styles.shareValue}>
          {highCount > 0 ? <span className={styles.shareHigh}>{highLabel}</span> : null}
          {value}
        </span>
      </div>
      <div className={styles.shareTrack}>
        <div className={styles.shareFill} style={{ width: `${Math.max(4, share * 100)}%` }} />
      </div>
    </div>
  );
}

export function AnalyticsPage() {
  const { t, lang } = useI18n();
  const { data, loading, error, reload } = useAsync((signal) => analyticsApi.summary(signal), []);
  usePageTitle(t('nav.analytics'));

  const dateFmt = (iso: string | null) =>
    iso ? new Date(iso).toLocaleDateString(localeFor(lang), { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

  const citTotal = data ? data.compliance.verified + data.compliance.unverified : 0;
  // floor, not round: "100% verified" must never appear while unverified > 0.
  const citPct = data && citTotal > 0 ? Math.floor((data.compliance.verified / citTotal) * 100) : null;

  return (
    <div className={styles.page}>
      <TopBar title={t('an.title')} />
      <div className={`${styles.body} scroll`}>
        <div className={styles.container}>
          <div className={styles.pageHead}>
            <h1 className={styles.pageTitle}>{t('an.title')}</h1>
            <p className={styles.pageSub}>{t('an.sub')}</p>
          </div>

          {loading ? (
            <SkeletonRows rows={4} height={96} />
          ) : error ? (
            <ErrorState message={error} onRetry={reload} />
          ) : data ? (
            <>
              <div className={styles.statGrid}>
                {STAT_META.map((m) => (
                  <div key={m.key} className={styles.stat}>
                    <div className={styles.statLabel}>
                      <Icon name={m.icon} size={15} color="var(--accent)" />
                      {t(m.labelKey)}
                    </div>
                    <div className={styles.statValue}>
                      {data[m.key]}
                      {m.unitKey ? (
                        <span className={styles.statUnit}>{m.unitKey === '/ 100' ? '/ 100' : t(m.unitKey)}</span>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>

              <MonthlyChart data={data.monthly} />

              <div className={styles.panels}>
                <SeverityDonut data={data.findingsBySeverity} />

                {/* ── Risk centre: highest-risk contracts ── */}
                <div className={styles.panel}>
                  <h2 className={styles.panelTitle}>{t('an.topContracts')}</h2>
                  {data.riskCenter.topContracts.length === 0 ? (
                    <p className={styles.panelEmpty}>{t('an.noData')}</p>
                  ) : (
                    data.riskCenter.topContracts.map((c) => (
                      <div key={c.id} className={styles.riskDocRow}>
                        <span className={styles.riskDocDot} style={{ background: RISK_COLOR[c.riskLevel] }} />
                        <span className={styles.riskDocName} title={c.name}>
                          {c.name}
                          {c.counterparty !== '—' ? <em>{c.counterparty}</em> : null}
                        </span>
                        <span className={styles.riskDocScore}>
                          {c.riskScore}
                          <span className={styles.statUnit}>/ 100</span>
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </div>

              <div className={styles.sectionHead}>
                <h2 className={styles.sectionTitle}>{t('an.riskCenter')}</h2>
                <p className={styles.sectionSub}>{t('an.riskCenterSub')}</p>
              </div>
              <div className={styles.panels}>
                <div className={styles.panel}>
                  <h2 className={styles.panelTitle}>{t('an.byJurisdiction')}</h2>
                  {data.riskCenter.byJurisdiction.length === 0 ? (
                    <p className={styles.panelEmpty}>{t('an.noData')}</p>
                  ) : (
                    data.riskCenter.byJurisdiction.map((r) => {
                      const maxTotal = Math.max(...data.riskCenter.byJurisdiction.map((x) => x.total));
                      return (
                        <ShareRow
                          key={r.jurisdiction}
                          label={r.jurisdiction}
                          value={r.total}
                          share={r.total / maxTotal}
                          highCount={r.high}
                          highLabel={t('an.highCount', { n: r.high })}
                        />
                      );
                    })
                  )}
                </div>
                <div className={styles.panel}>
                  <h2 className={styles.panelTitle}>{t('an.byCounterparty')}</h2>
                  {data.riskCenter.byCounterparty.length === 0 ? (
                    <p className={styles.panelEmpty}>{t('an.noData')}</p>
                  ) : (
                    data.riskCenter.byCounterparty.map((r) => {
                      const maxTotal = Math.max(...data.riskCenter.byCounterparty.map((x) => x.total));
                      return (
                        <ShareRow
                          key={r.counterparty}
                          label={r.counterparty}
                          value={r.total}
                          share={r.total / maxTotal}
                          highCount={r.high}
                          highLabel={t('an.highCount', { n: r.high })}
                        />
                      );
                    })
                  )}
                </div>
              </div>

              {/* «Деньги под риском»: стоимость договоров (CLM) по уровням риска. */}
              {data.valueAtRisk && data.valueAtRisk.currencies.length > 0 ? (
                <>
                  <div className={styles.sectionHead}>
                    <h2 className={styles.sectionTitle}>{t('an.var')}</h2>
                    <p className={styles.sectionSub}>{t('an.varSub')}</p>
                  </div>
                  <div className={styles.panels}>
                    {data.valueAtRisk.currencies.map((c) => {
                      const fmt = (n: number) =>
                        `${new Intl.NumberFormat(localeFor(lang), { notation: n >= 1_000_000 ? 'compact' : 'standard', maximumFractionDigits: 1 }).format(n)} ${c.currency === '—' ? '' : c.currency}`.trim();
                      return (
                        <div key={c.currency} className={styles.panel}>
                          <h2 className={styles.panelTitle}>{c.currency === '—' ? t('an.varNoCurrency') : c.currency}</h2>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14 }}>
                              <span style={{ color: 'var(--danger)', fontWeight: 600 }}>{t('an.varHigh')}</span>
                              <strong>{fmt(c.high)}</strong>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14 }}>
                              <span style={{ color: 'var(--sev-med)' }}>{t('an.varElevated')}</span>
                              <span>{fmt(c.elevated)}</span>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14 }}>
                              <span style={{ color: 'var(--sev-low)' }}>{t('an.varLow')}</span>
                              <span>{fmt(c.low)}</span>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, borderTop: '1px solid var(--border)', paddingTop: 8 }}>
                              <span style={{ color: 'var(--mut)' }}>{t('an.varTotal')}</span>
                              <strong>{fmt(c.total)}</strong>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                    {data.valueAtRisk.highRiskExpiringSoon > 0 ? (
                      <div className={styles.panel}>
                        <h2 className={styles.panelTitle}>{t('an.varExpiring')}</h2>
                        <div style={{ fontSize: 34, fontWeight: 700, color: 'var(--danger)', marginTop: 8 }}>
                          {data.valueAtRisk.highRiskExpiringSoon}
                        </div>
                        <p className={styles.sectionSub} style={{ marginTop: 4 }}>{t('an.varExpiringSub')}</p>
                      </div>
                    ) : null}
                  </div>
                </>
              ) : null}

              <div className={styles.sectionHead}>
                <h2 className={styles.sectionTitle}>{t('an.compliance')}</h2>
                <p className={styles.sectionSub}>{t('an.complianceSub')}</p>
              </div>
              <div className={styles.panels}>
                <div className={styles.panel}>
                  <h2 className={styles.panelTitle}>{t('an.citations')}</h2>
                  {citPct === null ? (
                    <p className={styles.panelEmpty}>{t('an.noData')}</p>
                  ) : (
                    <>
                      <div className={styles.citHeadline}>
                        <span className={styles.citPct}>{citPct}%</span>
                        <span className={styles.citPctLabel}>{t('an.citationsVerifiedShare')}</span>
                      </div>
                      <div className={styles.shareTrack}>
                        <div
                          className={styles.shareFill}
                          style={{ width: `${citPct}%`, background: 'var(--sev-low)' }}
                        />
                      </div>
                      <div className={styles.citRows}>
                        <div className={styles.legendRow}>
                          <span className={styles.legendLeft}>
                            <i className={styles.chartDot} style={{ background: 'var(--sev-low)' }} />
                            {t('an.citationsVerified')}
                          </span>
                          <span className={styles.legendValue}>{data.compliance.verified}</span>
                        </div>
                        <div className={styles.legendRow}>
                          <span className={styles.legendLeft}>
                            <i className={styles.chartDot} style={{ background: 'var(--sev-med)' }} />
                            {t('an.citationsUnverified')}
                          </span>
                          <span className={styles.legendValue}>{data.compliance.unverified}</span>
                        </div>
                      </div>
                    </>
                  )}
                </div>
                <div className={styles.panel}>
                  <h2 className={styles.panelTitle}>{t('an.corpus')}</h2>
                  {data.compliance.corpus.length === 0 ? (
                    <p className={styles.panelEmpty}>{t('an.noData')}</p>
                  ) : (
                    <>
                      {data.compliance.corpus.map((c) => (
                        <div key={c.jurisdiction} className={styles.legendRow}>
                          <span className={styles.legendLeft}>
                            <span className={styles.corpusJur}>{c.jurisdiction}</span>
                            {t('an.corpusDocs', { n: c.documents })}
                          </span>
                          <span className={`${styles.legendValue} ${styles.metaText}`}>{dateFmt(c.updatedAt)}</span>
                        </div>
                      ))}
                      <p className={styles.corpusNote}>{t('an.corpusNote')}</p>
                    </>
                  )}
                </div>
              </div>

              {data.team ? (
                <>
                  <div className={styles.sectionHead}>
                    <h2 className={styles.sectionTitle}>{t('an.team')}</h2>
                    <p className={styles.sectionSub}>{t('an.teamSub')}</p>
                  </div>
                  <div className={styles.panel}>
                    <div className={styles.teamGridHead}>
                      <span>{t('an.teamMember')}</span>
                      <span>{t('an.teamReviews30')}</span>
                      <span className={styles.hideSm}>{t('an.teamTotal')}</span>
                      <span className={styles.hideSm}>{t('an.teamLastActive')}</span>
                    </div>
                    {data.team.map((m) => {
                      const maxRecent = Math.max(1, ...data.team!.map((x) => x.reviews30d));
                      return (
                        <div key={m.id} className={styles.teamGridRow}>
                          <span className={styles.teamName}>
                            {m.name}
                            <em>{t(`team.role.${m.role}`)}</em>
                          </span>
                          <span className={styles.teamLoad}>
                            <span className={styles.shareTrack}>
                              <span
                                className={styles.shareFill}
                                style={{ width: `${Math.max(3, (m.reviews30d / maxRecent) * 100)}%` }}
                              />
                            </span>
                            {m.reviews30d}
                          </span>
                          <span className={styles.hideSm}>{m.reviewsTotal}</span>
                          <span className={`${styles.hideSm} ${styles.metaText}`}>{dateFmt(m.lastActive)}</span>
                        </div>
                      );
                    })}
                  </div>
                </>
              ) : null}
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
