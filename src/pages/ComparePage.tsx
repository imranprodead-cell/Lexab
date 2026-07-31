import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { TopBar } from '@/components/layout/TopBar';
import { Icon } from '@/components/icons/Icon';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/States';
import { compareApi, type CompareResult } from '@/api/compare.api';
import { useUIStore } from '@/store/useUIStore';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useReveal } from '@/hooks/useReveal';
import { useI18n } from '@/i18n/I18nProvider';
import styles from './compare.module.css';

const ACCEPT = '.pdf,.doc,.docx,.txt';

/**
 * Word-level diff between two strings. Returns tokens tagged same/removed/added
 * using a simple longest-common-subsequence over words (good enough for a UI diff).
 */
function diffWords(a: string, b: string) {
  const aw = a.split(/(\s+)/);
  const bw = b.split(/(\s+)/);
  const n = aw.length;
  const m = bw.length;

  // The LCS below allocates an (n+1)×(m+1) matrix; on very long clauses that is
  // tens of millions of cells → the tab freezes/OOMs. Above a sane budget skip
  // the word-level diff and show each side as one removed/added block instead.
  // (aw/bw include whitespace tokens, so ~1200 tokens ≈ 600 words per side.)
  const MAX_DIFF_TOKENS = 1200;
  if (n > MAX_DIFF_TOKENS || m > MAX_DIFF_TOKENS) {
    return {
      before: a ? [{ text: a, removed: true }] : [],
      after: b ? [{ text: b, added: true }] : [],
    };
  }

  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      lcs[i][j] = aw[i] === bw[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);

  const before: { text: string; removed: boolean }[] = [];
  const after: { text: string; added: boolean }[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (aw[i] === bw[j]) {
      before.push({ text: aw[i], removed: false });
      after.push({ text: bw[j], added: false });
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      before.push({ text: aw[i], removed: true });
      i++;
    } else {
      after.push({ text: bw[j], added: true });
      j++;
    }
  }
  while (i < n) before.push({ text: aw[i++], removed: true });
  while (j < m) after.push({ text: bw[j++], added: true });
  return { before, after };
}

function FilePick({
  label,
  file,
  onPick,
  pickLabel,
}: {
  label: string;
  file: File | null;
  onPick: (f: File) => void;
  pickLabel: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div className={`panel ${styles.pickCard}`}>
      <input
        ref={ref}
        type="file"
        accept={ACCEPT}
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onPick(f);
          e.target.value = '';
        }}
      />
      <div className={styles.pickLabel}>{label}</div>
      {file ? (
        <div className={styles.pickFile}>
          <Icon name="docs" size={16} color="var(--accent)" />
          <span className={styles.pickFileName}>{file.name}</span>
        </div>
      ) : null}
      <Button size="sm" icon="upload" onClick={() => ref.current?.click()}>
        {pickLabel}
      </Button>
    </div>
  );
}

/** AI comparison of two contract versions. */
export function ComparePage() {
  const navigate = useNavigate();
  const { t } = useI18n();
  const pushToast = useUIStore((s) => s.pushToast);
  usePageTitle(t('cmp.title'));

  const [fileA, setFileA] = useState<File | null>(null);
  const [fileB, setFileB] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<CompareResult | null>(null);

  // Каскад появления страницы (эталонный reveal): заголовок → пикеры → кнопка.
  const headRef = useReveal(0);
  const pickRef = useReveal(0.08);
  const runRef = useReveal(0.16);

  const run = async () => {
    if (!fileA || !fileB) return;
    setBusy(true);
    try {
      setResult(await compareApi.run(fileA, fileB));
    } catch (err) {
      pushToast(err instanceof Error ? err.message : t('common.error'), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.page}>
      <TopBar
        title={t('cmp.title')}
        left={
          <button className={styles.backBtn} onClick={() => navigate('/chat')} aria-label={t('common.back')}>
            <Icon name="back" size={18} />
          </button>
        }
      />
      <div className={`${styles.body} scroll`}>
        <div className={styles.container}>
          <div className={styles.head} ref={headRef}>
            <div>
              <h1 className={styles.title}>{t('cmp.title')}</h1>
              <p className={styles.sub}>{t('cmp.sub')}</p>
            </div>
            {result ? <Badge color="accent">{t('cmp.changes', { n: result.changes.length })}</Badge> : null}
          </div>

          <div className={styles.pickRow} ref={pickRef}>
            <FilePick label={t('cmp.uploadA')} file={fileA} onPick={setFileA} pickLabel={t('cmp.pick')} />
            <FilePick label={t('cmp.uploadB')} file={fileB} onPick={setFileB} pickLabel={t('cmp.pick')} />
          </div>
          <div className={styles.runRow} ref={runRef}>
            <Button variant="primary" icon="layout" disabled={!fileA || !fileB || busy} onClick={() => void run()}>
              {busy ? t('common.loading') : t('cmp.run')}
            </Button>
            <span className={styles.hint}>{t('cmp.hint')}</span>
          </div>

          {!result ? (
            busy ? null : (
              <EmptyState icon="layout" title={t('cmp.title')} body={t('cmp.empty')} />
            )
          ) : (
            <>
              <div className={`panel ${styles.summaryCard}`}>
                <div className={styles.summaryHead}>
                  <Icon name="sparkle" size={15} color="var(--accent)" />
                  {t('cmp.aiSummary')}
                </div>
                {result.summary}
              </div>

              <div className={styles.cols}>
                <div className={styles.colHead}>
                  <Icon name="docs" size={15} /> {result.fileA}
                </div>
                <div className={styles.colHead}>
                  <Icon name="docs" size={15} /> {result.fileB}
                </div>
              </div>

              {result.changes.map((c, idx) => {
                const { before, after } = diffWords(c.before, c.after);
                return (
                  <div key={idx}>
                    <div className={styles.changeMeta}>
                      <Badge color={c.severity} plain>
                        {c.severity}
                      </Badge>
                      <span className={styles.changeComment}>{c.comment}</span>
                    </div>
                    <div className={styles.row}>
                      <div className={`${styles.cell} ${styles.cellChanged}`}>
                        <div className={styles.clauseHeading}>{c.heading}</div>
                        <p className={styles.clauseText}>
                          {c.kind === 'added' ? (
                            <span className={styles.mutedNote}>—</span>
                          ) : (
                            before.map((tok, k) =>
                              tok.removed ? (
                                <span key={k} className={styles.removed}>
                                  {tok.text}
                                </span>
                              ) : (
                                <span key={k}>{tok.text}</span>
                              ),
                            )
                          )}
                        </p>
                      </div>
                      <div className={`${styles.cell} ${styles.cellChangedNew}`}>
                        <div className={styles.clauseHeading}>{c.heading}</div>
                        <p className={styles.clauseText}>
                          {c.kind === 'removed' ? (
                            <span className={styles.mutedNote}>—</span>
                          ) : (
                            after.map((tok, k) =>
                              tok.added ? (
                                <span key={k} className={styles.added}>
                                  {tok.text}
                                </span>
                              ) : (
                                <span key={k}>{tok.text}</span>
                              ),
                            )
                          )}
                        </p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
