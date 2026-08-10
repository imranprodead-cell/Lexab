import { useEffect, useState, type RefObject } from 'react';
import { motion } from 'motion/react';
import { EASE } from '@/lib/motion';
import { useI18n } from '@/i18n/I18nProvider';
import { scrollBehavior } from '@/lib/scroll';
import styles from './telegramWidget.module.css';
import { MANAGER_TELEGRAM, MANAGER_TELEGRAM_LABEL } from '@/lib/contacts';

const TELEGRAM_URL = MANAGER_TELEGRAM;
const WHATSAPP_URL = 'https://wa.me/998336132250';
const WHATSAPP_PHONE = '+998 33 613 22 50';

/** Paper-plane glyph in the app's stroke-icon style. */
function PlaneGlyph() {
  return (
    <svg
      className={styles.planeSvg}
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

/** Speech-bubble + handset glyph in the app's stroke-icon style. */
function WhatsAppGlyph() {
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
      <path d="M3 21l1.65-3.8a9 9 0 1 1 3.4 2.9L3 21" />
      <path d="M9 10a.5.5 0 0 0 1 0V9a.5.5 0 0 0-1 0v1a5 5 0 0 0 5 5h1a.5.5 0 0 0 0-1h-1a.5.5 0 0 0 0 1" />
    </svg>
  );
}

/**
 * QR-код на MANAGER_TELEGRAM — сгенерирован офлайн пакетом `qrcode`
 * (коррекция M) и проверен обратным декодированием в тот же адрес.
 *
 * ВНИМАНИЕ: адрес зашит в путь картинки, поиском по тексту его не найти.
 * Меняется аккаунт в src/lib/contacts.ts — этот путь надо ПЕРЕГЕНЕРИРОВАТЬ,
 * иначе люди со сканера уйдут на старый аккаунт (так и случилось при
 * переименовании Civis → Lexab).
 */
function TelegramQr() {
  return (
    <svg viewBox="0 0 25 25" shapeRendering="crispEdges" className={styles.qrSvg} aria-hidden="true">
      <path fill="#ffffff" d="M0 0h25v25H0z" />
      <path
        stroke="#000000"
        d="M0 0.5h7m1 0h2m3 0h3m2 0h7M0 1.5h1m5 0h1m1 0h3m5 0h1m1 0h1m5 0h1M0 2.5h1m1 0h3m1 0h1m1 0h1m2 0h1m1 0h4m1 0h1m1 0h3m1 0h1M0 3.5h1m1 0h3m1 0h1m9 0h1m1 0h1m1 0h3m1 0h1M0 4.5h1m1 0h3m1 0h1m1 0h4m2 0h3m1 0h1m1 0h3m1 0h1M0 5.5h1m5 0h1m4 0h2m1 0h1m1 0h1m1 0h1m5 0h1M0 6.5h7m1 0h1m1 0h1m1 0h1m1 0h1m1 0h1m1 0h7M11 7.5h1m1 0h1m1 0h2M0 8.5h1m2 0h6m2 0h4m1 0h2m2 0h1m1 0h3M1 9.5h1m2 0h2m1 0h6m7 0h4M2 10.5h1m2 0h2m1 0h1m4 0h4m3 0h2m2 0h1M1 11.5h2m1 0h2m1 0h1m2 0h3m3 0h2m1 0h1m1 0h4M0 12.5h1m1 0h2m1 0h3m3 0h3m1 0h2m1 0h1m5 0h1M0 13.5h2m6 0h2m2 0h1m3 0h1m3 0h1m2 0h1M0 14.5h2m1 0h1m1 0h2m1 0h1m3 0h1m1 0h2m1 0h1m2 0h5M0 15.5h1m1 0h3m2 0h2m1 0h3m4 0h3m1 0h2m1 0h1M0 16.5h1m2 0h1m1 0h3m1 0h1m1 0h2m3 0h5m1 0h2M8 17.5h1m1 0h1m2 0h1m2 0h1m3 0h1m1 0h2M0 18.5h7m1 0h2m1 0h1m1 0h1m1 0h2m1 0h1m1 0h1m3 0h1M0 19.5h1m5 0h1m1 0h2m2 0h5m3 0h1M0 20.5h1m1 0h3m1 0h1m1 0h1m3 0h1m1 0h7M0 21.5h1m1 0h3m1 0h1m1 0h2m1 0h1m2 0h2m1 0h2m4 0h2M0 22.5h1m1 0h3m1 0h1m2 0h4m3 0h2m2 0h5M0 23.5h1m5 0h1m2 0h4m1 0h1m3 0h3m1 0h3M0 24.5h7m1 0h1m1 0h1m4 0h2m1 0h1m2 0h1m2 0h1"
      />
    </svg>
  );
}

/**
 * QR code for wa.me/998336132250 — generated offline with the `qrcode`
 * package (error correction M) and verified to decode back to the URL.
 */
function WhatsAppQr() {
  return (
    <svg viewBox="0 0 25 25" shapeRendering="crispEdges" className={styles.qrSvg} aria-hidden="true">
      <path fill="#ffffff" d="M0 0h25v25H0z" />
      <path
        stroke="#000000"
        d="M0 0.5h7m3 0h3m1 0h3m1 0h7M0 1.5h1m5 0h1m2 0h2m1 0h1m1 0h2m2 0h1m5 0h1M0 2.5h1m1 0h3m1 0h1m1 0h3m1 0h1m3 0h1m1 0h1m1 0h3m1 0h1M0 3.5h1m1 0h3m1 0h1m1 0h5m2 0h1m2 0h1m1 0h3m1 0h1M0 4.5h1m1 0h3m1 0h1m1 0h1m1 0h1m1 0h2m2 0h1m1 0h1m1 0h3m1 0h1M0 5.5h1m5 0h1m1 0h2m1 0h1m4 0h1m1 0h1m5 0h1M0 6.5h7m1 0h1m1 0h1m1 0h1m1 0h1m1 0h1m1 0h7M8 7.5h2m1 0h1M0 8.5h1m1 0h5m2 0h3m2 0h3m1 0h5M0 9.5h4m7 0h1m7 0h1m3 0h1M1 10.5h1m1 0h4m6 0h1m1 0h1m2 0h4m1 0h2M0 11.5h1m1 0h1m1 0h1m3 0h2m1 0h1m1 0h3m1 0h3m4 0h1M0 12.5h3m3 0h1m2 0h1m2 0h5m1 0h3m1 0h3M0 13.5h2m1 0h1m1 0h1m1 0h3m3 0h1m1 0h1m3 0h1m1 0h1m1 0h1M0 14.5h1m1 0h3m1 0h1m1 0h5m2 0h3m1 0h3m1 0h2M0 15.5h1m1 0h2m3 0h2m1 0h2m4 0h1m2 0h2m3 0h1M0 16.5h1m1 0h2m2 0h2m3 0h1m4 0h5m1 0h1M8 17.5h1m1 0h1m1 0h2m1 0h2m3 0h2M0 18.5h7m2 0h2m2 0h2m1 0h1m1 0h1m1 0h1m1 0h3M0 19.5h1m5 0h1m1 0h1m3 0h2m1 0h2m3 0h2M0 20.5h1m1 0h3m1 0h1m1 0h2m2 0h1m1 0h7m1 0h2M0 21.5h1m1 0h3m1 0h1m1 0h3m6 0h2m1 0h3m1 0h1M0 22.5h1m1 0h3m1 0h1m1 0h1m2 0h2m8 0h2m1 0h1M0 23.5h1m5 0h1m2 0h3m2 0h4m1 0h3m2 0h1M0 24.5h7m1 0h4m5 0h8"
      />
    </svg>
  );
}

/**
 * Floating contact dock pinned to the middle of the right edge: Telegram and
 * WhatsApp pills that glow on hover and reveal a QR popover, plus a
 * back-to-top button that appears once the page is scrolled.
 * Both popovers are anchored to the shared `.items` wrapper, so they open in
 * exactly the same spot regardless of which pill is hovered.
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
      <div className={styles.items}>
        <div className={styles.tg}>
          {/* Эталон FloatingContacts.tsx: y:16→0 за 0.5s EASE, delay 1 + i*0.1;
              whileHover 1.06 / whileTap 0.95. */}
          <motion.a
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: EASE, delay: 1 }}
            whileHover={{ scale: 1.06 }}
            whileTap={{ scale: 0.95 }}
            className={`glass ${styles.tgBtn}`}
            href={TELEGRAM_URL}
            target="_blank"
            rel="noreferrer noopener"
            aria-label={`Telegram — ${MANAGER_TELEGRAM_LABEL}`}
          >
            <span className={styles.tgIcon}>
              <PlaneGlyph />
            </span>
          </motion.a>

          <div className={styles.qrPop} role="tooltip">
            <div className={styles.qrTitle}>{t('landing.tg.title')}</div>
            <div className={styles.qrCard}>
              <TelegramQr />
            </div>
            <div className={styles.qrUser}>{MANAGER_TELEGRAM_LABEL}</div>
            <div className={styles.qrHint}>{t('landing.tg.scan')}</div>
            <span className={styles.qrArrow} aria-hidden="true" />
          </div>
        </div>

        <div className={styles.tg}>
          <motion.a
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: EASE, delay: 1.1 }}
            whileHover={{ scale: 1.06 }}
            whileTap={{ scale: 0.95 }}
            className={`glass ${styles.tgBtn}`}
            href={WHATSAPP_URL}
            target="_blank"
            rel="noreferrer noopener"
            aria-label={`WhatsApp — ${WHATSAPP_PHONE}`}
          >
            <span className={styles.tgIcon}>
              <WhatsAppGlyph />
            </span>
          </motion.a>

          <div className={styles.qrPop} role="tooltip">
            <div className={styles.qrTitle}>{t('landing.wa.title')}</div>
            <div className={styles.qrCard}>
              <WhatsAppQr />
            </div>
            <div className={styles.qrUser}>{WHATSAPP_PHONE}</div>
            <div className={styles.qrHint}>{t('landing.tg.scan')}</div>
            <span className={styles.qrArrow} aria-hidden="true" />
          </div>
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
