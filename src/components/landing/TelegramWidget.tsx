import { useEffect, useState, type RefObject } from 'react';
import { useI18n } from '@/i18n/I18nProvider';
import { scrollBehavior } from '@/lib/scroll';
import styles from './telegramWidget.module.css';

const TELEGRAM_URL = 'https://t.me/MANAGER_CIVIS';

/** Paper-plane glyph in the app's stroke-icon style. */
function PlaneGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M22 2 11 13" />
      <path d="M22 2 15 22l-4-9-9-4z" />
    </svg>
  );
}

/**
 * QR code for t.me/MANAGER_CIVIS — generated offline with the `qrcode`
 * package (error correction M) and verified to decode back to the URL.
 * Black modules on a white card, like the reference design.
 */
function TelegramQr() {
  return (
    <svg viewBox="0 0 25 25" shapeRendering="crispEdges" className={styles.qrSvg} aria-hidden="true">
      <path fill="#ffffff" d="M0 0h25v25H0z" />
      <path
        stroke="#000000"
        d="M0 0.5h7m1 0h1m2 0h1m1 0h3m2 0h7M0 1.5h1m5 0h1m2 0h6m1 0h1m1 0h1m5 0h1M0 2.5h1m1 0h3m1 0h1m1 0h2m2 0h2m1 0h2m1 0h1m1 0h3m1 0h1M0 3.5h1m1 0h3m1 0h1m3 0h1m1 0h1m1 0h1m3 0h1m1 0h3m1 0h1M0 4.5h1m1 0h3m1 0h1m2 0h1m3 0h3m2 0h1m1 0h3m1 0h1M0 5.5h1m5 0h1m1 0h3m3 0h1m3 0h1m5 0h1M0 6.5h7m1 0h1m1 0h1m1 0h1m1 0h1m1 0h1m1 0h7M9 7.5h1m1 0h1m2 0h3M0 8.5h1m1 0h1m3 0h2m3 0h3m2 0h1m2 0h1m2 0h1m1 0h1M0 9.5h1m1 0h2m1 0h1m4 0h1m1 0h1m1 0h1m1 0h1m1 0h1m2 0h1m1 0h2M0 10.5h1m1 0h8m2 0h1m1 0h2m3 0h4m1 0h1M2 11.5h1m4 0h2m9 0h2m1 0h1M0 12.5h1m1 0h1m3 0h2m1 0h1m1 0h3m1 0h2m1 0h1m5 0h1M2 13.5h1m1 0h2m4 0h1m2 0h2m1 0h1m1 0h2m3 0h2M0 14.5h2m2 0h1m1 0h1m1 0h1m1 0h2m3 0h1m5 0h2m1 0h1M3 15.5h3m3 0h3m2 0h1m1 0h2m1 0h3M0 16.5h4m2 0h1m3 0h2m1 0h1m2 0h5m2 0h1M8 17.5h2m2 0h1m3 0h1m3 0h1m3 0h1M0 18.5h7m1 0h1m1 0h2m2 0h3m1 0h1m1 0h1m3 0h1M0 19.5h1m5 0h1m2 0h2m3 0h3m3 0h1m3 0h1M0 20.5h1m1 0h3m1 0h1m2 0h1m2 0h2m1 0h6m2 0h1M0 21.5h1m1 0h3m1 0h1m3 0h1m1 0h2m1 0h3m2 0h1m1 0h2M0 22.5h1m1 0h3m1 0h1m1 0h2m1 0h4m2 0h1m1 0h3m1 0h2M0 23.5h1m5 0h1m4 0h2m1 0h1m1 0h2m1 0h2M0 24.5h7m1 0h4m1 0h1m1 0h2m1 0h1m2 0h1m2 0h1"
      />
    </svg>
  );
}

/**
 * Floating contact dock pinned to the middle of the right edge: a Telegram
 * pill that glows on hover and reveals a QR popover (@MANAGER_CIVIS), plus a
 * back-to-top button that appears once the page is scrolled.
 * `scrollRef` is the page's scroll container (#root is overflow:hidden).
 */
export function TelegramWidget({
  scrollRef,
  hidden = false,
}: {
  scrollRef: RefObject<HTMLDivElement | null>;
  hidden?: boolean;
}) {
  const { t } = useI18n();
  const [showTop, setShowTop] = useState(false);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => setShowTop(el.scrollTop > 420);
    el.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => el.removeEventListener('scroll', onScroll);
  }, [scrollRef]);

  return (
    <div className={`${styles.dock} ${hidden ? styles.dockHidden : ''}`}>
      <div className={styles.tg}>
        <a
          className={styles.tgBtn}
          href={TELEGRAM_URL}
          target="_blank"
          rel="noreferrer noopener"
          aria-label="Telegram — @MANAGER_CIVIS"
        >
          <span className={styles.tgIcon}>
            <PlaneGlyph />
          </span>
          <span className={styles.tgLabel}>Telegram</span>
        </a>

        <div className={styles.qrPop} role="tooltip">
          <div className={styles.qrTitle}>{t('landing.tg.title')}</div>
          <div className={styles.qrCard}>
            <TelegramQr />
          </div>
          <div className={styles.qrUser}>@MANAGER_CIVIS</div>
          <div className={styles.qrHint}>{t('landing.tg.scan')}</div>
          <span className={styles.qrArrow} aria-hidden="true" />
        </div>
      </div>

      <button
        type="button"
        className={`${styles.toTop} ${showTop ? styles.toTopVisible : ''}`}
        onClick={() => scrollRef.current?.scrollTo({ top: 0, behavior: scrollBehavior() })}
        aria-label={t('landing.toTop')}
        title={t('landing.toTop')}
      >
        <svg
          viewBox="0 0 24 24"
          width="18"
          height="18"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M5 4h14" />
          <path d="M12 20V8" />
          <path d="m7 13 5-5 5 5" />
        </svg>
      </button>
    </div>
  );
}
