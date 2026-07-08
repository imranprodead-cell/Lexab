import { Icon, type IconName } from '@/components/icons/Icon';
import { GlassCard } from '@/components/ui/GlassCard';
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
    <GlassCard className={styles.slashMenu}>
      <div className={styles.slashLabel}>{t('cmd.section')}</div>
      {commands.map((c, i) => {
        const active = i === activeIndex;
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
            <div className={styles.slashIcon}>
              <Icon name={c.icon as IconName} size={17} />
            </div>
            <div style={{ flex: 1 }}>
              <span className={styles.slashCmd}>{c.cmd}</span>
              <span className={styles.slashDesc}>{t(`cmd.${c.cmd.slice(1)}`)}</span>
            </div>
            {active ? <span className={styles.slashHint}>↵</span> : null}
          </div>
        );
      })}
    </GlassCard>
  );
}
