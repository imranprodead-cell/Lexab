import { Fragment, useState } from 'react';
import { Icon } from '@/components/icons/Icon';
import { Badge } from '@/components/ui/Badge';
import type { AnalysisResult } from '@/types/domain';
import { RedlineSpan } from './RedlineSpan';
import { useI18n } from '@/i18n/I18nProvider';
import styles from './workspace.module.css';

interface DocumentViewerProps {
  analysis: AnalysisResult;
  pendingCount: number;
  /** When provided, paragraphs become click-to-edit (live editor). */
  onSaveBlock?: (index: number, text: string) => void;
  children?: React.ReactNode; // floating toolbar slot
}

/** Resolve a paragraph's segments to plain text (redlines applied by status). */
function resolveParagraph(analysis: AnalysisResult, index: number): string {
  const block = analysis.document[index];
  const byId = new Map(analysis.redlines.map((r) => [r.id, r]));
  return (block.segments ?? [])
    .map((seg) => {
      if (typeof seg === 'string') return seg;
      const rl = byId.get(seg.redlineId);
      return rl ? (rl.status === 'rejected' ? rl.delText : rl.insText) : '';
    })
    .join('');
}

/** The right-hand paper view rendering the contract with inline AI redlines. */
export function DocumentViewer({ analysis, pendingCount, onSaveBlock, children }: DocumentViewerProps) {
  const { t } = useI18n();
  const redlineById = new Map(analysis.redlines.map((r) => [r.id, r]));
  const [editIdx, setEditIdx] = useState<number | null>(null);
  const [draft, setDraft] = useState('');

  const startEdit = (index: number) => {
    if (!onSaveBlock) return;
    setDraft(resolveParagraph(analysis, index));
    setEditIdx(index);
  };

  const commit = () => {
    if (editIdx === null) return;
    const text = draft.trim();
    if (text) onSaveBlock?.(editIdx, text);
    setEditIdx(null);
  };

  return (
    <section className={styles.rightPane} aria-label="Document viewer">
      <div className={styles.docHeader}>
        <div className={styles.docHeaderLeft}>
          <div className={styles.docHeaderIcon}>
            <Icon name="docs" size={17} />
          </div>
          <span className={styles.docName}>{analysis.fileName}</span>
        </div>
        {pendingCount > 0 ? (
          <Badge color="accent">{t('ws.suggestionsCount', { n: pendingCount })}</Badge>
        ) : (
          <Badge color="Low">{t('ws.allReviewedBadge')}</Badge>
        )}
      </div>

      <div className={`${styles.docBody} scroll`}>
        <article className={`${styles.paper} lx-print`}>
          <header className={styles.paperHeader}>
            <div className={styles.paperKicker}>{t('ws.paperKicker')}</div>
            <div className={styles.paperTitle}>
              {analysis.fileName.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ')}
            </div>
          </header>

          {analysis.document.map((block, i) =>
            block.type === 'heading' ? (
              <h3 key={i} className={styles.clauseHeading}>
                {block.text}
              </h3>
            ) : editIdx === i ? (
              <div key={i} className={styles.clauseEditWrap}>
                <textarea
                  className={styles.clauseEdit}
                  value={draft}
                  autoFocus
                  rows={Math.max(3, Math.ceil(draft.length / 90))}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') setEditIdx(null);
                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) commit();
                  }}
                />
                <div className={styles.clauseEditActions}>
                  <button className={styles.clauseEditBtn} onClick={() => setEditIdx(null)}>
                    Cancel
                  </button>
                  <button className={`${styles.clauseEditBtn} ${styles.clauseEditSave}`} onClick={commit}>
                    <Icon name="check" size={13} strokeWidth={2.2} /> Save
                  </button>
                </div>
              </div>
            ) : (
              <p key={i} className={`${styles.clause} ${onSaveBlock ? styles.clauseEditable : ''}`}>
                {block.segments?.map((seg, j) => {
                  if (typeof seg === 'string') return <Fragment key={j}>{seg}</Fragment>;
                  const rl = redlineById.get(seg.redlineId);
                  return rl ? <RedlineSpan key={j} redline={rl} /> : null;
                })}
                {onSaveBlock ? (
                  <button
                    type="button"
                    className={styles.clauseEditIcon}
                    title={t('ws.editParagraph')}
                    aria-label={t('ws.editParagraph')}
                    onClick={() => startEdit(i)}
                  >
                    <Icon name="pen" size={12} />
                  </button>
                ) : null}
              </p>
            ),
          )}
        </article>
      </div>

      {children}
    </section>
  );
}
