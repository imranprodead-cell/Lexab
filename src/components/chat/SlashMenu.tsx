import { Icon, type IconName } from '@/components/icons/Icon';
import { useI18n } from '@/i18n/I18nProvider';
import type { Command } from '@/types/domain';
import styles from './chat.module.css';

interface SlashMenuProps {
  commands: Command[];
  activeIndex: number;
  onHover: (index: number) => void;
  onPick: (command: Command) => void;
}

/** Autocomplete menu for slash commands, shown above the composer. */
export function SlashMenu({ commands, activeIndex, onHover, onPick }: SlashMenuProps) {
  const { t } = useI18n();
  if (commands.length === 0) return null;

  return (
    <div className={styles.slashMenu}>
      {commands.map((c, i) => {
        const active = i === activeIndex;
        const name = c.cmd.slice(1);
        return (
          <div
            key={c.cmd}
            className={`${styles.slashItem} ${active ? styles.slashItemActive : ''}`}
            onMouseEnter={() => onHover(i)}
            onMouseDown={(e) => {
              // onMouseDown so the textarea doesn't blur before we handle it.
              e.preventDefault();
              onPick(c);
            }}
          >
            {/* Цвет плитки задаётся по имени команды (см. .slashIcon[data-tone]). */}
            <div className={styles.slashIcon} data-tone={name}>
              <Icon name={c.icon as IconName} size={15} strokeWidth={1.8} />
            </div>
            <div className={styles.slashText}>
              <span className={styles.slashCmd}>{c.cmd}</span>
              <span className={styles.slashDesc}>{t(`cmd.${name}`)}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
