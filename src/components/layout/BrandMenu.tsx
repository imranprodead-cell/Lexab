import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from '@/components/icons/Icon';
import { useDismissable } from '@/hooks/useAsync';
import { useI18n } from '@/i18n/I18nProvider';
import styles from './layout.module.css';

/**
 * The "Lexab ⌄" brand switcher in the chat top bar. Opens a ChatGPT-style
 * dropdown: a Pro upsell row (with an Upgrade button) and the current tier.
 */
export function BrandMenu() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const ref = useDismissable<HTMLDivElement>(() => setOpen(false), open);

  return (
    <div className={styles.brandMenuWrap} ref={ref}>
      <button
        type="button"
        className={styles.brandMenuBtn}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className={styles.brandMenuName}>Lexab</span>
        <span className={`${styles.brandMenuChevron} ${open ? styles.brandMenuChevronOpen : ''}`}>
          <Icon name="chevron" size={16} />
        </span>
      </button>

      {open ? (
        <div className={`glass ${styles.brandMenu}`} role="menu">
          <div className={styles.brandMenuItem}>
            <span className={styles.brandMenuIcon}>
              <Icon name="sparkle" size={18} />
            </span>
            <div className={styles.brandMenuText}>
              <div className={styles.brandMenuItemTitle}>Lexab Pro</div>
              <div className={styles.brandMenuItemDesc}>{t('brand.proDesc')}</div>
            </div>
            <button
              type="button"
              className={styles.brandUpgradeBtn}
              onClick={() => {
                setOpen(false);
                navigate('/plans');
              }}
            >
              {t('top.upgrade')}
            </button>
          </div>

          <button
            type="button"
            className={`${styles.brandMenuItem} ${styles.brandMenuItemActive}`}
            role="menuitemradio"
            aria-checked={true}
            onClick={() => setOpen(false)}
          >
            <span className={styles.brandMenuIcon}>
              <Icon name="shield" size={18} />
            </span>
            <div className={styles.brandMenuText}>
              <div className={styles.brandMenuItemTitle}>Lexab</div>
              <div className={styles.brandMenuItemDesc}>{t('brand.baseDesc')}</div>
            </div>
            <span className={styles.brandMenuCheck}>
              <Icon name="check" size={16} />
            </span>
          </button>
        </div>
      ) : null}
    </div>
  );
}
