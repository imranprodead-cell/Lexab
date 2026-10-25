import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '@/components/icons/Icon';
import { GlassCard } from '@/components/ui/GlassCard';
import { useDismissable } from '@/hooks/useAsync';
import { COUNTRIES, countryName } from '@/data/countries';
import { useUIStore } from '@/store/useUIStore';
import { useI18n } from '@/i18n/I18nProvider';
import { Flag } from './Flag';
import styles from './layout.module.css';

/** Отступ меню от края окна и от кнопки. */
const EDGE = 16;
const GAP = 6;
/** Вниз открываем, если под кнопкой помещаются поиск и хотя бы ~4 страны;
 *  не хватает места на весь список — он прокручивается внутри меню. */
const MIN_BELOW = 240;

interface Placement {
  down: boolean;
  /** Предел высоты списка стран, когда снизу места меньше, чем на всё меню. */
  listMax: number | null;
}

interface CountrySelectorProps {
  /** «composer» — нижний ряд поля ввода чата: флаг + название страны,
   *  меню открывается только по клику (наведение при движении мыши вдоль
   *  кнопок открывало бы его случайно) — вниз, под кнопку, если там хватает
   *  места (поле ввода посреди приветствия), иначе вверх (поле прижато к низу
   *  переписки). Логика выбора та же.
   *  «field» — поле формы (Batch review): рамка как у остальных полей, внутри
   *  круглый флаг и страна, меню — то же, что в чате. */
  variant?: 'topbar' | 'composer' | 'field';
  /** Своя страна вместо общей (поле формы): выбор не меняет страну чата и
   *  не показывает уведомление — только отдаёт код наверх. */
  value?: string;
  onChange?: (code: string) => void;
  disabled?: boolean;
  /** Подпись для экранного диктора (поле формы — по названию поля). */
  ariaLabel?: string;
  /** Строка «Все юрисдикции» первой в списке (плейбук без страны): значок
   *  глобуса вместо флага. value — какое значение ей соответствует. */
  allOption?: { value: string; label: string };
}

/** Searchable jurisdiction picker shown in the top bar. Opens on hover.
 *  The chosen country becomes the default law context for AI analyses & chat. */
export function CountrySelector({ variant = 'topbar', value, onChange, disabled = false, ariaLabel, allOption }: CountrySelectorProps) {
  const inComposer = variant === 'composer';
  const isField = variant === 'field';
  // В поле ввода и в форме меню открывается только кликом и само решает,
  // вниз или вверх; в шапке — наведением и всегда вниз.
  const clickOnly = variant !== 'topbar';
  const controlled = onChange !== undefined;
  const { t, lang } = useI18n();
  const country = useUIStore((s) => s.country);
  const setCountry = useUIStore((s) => s.setCountry);
  const pushToast = useUIStore((s) => s.pushToast);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const ref = useDismissable<HTMLDivElement>(() => setOpen(false), open);
  // Поле формы показывает меню в слое поверх страницы (портал): иначе окно
  // плейбука обрезало бы его по своему краю. Слой — рамка ровно поверх поля,
  // поэтому меню встаёт под ним (или над ним) теми же правилами, что в чате.
  const layerRef = useRef<HTMLDivElement>(null);
  const [anchor, setAnchor] = useState<DOMRect | null>(null);

  // Куда открыть меню поля ввода: вниз, под кнопку, когда там есть место
  // (поле посреди приветствия), иначе вверх (поле у нижнего края переписки).
  // Решается в момент открытия и не прыгает, пока человек печатает в поиске.
  const [place, setPlace] = useState<Placement>({ down: false, listMax: null });
  // Высота меню целиком и его шапки (поиск + «Юрисдикция»); до первого
  // замера — прикидка, после — настоящие числа.
  const sizes = useRef({ menu: 380, head: 86 });
  const placement = (): Placement => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return { down: false, listMax: null };
    const below = window.innerHeight - r.bottom - GAP - EDGE;
    if (below >= sizes.current.menu) return { down: true, listMax: null };
    if (below >= MIN_BELOW) return { down: true, listMax: Math.floor(below - sizes.current.head) };
    return { down: false, listMax: null };
  };
  useLayoutEffect(() => {
    if (!open || !clickOnly) return;
    const host = isField ? layerRef.current : ref.current;
    const menu = host?.querySelector<HTMLElement>(`.${styles.countryMenu}`);
    const list = menu?.querySelector<HTMLElement>(`.${styles.countryList}`);
    if (!menu || !list) return;
    // Сверяем прикидку с настоящими размерами до отрисовки — без мигания.
    const head = menu.offsetHeight - list.offsetHeight;
    sizes.current = { head, menu: head + Math.min(list.scrollHeight, listCap) };
    const next = placement();
    if (next.down !== place.down || next.listMax !== place.listMax) setPlace(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Слой поля формы стоит на месте поля: прокрутка страницы или окна
  // плейбука и смена размера окна закрывают меню (как у календаря).
  useEffect(() => {
    if (!open || !isField) return;
    const onWindow = (e?: Event) => {
      if (e && layerRef.current?.contains(e.target as Node)) return; // прокрутка списка стран
      setOpen(false);
    };
    window.addEventListener('resize', onWindow);
    window.addEventListener('scroll', onWindow, true);
    return () => {
      window.removeEventListener('resize', onWindow);
      window.removeEventListener('scroll', onWindow, true);
    };
  }, [open, isField]);

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

  const selected = controlled ? value : country;
  const current = COUNTRIES.find((c) => c.code === selected) ?? COUNTRIES[1];
  const allPicked = Boolean(allOption) && selected === allOption?.value;
  // Со строкой «Все юрисдикции» в списке 8 строк — даём место всем без прокрутки.
  const listCap = allOption ? 340 : 300;
  const allShown = Boolean(allOption) && (!query.trim() || allOption!.label.toLowerCase().includes(query.trim().toLowerCase()));
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
    if (controlled) {
      onChange(code);
      setOpen(false);
      setQuery('');
      return;
    }
    const changed = code !== country;
    setCountry(code);
    setOpen(false);
    setQuery('');
    if (changed) {
      const picked = COUNTRIES.find((c) => c.code === code);
      if (picked) pushToast(t('country.aiNote', { law: picked.law }), 'success');
    }
  };

  const toggle = () => {
    if (disabled) return;
    if (!open && clickOnly) setPlace(placement());
    if (!open && isField) setAnchor(ref.current?.getBoundingClientRect() ?? null);
    setOpen((v) => !v);
    setQuery('');
  };

  const menu = (
    <GlassCard
      style={isField ? { pointerEvents: 'auto' } : undefined}
      className={`${styles.countryMenu} ${clickOnly ? (place.down ? styles.countryMenuDown : styles.countryMenuUp) : ''}`}
    >
      {/* Как на эталоне: строка поиска без рамки, под ней тонкая линия;
          страны — одной строкой «флаг · название», выбранная — галочкой. */}
      <div className={styles.countrySearch}>
        <Icon name="search" size={16} />
        <input
          className={styles.countrySearchInput}
          placeholder={t('country.search')}
          value={query}
          // Открыли кликом в поле ввода — сразу печатать. В шапке меню
          // открывается наведением: фокус там не крадём. На телефоне
          // клавиатура сама не выскакивает.
          autoFocus={clickOnly && typeof window !== 'undefined' && window.matchMedia?.('(pointer: fine)').matches}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && results.length) {
              e.preventDefault();
              pick(results[0].code);
            }
          }}
          aria-label={t('country.search')}
        />
      </div>
      <div className={styles.countrySection}>{t('country.section')}</div>
      <div
        className={`${styles.countryList} scroll`}
        role="listbox"
        style={clickOnly && place.down && place.listMax ? { maxHeight: place.listMax } : allOption ? { maxHeight: listCap } : undefined}
      >
        {allOption && allShown ? (
          <div role="option" aria-selected={allPicked} className={styles.countryItem} onClick={() => pick(allOption.value)}>
            <span className={styles.countryGlobe} aria-hidden="true">
              <Icon name="globe" size={13} />
            </span>
            <span className={styles.countryName}>{allOption.label}</span>
            {allPicked ? (
              <span className={styles.countryCheck}>
                <Icon name="check" size={16} strokeWidth={2.2} />
              </span>
            ) : null}
          </div>
        ) : null}
        {results.length === 0 && !(allOption && allShown) ? (
          <div className={styles.countryEmpty}>{t('country.empty')}</div>
        ) : (
          results.map((c) => {
            const active = !allPicked && c.code === selected;
            return (
              <div key={c.code} role="option" aria-selected={active} className={styles.countryItem} onClick={() => pick(c.code)}>
                <Flag code={c.code} size={20} />
                <span className={styles.countryName}>{countryName(c, lang)}</span>
                {active ? (
                  <span className={styles.countryCheck}>
                    <Icon name="check" size={16} strokeWidth={2.2} />
                  </span>
                ) : null}
              </div>
            );
          })
        )}
      </div>
    </GlassCard>
  );

  return (
    <div
      className={isField ? `${styles.country} ${styles.countryFieldWrap}` : styles.country}
      ref={ref}
      onMouseEnter={clickOnly ? undefined : hoverOpen}
      onMouseLeave={clickOnly ? undefined : hoverClose}
    >
      {isField ? (
        <button
          type="button"
          className={styles.countryTriggerField}
          disabled={disabled}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-label={`${ariaLabel ?? t('batch.jurisdiction')}: ${allPicked ? allOption!.label : countryName(current, lang)}`}
          onClick={toggle}
        >
          {allPicked ? (
            <span className={styles.countryGlobe} aria-hidden="true">
              <Icon name="globe" size={13} />
            </span>
          ) : (
            <Flag code={current.code} size={20} />
          )}
          <span className={styles.countryFieldName}>{allPicked ? allOption!.label : countryName(current, lang)}</span>
          <span className={styles.countryFieldChevron}>
            <Icon name="chevron" size={14} />
          </span>
        </button>
      ) : (
        <div
          className={inComposer ? styles.countryTriggerComposer : styles.countryTrigger}
          role="button"
          tabIndex={0}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-label={t('country.selectorAria', {
            name: countryName(current, lang),
          })}
          onClick={toggle}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              toggle();
            }
          }}
        >
          {inComposer ? (
            <>
              <Flag code={current.code} size={18} />
              <span className={styles.countryComposerName}>{countryName(current, lang)}</span>
            </>
          ) : (
            <>
              <Flag code={current.code} size={28} />
              <span className={`${styles.countryChevron} ${open ? styles.countryChevronOpen : ''}`}>
                <Icon name="chevron" size={15} strokeWidth={2} />
              </span>
            </>
          )}
        </div>
      )}

      {open
        ? isField
          ? anchor
            ? createPortal(
                <div
                  ref={layerRef}
                  className={styles.country}
                  data-popover-layer
                  style={{
                    position: 'fixed',
                    top: anchor.top,
                    left: anchor.left,
                    width: anchor.width,
                    height: anchor.height,
                    zIndex: 450,
                    pointerEvents: 'none',
                  }}
                  onKeyDown={(e) => {
                    // Esc закрывает только меню, а не окно плейбука под ним.
                    if (e.key === 'Escape') {
                      e.stopPropagation();
                      setOpen(false);
                    }
                  }}
                >
                  {menu}
                </div>,
                document.body,
              )
            : null
          : menu
        : null}
    </div>
  );
}
