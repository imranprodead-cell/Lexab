import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '@/components/icons/Icon';
import { useI18n } from '@/i18n/I18nProvider';
import styles from './ui.module.css';

interface DatePickerProps {
  /** Selected day as 'YYYY-MM-DD' (local), or null for empty. */
  value: string | null;
  onChange: (iso: string | null) => void;
  placeholder: string;
  ariaLabel?: string;
  /** Days before today can't be picked (deadlines live in the future). */
  minToday?: boolean;
}

const toKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Monday-first day-of-week index (RU habit; fine for EN too). */
const mondayIndex = (d: Date) => (d.getDay() + 6) % 7;

/**
 * Styled calendar dropdown matching the app design (used for approval
 * deadlines). Rendered in a portal with fixed positioning so it never gets
 * clipped by modal scroll areas.
 */
export function DatePicker({ value, onChange, placeholder, ariaLabel, minToday = true }: DatePickerProps) {
  const { lang } = useI18n();
  const locale = lang === 'ru' ? 'ru-RU' : 'en-GB';
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const selected = value ? new Date(`${value}T00:00:00`) : null;
  const [view, setView] = useState<Date>(selected ?? today);

  const openPopover = () => {
    const rect = btnRef.current?.getBoundingClientRect();
    if (!rect) return;
    const width = 268;
    const height = 320;
    const left = Math.min(Math.max(rect.left, 8), window.innerWidth - width - 8);
    const top = rect.bottom + height > window.innerHeight - 8 ? Math.max(rect.top - height - 6, 8) : rect.bottom + 6;
    setPos({ top, left });
    setView(selected ?? today);
    setOpen(true);
  };

  // Outside click / Escape / window scroll-resize close the popover.
  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!popRef.current?.contains(t) && !btnRef.current?.contains(t)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    const onWindow = (e?: Event) => {
      // Scrolling inside the calendar itself must not close it.
      if (e && popRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', onWindow);
    // Capture phase: modal bodies scroll their own divs, not the window.
    window.addEventListener('scroll', onWindow, true);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onWindow);
      window.removeEventListener('scroll', onWindow, true);
    };
  }, [open]);

  const monthLabel = view.toLocaleDateString(locale, { month: 'long', year: 'numeric' });
  const weekdays = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(2026, 5, 1 + i); // 2026-06-01 is a Monday
    return d.toLocaleDateString(locale, { weekday: 'short' }).replace('.', '').slice(0, 2);
  });

  const first = new Date(view.getFullYear(), view.getMonth(), 1);
  const daysInMonth = new Date(view.getFullYear(), view.getMonth() + 1, 0).getDate();
  const leading = mondayIndex(first);
  const cells: (Date | null)[] = [
    ...Array.from({ length: leading }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => new Date(view.getFullYear(), view.getMonth(), i + 1)),
  ];

  const label = selected
    ? selected.toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' })
    : placeholder;

  return (
    <>
      <button
        type="button"
        ref={btnRef}
        className={`${styles.dateField} ${selected ? '' : styles.dateFieldEmpty}`}
        aria-label={ariaLabel ?? placeholder}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => (open ? setOpen(false) : openPopover())}
      >
        <Icon name="calendar" size={15} />
        <span className={styles.dateFieldLabel}>{label}</span>
        {selected ? (
          <span
            role="button"
            aria-label="clear"
            className={styles.dateFieldClear}
            onClick={(e) => {
              e.stopPropagation();
              onChange(null);
              setOpen(false);
            }}
          >
            <Icon name="x" size={13} />
          </span>
        ) : (
          <span className={styles.dateFieldChevron}>
            <Icon name="chevron" size={13} />
          </span>
        )}
      </button>

      {open && pos
        ? createPortal(
            <div className={styles.calendar} style={{ top: pos.top, left: pos.left }} role="dialog" data-popover-layer ref={popRef}>
              <div className={styles.calHead}>
                <button
                  type="button"
                  className={styles.calNav}
                  aria-label="previous month"
                  onClick={() => setView(new Date(view.getFullYear(), view.getMonth() - 1, 1))}
                >
                  <Icon name="back" size={14} />
                </button>
                <span className={styles.calMonth}>{monthLabel[0].toUpperCase() + monthLabel.slice(1)}</span>
                <button
                  type="button"
                  className={styles.calNav}
                  aria-label="next month"
                  onClick={() => setView(new Date(view.getFullYear(), view.getMonth() + 1, 1))}
                >
                  <Icon name="chevron" size={14} />
                </button>
              </div>
              <div className={styles.calWeekdays}>
                {weekdays.map((w) => (
                  <span key={w}>{w}</span>
                ))}
              </div>
              <div className={styles.calGrid}>
                {cells.map((d, i) => {
                  if (!d) return <span key={`e${i}`} />;
                  const key = toKey(d);
                  const disabled = minToday && d < today;
                  const isToday = key === toKey(today);
                  const isSelected = selected !== null && key === toKey(selected);
                  return (
                    <button
                      key={key}
                      type="button"
                      disabled={disabled}
                      className={`${styles.calDay} ${isSelected ? styles.calDaySelected : ''} ${isToday && !isSelected ? styles.calDayToday : ''}`}
                      onClick={() => {
                        onChange(key);
                        setOpen(false);
                      }}
                    >
                      {d.getDate()}
                    </button>
                  );
                })}
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
