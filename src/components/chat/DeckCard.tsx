import { useState } from 'react';
import { Icon } from '@/components/icons/Icon';
import { Spinner } from '@/components/ui/Spinner';
import { useI18n } from '@/i18n/I18nProvider';
import { localeFor } from '@/i18n/dates';
import { downloadBlob } from '@/lib/download';
import { deckFileName, type Deck } from '@/lib/deck';
import { useUIStore } from '@/store/useUIStore';
import styles from './chat.module.css';

/**
 * Ответ на /slides: миниатюры слайдов прямо в чате и кнопка «Скачать .pptx».
 * Файл собирается в браузере по клику (deckPptx.ts грузится лениво).
 */
export function DeckCard({ deck, onOpen }: { deck: Deck; onOpen?: () => void }) {
  const { t, lang } = useI18n();
  const pushToast = useUIStore((s) => s.pushToast);
  const [building, setBuilding] = useState(false);

  const download = async () => {
    if (building) return;
    setBuilding(true);
    try {
      const { buildDeckPptx } = await import('@/lib/deckPptx');
      const blob = await buildDeckPptx(deck, {
        madeWith: t('deck.madeWith'),
        date: new Date().toLocaleDateString(localeFor(lang)),
        rtl: lang === 'ar',
      });
      downloadBlob(blob, deckFileName(deck));
    } catch {
      pushToast(t('deck.error'), 'error');
    } finally {
      setBuilding(false);
    }
  };

  return (
    <div className={styles.deckCard}>
      <div className={styles.deckHead}>
        <div className={styles.slashIcon} data-tone="slides">
          <Icon name="presentation" size={15} strokeWidth={1.8} />
        </div>
        <div className={styles.deckHeadText}>
          <div className={styles.deckLabel}>
            {t('deck.label')} · {t('deck.count', { n: deck.slides.length + 1 })}
          </div>
          <div className={styles.deckTitle}>{deck.title}</div>
        </div>
        {/* Кнопки — одной группой: в узкой колонке чата она целиком уходит
            на строку под названием, а не вылезает за край карточки. */}
        <div className={styles.deckActions}>
          {onOpen ? (
            <button type="button" className={styles.deckOpen} onClick={onOpen}>
              {t('artifact.open')}
            </button>
          ) : null}
          <button type="button" className={styles.deckDownload} onClick={() => void download()} disabled={building}>
            {building ? <Spinner size={14} /> : <Icon name="download" size={15} />}
            <span>{building ? t('deck.building') : t('deck.download')}</span>
          </button>
        </div>
      </div>

      {/* Миниатюры повторяют сам файл: тёмный титульный и белые слайды. */}
      <div className={styles.deckGrid}>
        <div className={`${styles.deckThumb} ${styles.deckThumbCover}`}>
          <span className={styles.deckCoverBrand}>LEXAB</span>
          <span className={styles.deckCoverRule} />
          <span className={styles.deckCoverTitle}>{deck.title}</span>
          {deck.subtitle ? <span className={styles.deckCoverSub}>{deck.subtitle}</span> : null}
        </div>
        {deck.slides.map((s, i) => (
          <div key={i} className={styles.deckThumb}>
            <span className={styles.deckThumbNum}>{i + 1}</span>
            <span className={styles.deckThumbTitle}>{s.title}</span>
            <span className={styles.deckThumbRule} />
            <ul className={styles.deckThumbList}>
              {s.bullets.slice(0, 4).map((b, j) => (
                <li key={j}>{b}</li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
