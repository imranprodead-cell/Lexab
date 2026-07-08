import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { Icon, type IconName } from '@/components/icons/Icon';
import { GlassCard } from '@/components/ui/GlassCard';
import { useChatStore } from '@/store/useChatStore';
import { useUIStore } from '@/store/useUIStore';
import { useI18n } from '@/i18n/I18nProvider';
import styles from './layout.module.css';

interface PaletteItem {
  id: string;
  label: string;
  icon: IconName;
  group: string;
  run: () => void;
}

/** Cmd/Ctrl+K command palette: search + navigate + quick actions. */
export function CommandPalette() {
  const navigate = useNavigate();
  const { t } = useI18n();
  const resetChat = useChatStore((s) => s.reset);
  const toggleTheme = useUIStore((s) => s.toggleTheme);

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // A window listener receives the DOM event, not React's synthetic one.
    const onKey = (e: globalThis.KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((v) => !v);
      } else if (e.key === 'Escape') {
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (open) {
      setQuery('');
      setIndex(0);
      setTimeout(() => inputRef.current?.focus(), 20);
    }
  }, [open]);

  const items = useMemo<PaletteItem[]>(() => {
    const go = (path: string) => () => {
      navigate(path);
      setOpen(false);
    };
    return [
      { id: 'chat', label: t('nav.chat'), icon: 'chat', group: t('palette.nav'), run: go('/chat') },
      { id: 'documents', label: t('nav.documents'), icon: 'docs', group: t('palette.nav'), run: go('/documents') },
      { id: 'templates', label: t('nav.templates'), icon: 'layout', group: t('palette.nav'), run: go('/templates') },
      { id: 'signatures', label: t('nav.signatures'), icon: 'esign', group: t('palette.nav'), run: go('/signatures') },
      { id: 'analytics', label: t('nav.analytics'), icon: 'analytics', group: t('palette.nav'), run: go('/analytics') },
      { id: 'team', label: t('nav.team'), icon: 'users', group: t('palette.nav'), run: go('/team') },
      { id: 'settings', label: t('nav.settings'), icon: 'settings', group: t('palette.nav'), run: go('/settings') },
      {
        id: 'new',
        label: t('palette.action.newReview'),
        icon: 'plus',
        group: t('palette.actions'),
        run: () => {
          resetChat();
          navigate('/chat');
          setOpen(false);
        },
      },
      {
        id: 'theme',
        label: t('palette.action.toggleTheme'),
        icon: 'sun',
        group: t('palette.actions'),
        run: () => {
          toggleTheme();
          setOpen(false);
        },
      },
      { id: 'plans', label: t('palette.action.upgrade'), icon: 'diamond', group: t('palette.actions'), run: go('/plans') },
    ];
  }, [navigate, resetChat, toggleTheme, t]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? items.filter((i) => i.label.toLowerCase().includes(q)) : items;
  }, [items, query]);

  const groups = useMemo(() => {
    const map = new Map<string, PaletteItem[]>();
    filtered.forEach((i) => {
      const arr = map.get(i.group) ?? [];
      arr.push(i);
      map.set(i.group, arr);
    });
    return [...map.entries()];
  }, [filtered]);

  if (!open) return null;

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setIndex((i) => Math.min(filtered.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setIndex((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      filtered[index]?.run();
    }
  };

  let running = -1;

  return createPortal(
    <div className={styles.paletteOverlay} onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}>
      <GlassCard className={styles.palette}>
        <div className={styles.paletteSearch}>
          <Icon name="search" size={18} color="var(--mut)" />
          <input
            ref={inputRef}
            className={styles.paletteInput}
            placeholder={t('palette.placeholder')}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setIndex(0);
            }}
            onKeyDown={onKeyDown}
          />
          <span className={styles.paletteHint}>ESC</span>
        </div>
        <div className={styles.paletteList}>
          {filtered.length === 0 ? (
            <div className={styles.paletteEmpty}>{t('top.notFound')}</div>
          ) : (
            groups.map(([group, groupItems]) => (
              <div key={group}>
                <div className={styles.paletteGroup}>{group}</div>
                {groupItems.map((item) => {
                  running += 1;
                  const active = running === index;
                  return (
                    <div
                      key={item.id}
                      className={`${styles.paletteItem} ${active ? styles.paletteItemActive : ''}`}
                      onMouseEnter={() => setIndex(filtered.indexOf(item))}
                      onClick={item.run}
                    >
                      <span className={styles.paletteItemIcon}>
                        <Icon name={item.icon} size={18} />
                      </span>
                      {item.label}
                    </div>
                  );
                })}
              </div>
            ))
          )}
        </div>
      </GlassCard>
    </div>,
    document.body,
  );
}
