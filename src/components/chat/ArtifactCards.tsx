import { Icon } from '@/components/icons/Icon';
import { useI18n } from '@/i18n/I18nProvider';
import styles from './chat.module.css';

/**
 * Карточки артефактов внутри ответа ИИ: документ (вместо серого блока кода)
 * и большая таблица (превью вместо сплющенной таблицы). Целиком — в боковой
 * панели по кнопке «Открыть».
 */

export function DocArtifactCard({ title, content, onOpen }: { title: string; content: string; onOpen: () => void }) {
  const { t } = useI18n();
  const preview = content
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 3);
  return (
    <div className={styles.artCard}>
      <div className={styles.artHead}>
        <div className={styles.slashIcon} data-tone="analyze">
          <Icon name="doc" size={15} strokeWidth={1.8} />
        </div>
        <div className={styles.artHeadText}>
          <div className={styles.artTitle}>{title}</div>
          <div className={styles.artSub}>{t('artifact.editable')}</div>
        </div>
        <button type="button" className={styles.artOpen} onClick={onOpen}>
          {t('artifact.open')}
        </button>
      </div>
      <button type="button" className={styles.artPreview} onClick={onOpen} tabIndex={-1} aria-hidden="true">
        {preview.map((l, i) => (
          <span key={i}>{l}</span>
        ))}
      </button>
    </div>
  );
}

const PREVIEW_ROWS = 4;
const PREVIEW_COLS = 4;

export function TableArtifactCard({
  title,
  header,
  rows,
  onOpen,
}: {
  title: string;
  header: string[];
  rows: string[][];
  onOpen: () => void;
}) {
  const { t } = useI18n();
  const cols = header.slice(0, PREVIEW_COLS);
  const more = rows.length - PREVIEW_ROWS;
  return (
    <div className={styles.artCard}>
      <div className={styles.artHead}>
        <div className={styles.slashIcon} data-tone="plan">
          <Icon name="table" size={15} strokeWidth={1.8} />
        </div>
        <div className={styles.artHeadText}>
          <div className={styles.artTitle}>{title}</div>
          <div className={styles.artSub}>{t('artifact.size', { rows: rows.length, cols: header.length })}</div>
        </div>
        <button type="button" className={styles.artOpen} onClick={onOpen}>
          {t('artifact.open')}
        </button>
      </div>
      <button type="button" className={styles.artTablePreview} onClick={onOpen} tabIndex={-1} aria-hidden="true">
        <table>
          <thead>
            <tr>
              {cols.map((h, i) => (
                <th key={i}>{h}</th>
              ))}
              {header.length > PREVIEW_COLS ? <th>…</th> : null}
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, PREVIEW_ROWS).map((r, ri) => (
              <tr key={ri}>
                {cols.map((_, ci) => (
                  <td key={ci}>{r[ci]}</td>
                ))}
                {header.length > PREVIEW_COLS ? <td>…</td> : null}
              </tr>
            ))}
          </tbody>
        </table>
        {more > 0 ? <span className={styles.artMore}>{t('artifact.moreRows', { n: more })}</span> : null}
      </button>
    </div>
  );
}
