import { useEffect, useState } from 'react';
import { lawApi, type LawUnit } from '@/api/law.api';
import { Icon } from '@/components/icons/Icon';
import { Spinner } from '@/components/ui/Spinner';
import { useUxT } from '@/i18n/uxMessages';
import styles from './ux.module.css';

const hostOf = (url: string): string => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
};

/**
 * «В законе»: текст статьи из базы законов прямо в карточке находки.
 * Текст ТОЛЬКО из корпуса (lawApi.unit), никогда не генерируется. Длинная
 * статья свёрнута до четырёх строк, «Показать статью целиком» раскрывает.
 */
export function LawQuote({ unitId, sourceNumber, onSource }: { unitId: string; sourceNumber?: number; onSource?: () => void }) {
  const u = useUxT();
  const [unit, setUnit] = useState<LawUnit | null>(null);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    setUnit(null);
    setFailed(false);
    lawApi
      .unit(unitId)
      .then((x) => alive && setUnit(x))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [unitId]);

  if (failed || (unit && typeof unit.text !== 'string')) return <p className={`${styles.muted} ${styles.small}`}>{u('fd.lawFailed')}</p>;
  if (!unit) return <Spinner size={14} />;

  const url = unit.officialUrl || unit.sourceUrl;
  const long = unit.text.length > 320 || unit.text.split('\n').length > 4;
  return (
    <div className={styles.law}>
      <span className={styles.lawCite} dir="auto">
        {unit.breadcrumb}
      </span>
      {/* Обрезка — на внутреннем блоке: у цитаты есть внутренние отступы, и
          line-clamp на ней самой показывал половину пятой строки. */}
      <blockquote className={`${styles.quote} ${styles.lawText}`} dir="auto">
        <span className={long && !open ? styles.clamp : undefined}>{unit.text}</span>
      </blockquote>
      <div className={styles.lawFoot}>
        <span className={styles.verified}>
          <Icon name="check" size={13} strokeWidth={2.2} />
          {u('fd.verified')}
        </span>
        {long ? (
          <button type="button" className={styles.link} onClick={() => setOpen((v) => !v)} aria-expanded={open}>
            {u(open ? 'fd.collapse' : 'fd.showAll')}
          </button>
        ) : null}
        {url ? (
          <a className={styles.link} href={url} target="_blank" rel="noopener noreferrer">
            {hostOf(url)}
            <Icon name="arrowUpRight" size={12} />
          </a>
        ) : null}
        {sourceNumber && onSource ? (
          <button type="button" className={styles.srcChip} onClick={onSource} title={u('fd.toSource')} aria-label={u('fd.toSource')}>
            {sourceNumber}
          </button>
        ) : null}
      </div>
    </div>
  );
}
