import styles from './ui.module.css';

/** A monospace legal-citation chip (e.g. "Employment Rights Act 1996, s.86"). */
export function CitationChip({ citation }: { citation: string }) {
  return (
    // В узкой колонке ссылка переносится внутри аккуратного прямоугольника
    // (скругление фиксированное, а не 999px — иначе выходил «овал»).
    <span className={styles.chip} title={citation}>
      <span className={styles.chipMark} />
      <span className={styles.chipText}>{citation}</span>
    </span>
  );
}
