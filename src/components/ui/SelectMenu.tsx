import { useState } from 'react';
import { Icon } from '@/components/icons/Icon';
import { useDismissable } from '@/hooks/useAsync';
import styles from './ui.module.css';

export interface SelectMenuOption {
  value: string;
  label: string;
}

interface SelectMenuProps {
  value: string;
  options: SelectMenuOption[];
  onChange: (value: string) => void;
  ariaLabel: string;
}

/** Styled dropdown filter — one look for every list filter in the app. */
export function SelectMenu({ value, options, onChange, ariaLabel }: SelectMenuProps) {
  const [open, setOpen] = useState(false);
  const ref = useDismissable<HTMLDivElement>(() => setOpen(false), open);

  const current = options.find((o) => o.value === value) ?? options[0];

  return (
    <div className={styles.selectMenu} ref={ref}>
      <button
        type="button"
        className={`${styles.selectMenuBtn} ${open ? styles.selectMenuBtnOpen : ''}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => setOpen((v) => !v)}
      >
        <span className={styles.selectMenuLabel}>{current?.label}</span>
        <span className={`${styles.selectMenuChevron} ${open ? styles.selectMenuChevronOpen : ''}`}>
          <Icon name="chevron" size={14} />
        </span>
      </button>

      {open ? (
        <div className={styles.selectMenuList} role="listbox">
          {options.map((o) => {
            const active = o.value === value;
            return (
              <button
                key={o.value}
                type="button"
                role="option"
                aria-selected={active}
                className={`${styles.selectMenuItem} ${active ? styles.selectMenuItemActive : ''}`}
                onClick={() => {
                  onChange(o.value);
                  setOpen(false);
                }}
              >
                <span className={styles.selectMenuItemLabel}>{o.label}</span>
                {active ? (
                  <span className={styles.selectMenuCheck}>
                    <Icon name="check" size={14} strokeWidth={2.4} />
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
