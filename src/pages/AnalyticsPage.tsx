import { TopBar } from '@/components/layout/TopBar';
import { Icon, type IconName } from '@/components/icons/Icon';
import { toneColor } from '@/components/ui/Badge';
import { ErrorState, LoadingState } from '@/components/ui/States';
import { useAsync } from '@/hooks/useAsync';
import { analyticsApi } from '@/api';
import { useI18n } from '@/i18n/I18nProvider';
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

/** Severity → icon for the "findings by severity" legend. */
const SEVERITY_ICON: Record<string, IconName> = {
  High: 'alert',
  Medium: 'shield',
  Low: 'check',
};

/** Portfolio analytics: headline stats, review throughput, finding mix. */
export function AnalyticsPage() {
  const { t } = useI18n();
  const { data, loading, error, reload } = useAsync((signal) => analyticsApi.summary(signal), []);

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
            <LoadingState label={t('common.loading')} />
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

              <div className={styles.panels}>
                <div className={styles.panel}>
                  <h2 className={styles.panelTitle}>{t('an.perWeek')}</h2>
                  <div className={styles.bars}>
                    {data.reviewsByWeek.map((w) => {
                      const max = Math.max(...data.reviewsByWeek.map((x) => x.count));
                      return (
                        <div key={w.week} className={styles.barCol}>
                          <div
                            className={styles.bar}
                            style={{ height: `${(w.count / max) * 100}%` }}
                            title={`${w.count}`}
                          />
                          <span className={styles.barLabel}>{w.week}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className={styles.panel}>
                  <h2 className={styles.panelTitle}>{t('an.bySeverity')}</h2>
                  {data.findingsBySeverity.map((f) => (
                    <div key={f.severity} className={styles.legendRow}>
                      <span className={styles.legendLeft}>
                        <Icon name={SEVERITY_ICON[f.severity] ?? 'alert'} size={15} color={toneColor(f.severity)} />
                        {f.severity}
                      </span>
                      <span className={styles.legendValue}>{f.count}</span>
                    </div>
                  ))}
                </div>
              </div>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
