import { Fragment, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from '@/components/icons/Icon';
import { Button } from '@/components/ui/Button';
import { useUxT } from '@/i18n/uxMessages';
import type { RenewalMark } from '@/lib/renewal';
import { renewalInfo } from '@/lib/renewal';
import { BatchMatrix, type MatrixRow } from './BatchMatrix';
import { DeadlinePanel, RenewalCell } from './Deadline';
import { activeMark, useShortDate } from './uxHooks';
import { SAMPLE_CLAUSES, sampleBatch, sampleContracts } from './sampleData';
import styles from './ux.module.css';

/**
 * Образец вместо пустой страницы «Контракты»: новый пользователь (или тариф без
 * этой функции) видит, что получит, и может потрогать образец. Отметки на
 * образце живут только в памяти — в реестр ничего не пишется.
 */
export function SampleContracts({ locked }: { locked: boolean }) {
  const u = useUxT();
  const navigate = useNavigate();
  const short = useShortDate();
  const rows = useMemo(() => sampleContracts(), []);
  const [trying, setTrying] = useState(false);
  const [sel, setSel] = useState<string | null>(rows[0].documentId);
  const [marks, setMarks] = useState<Record<string, RenewalMark>>({});

  const sorted = useMemo(
    () =>
      [...rows].sort((a, b) => {
        const la = renewalInfo(a.terms);
        const lb = renewalInfo(b.terms);
        const ka = la.kind === 'notice' ? la.last : `9${a.terms.expiryDate}`;
        const kb = lb.kind === 'notice' ? lb.last : `9${b.terms.expiryDate}`;
        return ka.localeCompare(kb);
      }),
    [rows],
  );

  const upload = () => navigate('/chat');
  const plans = () => navigate('/plans');

  return (
    <div className={styles.sampleZone}>
      {trying ? (
        <div className={styles.banner}>
          <Icon name="eye" size={15} />
          <span>{u('sm.banner')}</span>
          <Button variant="primary" size="sm" onClick={locked ? plans : upload}>
            {u(locked ? 'sm.toPro' : 'sm.uploadOwn')}
          </Button>
          <button type="button" className={styles.link} onClick={() => setTrying(false)}>
            {u('sm.hide')}
          </button>
        </div>
      ) : null}
      <div className={`${styles.matrixCard} ${trying ? '' : styles.faded}`} aria-hidden={!trying}>
        <div className={styles.scrollX}>
          <table className={styles.sampleTable}>
            <thead>
              <tr>
                <th>{u('rn.col')}</th>
                <th>{u('bm.contract')}</th>
                <th className={styles.hideNarrow}>{u('rn.ifNothing').replace(/:$/, '')}</th>
                <th aria-hidden="true" />
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => {
                const info = renewalInfo(r.terms);
                const open = trying && sel === r.documentId;
                return (
                  <Fragment key={r.documentId}>
                    <tr
                      aria-selected={open}
                      tabIndex={trying ? 0 : -1}
                      onClick={() => setSel(open ? null : r.documentId)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          setSel(open ? null : r.documentId);
                        }
                      }}
                    >
                      <td>
                        <RenewalCell row={r} mark={marks[r.documentId]} />
                      </td>
                      <td>
                        <div style={{ fontWeight: 500 }}>{r.name}</div>
                        <div className={`${styles.muted} ${styles.small}`}>{r.counterparty}</div>
                      </td>
                      <td className={`${styles.muted} ${styles.small} ${styles.hideNarrow}`}>
                        {info.kind === 'notice' && !activeMark(info, marks[r.documentId]) ? u('rn.renews') : info.kind === 'noRenew' ? u('rn.noRenew', { date: short(info.end) }) : '—'}
                      </td>
                      <td style={{ width: 28 }}>
                        <Icon name="chevron" size={14} style={{ transform: open ? 'rotate(-90deg)' : 'rotate(90deg)', color: 'var(--dim)' }} />
                      </td>
                    </tr>
                    {open ? (
                      <tr>
                        <td colSpan={4} style={{ cursor: 'default', background: 'var(--panel)' }}>
                          <DeadlinePanel
                            row={r}
                            mark={marks[r.documentId]}
                            sample
                            sampleClause={SAMPLE_CLAUSES[r.documentId]}
                            onMark={(m) =>
                              setMarks((prev) => {
                                const next = { ...prev };
                                if (m) next[r.documentId] = m;
                                else delete next[r.documentId];
                                return next;
                              })
                            }
                          />
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      {!trying ? (
        <div className={styles.cta}>
          <div className={styles.ctaKicker}>
            {locked ? u('sm.free') : u('sm.badge')}
          </div>
          <div className={styles.ctaTitle}>{u(locked ? 'sm.lockedContracts' : 'sm.contractsTitle')}</div>
          <p className={styles.ctaBody}>{u(locked ? 'sm.lockedContractsBody' : 'sm.contractsBody')}</p>
          <div className={styles.ctaBtns}>
            {locked ? (
              <>
                <Button variant="primary" onClick={() => setTrying(true)}>
                  {u('sm.try')}
                </Button>
                <Button variant="secondary" onClick={plans}>
                  {u('sm.plans')}
                </Button>
              </>
            ) : (
              <>
                <Button variant="primary" icon="upload" onClick={upload}>
                  {u('sm.upload')}
                </Button>
                <Button variant="secondary" onClick={() => setTrying(true)}>
                  {u('sm.view')}
                </Button>
              </>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** Образец таблицы проверок на экране «Массовый разбор — на тарифе Pro». */
export function SampleBatch() {
  const u = useUxT();
  const navigate = useNavigate();
  const [trying, setTrying] = useState(false);
  const rows: MatrixRow[] = useMemo(() => sampleBatch().map((r) => ({ key: r.key, name: r.name, state: 'ready', analysis: r.analysis })), []);
  return (
    <div className={styles.sampleZone}>
      {trying ? (
        <div className={styles.banner}>
          <Icon name="eye" size={15} />
          <span>{u('sm.banner')}</span>
          <Button variant="primary" size="sm" onClick={() => navigate('/plans')}>
            {u('sm.toPro')}
          </Button>
          <button type="button" className={styles.link} onClick={() => setTrying(false)}>
            {u('sm.hide')}
          </button>
        </div>
      ) : null}
      <div className={trying ? '' : styles.faded} aria-hidden={!trying}>
        <BatchMatrix rows={rows} />
      </div>
      {!trying ? (
        <div className={styles.cta}>
          <div className={styles.ctaKicker}>{u('sm.free')}</div>
          <div className={styles.ctaTitle}>{u('sm.lockedBatch')}</div>
          <p className={styles.ctaBody}>{u('sm.lockedBatchBody')}</p>
          <div className={styles.ctaBtns}>
            <Button variant="primary" onClick={() => setTrying(true)}>
              {u('sm.try')}
            </Button>
            <Button variant="secondary" onClick={() => navigate('/plans')}>
              {u('sm.plans')}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
