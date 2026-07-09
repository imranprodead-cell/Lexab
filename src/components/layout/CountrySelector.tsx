import { useMemo, useRef, useState } from 'react';
import { Icon } from '@/components/icons/Icon';
import { GlassCard } from '@/components/ui/GlassCard';
import { useDismissable } from '@/hooks/useAsync';
import { COUNTRIES, countryName } from '@/data/countries';
import { useUIStore } from '@/store/useUIStore';
import { useI18n } from '@/i18n/I18nProvider';
import { Flag } from './Flag';
import styles from './layout.module.css';

/** Searchable jurisdiction picker shown in the top bar. Opens on hover.
 *  The chosen country becomes the default law context for AI analyses & chat. */
export function CountrySelector() {
  const { t, lang } = useI18n();
  const country = useUIStore((s) => s.country);
  const setCountry = useUIStore((s) => s.setCountry);
  const pushToast = useUIStore((s) => s.pushToast);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const ref = useDismissable<HTMLDivElement>(() => setOpen(false), open);

  // Hover-to-open with a small close delay, so the cursor can travel from the
  // flag to the dropdown without the menu snapping shut.
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hoverOpen = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    setOpen(true);
  };
  const hoverClose = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => {
      setOpen(false);
      setQuery('');
    }, 180);
  };

  const current = COUNTRIES.find((c) => c.code === country) ?? COUNTRIES[1];
  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return COUNTRIES;
    return COUNTRIES.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.nameEn.toLowerCase().includes(q) ||
        c.law.toLowerCase().includes(q) ||
        c.code.toLowerCase().includes(q),
    );
  }, [query]);

  const pick = (code: string) => {
    const changed = code !== country;
    setCountry(code);
    setOpen(false);
    setQuery('');
    if (changed) {
      const picked = COUNTRIES.find((c) => c.code === code);
      if (picked) pushToast(t('country.aiNote', { law: picked.law }), 'success');
    }
  };

  return (
    <div className={styles.country} ref={ref} onMouseEnter={hoverOpen} onMouseLeave={hoverClose}>
      <div
        className={styles.countryTrigger}
        role="button"
        tabIndex={0}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Jurisdiction: ${countryName(current, lang)}`}
        onClick={() => {
          setOpen((v) => !v);
          setQuery('');
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setOpen((v) => !v);
          }
        }}
      >
        <Flag code={current.code} size={28} />
        <span className={`${styles.countryChevron} ${open ? styles.countryChevronOpen : ''}`}>
          <Icon name="chevron" size={15} strokeWidth={2} />
        </span>
      </div>

      {open ? (
        <GlassCard className={styles.countryMenu}>
          <div className={styles.countrySearch}>
            <span className={styles.countrySearchIcon}>
              <Icon name="search" size={15} />
            </span>
            <input
              className={styles.countrySearchInput}
              placeholder={t('country.search')}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <div className={`${styles.countryList} scroll`} role="listbox">
            {results.length === 0 ? (
              <div className={styles.countryEmpty}>{t('country.empty')}</div>
            ) : (
              results.map((c) => {
                const active = c.code === country;
                return (
                  <div
                    key={c.code}
                    role="option"
                    aria-selected={active}
                    className={`${styles.countryItem} ${active ? styles.countryItemActive : ''}`}
                    onClick={() => pick(c.code)}
                  >
                    <Flag code={c.code} size={26} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className={styles.countryName}>{countryName(c, lang)}</div>
                      <div className={styles.countryLaw}>{c.law}</div>
                    </div>
                    {active ? <Icon name="check" size={15} color="var(--accent)" strokeWidth={2.4} /> : null}
                  </div>
                );
              })
            )}
          </div>
        </GlassCard>
      ) : null}
    </div>
  );
}
