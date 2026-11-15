import { useMemo, useState, type CSSProperties } from 'react';
import { Button } from '@/components/ui/Button';
import { CitationLine } from '@/components/ui/VerifiedBadge';
import { Spinner } from '@/components/ui/Spinner';
import { useI18n } from '@/i18n/I18nProvider';
import { useUxT } from '@/i18n/uxMessages';
import { groupByTopic, TOPICS, worstOf, type Topic } from '@/lib/batchTopics';
import type { AnalysisResult, Finding, Severity } from '@/types/domain';
import styles from './ux.module.css';

export interface MatrixRow {
  key: string;
  name: string;
  documentId?: string | null;
  state: 'loading' | 'error' | 'pending' | 'ready';
  analysis?: AnalysisResult;
}

type Col = Topic | 'playbook';
const COLS: Col[] = [...TOPICS, 'playbook'];

const SEV_VAR: Record<Severity, string> = { High: 'var(--sev-high)', Medium: 'var(--sev-med)', Low: 'var(--sev-low)' };
const SEV_CHIP: Record<Severity, string> = { High: styles.chipHigh, Medium: styles.chipMed, Low: styles.chipLow };

interface CellData {
  findings: Finding[];
  worst: Severity | 'check' | null;
}

/**
 * «Таблица проверок» массового разбора: строки — договоры, колонки — темы
 * (неустойка, расторжение, споры, оплата, приёмка, другое) и плейбук. В клетке —
 * самая серьёзная находка темы; клик открывает справа находки со словами
 * договора и ссылкой на норму.
 */
export function BatchMatrix({ rows, onOpen }: { rows: MatrixRow[]; onOpen?: (row: MatrixRow) => void }) {
  const u = useUxT();
  const { t } = useI18n();

  const cells = useMemo(() => {
    const out = new Map<string, Record<Col, CellData>>();
    for (const r of rows) {
      if (r.state !== 'ready' || !r.analysis) continue;
      const g = groupByTopic(r.analysis.findings);
      const rec = {} as Record<Col, CellData>;
      for (const topic of TOPICS) rec[topic] = { findings: g[topic], worst: worstOf(g[topic]) };
      const dev = r.analysis.findings.filter((f) => f.playbookDeviation);
      rec.playbook = { findings: dev, worst: dev.length ? 'High' : null };
      out.set(r.key, rec);
    }
    return out;
  }, [rows]);

  // «Другое» и «Плейбук» показываем, только если там хоть что-то есть, —
  // иначе пустые колонки выталкивают нужные за край таблицы.
  const cols = useMemo(
    () => COLS.filter((c) => (c !== 'other' && c !== 'playbook') || [...cells.values()].some((rec) => rec[c].findings.length > 0)),
    [cells],
  );

  const firstHit = useMemo(() => {
    for (const r of rows) {
      const rec = cells.get(r.key);
      if (!rec) continue;
      for (const c of cols) if (rec[c].worst === 'High' || rec[c].worst === 'Medium') return { row: r.key, col: c };
    }
    return null;
  }, [rows, cells, cols]);
  const [sel, setSel] = useState<{ row: string; col: Col } | null>(null);
  const current = sel ?? firstHit;

  const attention = useMemo(() => {
    let n = 0;
    for (const rec of cells.values()) for (const c of COLS) if (rec[c].worst === 'High' || rec[c].worst === 'Medium' || (c === 'playbook' && rec[c].findings.length)) n += 1;
    return n;
  }, [cells]);

  const colTitle = (c: Col) => u(`bm.topic.${c}`);
  // Подсказка «тема угадана по заголовку» — только если есть старые разборы без темы.
  const guessed = rows.some((r) => r.analysis?.findings.some((f) => !f.topic));

  const chip = (c: Col, d: CellData) => {
    if (!d.findings.length) return <span className={styles.okDot} title={u('bm.noRemarks')} aria-label={u('bm.noRemarks')} />;
    const n = d.findings.length > 1 ? ` ${d.findings.length}` : '';
    if (c === 'playbook') return <span className={`${styles.chip} ${styles.chipHigh}`}>{u('bm.deviation')}{n}</span>;
    if (d.worst === 'check') return <span className={`${styles.chip} ${styles.chipGrey}`}>{u('bm.check')}{n}</span>;
    return (
      <span className={`${styles.chip} ${SEV_CHIP[d.worst as Severity]}`}>
        {t(`sev.${d.worst}`)}
        {n}
      </span>
    );
  };

  const selRow = current ? rows.find((r) => r.key === current.row) : undefined;
  const selCell = current && selRow ? cells.get(selRow.key)?.[current.col] : undefined;
  const redlines = selRow?.analysis ? new Map(selRow.analysis.redlines.map((r) => [r.id, r])) : new Map();

  return (
    <div className={styles.block} style={{ gap: 12 }}>
      <div className={styles.row} style={{ justifyContent: 'space-between' }}>
        <span className={styles.summaryText}>{u('bm.attention', { n: attention })}</span>
        <span className={`${styles.muted} ${styles.small}`}>{u('bm.pick')}</span>
      </div>
      <div className={styles.matrixWrap}>
        <div className={styles.matrixCard}>
          <div className={styles.scrollX}>
            <table className={styles.mx}>
              <thead>
                <tr>
                  <th>{u('bm.contract')}</th>
                  {cols.map((c) => (
                    <th key={c}>{colTitle(c)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const rec = cells.get(r.key);
                  return (
                    <tr key={r.key}>
                      <td title={r.name}>
                        <span className={styles.mxName}>{r.name}</span>
                        {r.analysis ? <span className={styles.mxSub}>{t(`risk.${r.analysis.riskLevel}`)}, {r.analysis.riskScore}</span> : null}
                      </td>
                      {rec ? (
                        cols.map((c) => (
                          <td key={c}>
                            <button
                              type="button"
                              className={styles.cell}
                              aria-current={current?.row === r.key && current.col === c}
                              aria-label={`${r.name}: ${colTitle(c)}`}
                              onClick={() => setSel({ row: r.key, col: c })}
                            >
                              {chip(c, rec[c])}
                            </button>
                          </td>
                        ))
                      ) : (
                        <td colSpan={cols.length} style={{ textAlign: 'left' }}>
                          <span className={`${styles.muted} ${styles.small}`} style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
                            {r.state === 'loading' ? <Spinner size={13} /> : null}
                            {u(r.state === 'loading' ? 'bm.loading' : r.state === 'error' ? 'bm.failed' : 'bm.pending')}
                          </span>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className={styles.legend}>
            <span className={styles.row} style={{ gap: 6 }}>
              <span className={styles.okDot} />
              {u('bm.noRemarks')}
            </span>
            <span className={`${styles.chip} ${styles.chipHigh}`}>{t('sev.High')}</span>
            <span className={`${styles.chip} ${styles.chipMed}`}>{t('sev.Medium')}</span>
            <span className={`${styles.chip} ${styles.chipLow}`}>{t('sev.Low')}</span>
            <span className={`${styles.chip} ${styles.chipGrey}`}>{u('bm.check')}</span>
          </div>
        </div>

        <aside className={styles.detail} aria-live="polite">
          {selRow && selCell && current ? (
            <>
              <div className={styles.detailTop}>
                <span>{selRow.name}</span>
                <span>{colTitle(current.col)}</span>
              </div>
              <h4 className={styles.detailTitle}>{selCell.findings.length ? `${u('bm.findings')}: ${selCell.findings.length}` : u('bm.noRemarks')}</h4>
              {selCell.findings.length === 0 ? <p className={`${styles.muted} ${styles.small}`} style={{ margin: 0 }}>{u('bm.cellNone')}</p> : null}
              {selCell.findings.map((f) => {
                const rl = f.redlineId ? redlines.get(f.redlineId) : undefined;
                return (
                  <div key={f.id} className={styles.detailItem}>
                    <div className={styles.detailItemTitle} dir="auto">
                      <span className={styles.sevDot} style={{ '--sev': f.unverified ? 'var(--mut)' : SEV_VAR[f.severity] } as CSSProperties} />
                      {f.title}
                    </div>
                    {f.conflict ? (
                      <div className={styles.block} style={{ gap: 6 }}>
                        <span className={styles.lbl} style={{ margin: 0 }}>{u('fd.conflict')}</span>
                        <blockquote className={styles.quote} style={{ '--sev': SEV_VAR[f.severity] } as CSSProperties} dir="auto">
                          {f.conflict.a}
                        </blockquote>
                        <blockquote className={styles.quote} style={{ '--sev': SEV_VAR[f.severity] } as CSSProperties} dir="auto">
                          {f.conflict.b}
                        </blockquote>
                      </div>
                    ) : rl?.delText.trim() ? (
                      <div className={styles.block}>
                        <span className={styles.lbl}>{u('fd.inContract')}</span>
                        <blockquote className={styles.quote} style={{ '--sev': SEV_VAR[f.severity] } as CSSProperties} dir="auto">
                          {rl.delText}
                        </blockquote>
                      </div>
                    ) : null}
                    {f.citation?.trim() ? <CitationLine finding={f} /> : null}
                  </div>
                );
              })}
              {onOpen && selRow.documentId ? (
                <div>
                  <Button variant="secondary" size="sm" icon="docs" onClick={() => onOpen(selRow)}>
                    {u('rn.openDoc')}
                  </Button>
                </div>
              ) : null}
            </>
          ) : (
            <p className={`${styles.muted} ${styles.small}`} style={{ margin: 0 }}>
              {u('bm.pick')}
            </p>
          )}
        </aside>
      </div>
      {guessed ? (
        <p className={`${styles.muted} ${styles.small}`} style={{ margin: 0 }}>
          {u('bm.hint')}
        </p>
      ) : null}
    </div>
  );
}
