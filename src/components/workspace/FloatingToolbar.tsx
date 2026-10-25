import { useLayoutEffect, useRef, useState } from 'react';
import { Icon, type IconName } from '@/components/icons/Icon';
import { Badge } from '@/components/ui/Badge';
import { GlassCard } from '@/components/ui/GlassCard';
import { useI18n } from '@/i18n/I18nProvider';
import styles from './workspace.module.css';

interface FloatingToolbarProps {
  /** Team viewer: hide editing controls, keep downloads/history. */
  readOnly?: boolean;
  pendingCount: number;
  onAcceptAll: () => void;
  onDownload: (mode: 'tracked' | 'clean') => void;
  onReport: () => void;
  onSendForSignature: () => void;
  onVersionHistory: () => void;
  /** Публичная ссылка на отчёт для контрагента (скрыто у read-only зрителей). */
  onShare?: () => void;
}

/** Помещается ли кнопка в одну строку «значок + подпись»: ширина значка,
 *  отступа и подписи против места внутри кнопки. Подпись из нескольких слов
 *  сама переносится и всегда влезает; не влезает только слово длиннее
 *  места (как «Поделиться» в узкой колонке) — тогда сумма больше. */
function fitsInRow(b: HTMLElement): boolean {
  const cs = getComputedStyle(b);
  const room = b.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  let used = 0;
  let parts = 0;
  for (const node of Array.from(b.childNodes)) {
    let w = 0;
    if (node.nodeType === Node.TEXT_NODE) {
      const range = document.createRange();
      range.selectNodeContents(node);
      w = range.getBoundingClientRect().width;
    } else if (node instanceof Element) {
      w = node.getBoundingClientRect().width;
    }
    if (w > 0) {
      used += w;
      parts += 1;
    }
  }
  used += Math.max(0, parts - 1) * (parseFloat(cs.columnGap) || 0);
  return used <= room + 0.5; // полпикселя — на округление
}

/** Persistent action bar floating over the document viewer. */
export function FloatingToolbar({
  readOnly = false,
  pendingCount,
  onAcceptAll,
  onDownload,
  onReport,
  onSendForSignature,
  onVersionHistory,
  onShare,
}: FloatingToolbarProps) {
  const { t, lang } = useI18n();
  const [menuOpen, setMenuOpen] = useState(false);
  const action = (icon: IconName, label: string, onClick: () => void) => (
    <button className={styles.toolbarBtn} onClick={onClick}>
      <Icon name={icon} size={16} strokeWidth={1.9} />
      {label}
    </button>
  );

  // Все кнопки одного размера: панель — сетка из равных колонок. Слева —
  // «Принять все» (тоже равная колонка) или пометка «Только просмотр»,
  // затем разделитель (по ширине содержимого).
  const showAccept = pendingCount > 0 && !readOnly;
  const actions = 3 + (!readOnly && onShare ? 1 : 0) + (!readOnly ? 1 : 0); // скачать, отчёт, история + поделиться + подпись
  const eq = 'minmax(0, 1fr)';
  const lead = showAccept ? `${eq} auto ` : readOnly ? 'auto auto ' : '';
  const columns = `${lead}repeat(${actions}, ${eq})`;

  // Колонки узкие (6 кнопок в узком окне) и длинное слово вроде «Поделиться»
  // не влезает рядом со значком — у всех кнопок значок встаёт над подписью.
  // Проверка — в обычном виде и до отрисовки, поэтому без мигания.
  const barRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const bar = barRef.current;
    if (!bar) return;
    const check = () => {
      bar.removeAttribute('data-compact');
      const tight = [...bar.querySelectorAll<HTMLElement>(`.${styles.toolbarInner} .${styles.toolbarBtn}`)].some((b) => !fitsInRow(b));
      if (tight) bar.setAttribute('data-compact', '');
    };
    check();
    const ro = new ResizeObserver(check);
    ro.observe(bar);
    return () => ro.disconnect();
  }, [columns, lang]); // язык меняет длину подписей

  return (
    <div className={styles.toolbar} ref={barRef}>
      <GlassCard className={styles.toolbarInner} style={{ gridTemplateColumns: columns }}>
        {showAccept ? (
          <button
            className={styles.toolbarBtn}
            onClick={onAcceptAll}
            style={{
              color: 'var(--on-accent)',
              background: 'var(--accent)',
              borderColor: 'transparent',
              fontWeight: 600,
            }}
          >
            <Icon name="check" size={16} color="var(--on-accent)" strokeWidth={1.9} />
            {t('ws.acceptAll', { n: pendingCount })}
          </button>
        ) : readOnly ? (
          <Badge color="Low">{t('ws.readOnlyBadge')}</Badge>
        ) : null}
        {/* Пометку «Проверено» владелец убрал (2026-10-25): разделитель нужен,
            только когда слева есть «Принять все» или «Только просмотр». */}
        {showAccept || readOnly ? <span className={styles.toolbarDivider} /> : null}
        {/* Download menu: tracked changes (default) vs clean final. */}
        <div className={styles.toolbarMenuWrap}>
          <button className={styles.toolbarBtn} onClick={() => setMenuOpen((v) => !v)} aria-haspopup="menu" aria-expanded={menuOpen}>
            <Icon name="download" size={16} strokeWidth={1.9} />
            {t('ws.download')}
          </button>
          {menuOpen ? (
            <>
              <button className={styles.menuBackdrop} aria-hidden onClick={() => setMenuOpen(false)} tabIndex={-1} />
              <div className={styles.toolbarMenu} role="menu">
                <button
                  className={styles.toolbarMenuItem}
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false);
                    onDownload('tracked');
                  }}
                >
                  <span className={styles.toolbarMenuTitle}>{t('ws.downloadTracked')}</span>
                  <span className={styles.toolbarMenuSub}>{t('ws.downloadTrackedHint')}</span>
                </button>
                <button
                  className={styles.toolbarMenuItem}
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false);
                    onDownload('clean');
                  }}
                >
                  <span className={styles.toolbarMenuTitle}>{t('ws.downloadClean')}</span>
                  <span className={styles.toolbarMenuSub}>{t('ws.downloadCleanHint')}</span>
                </button>
              </div>
            </>
          ) : null}
        </div>
        {action('docs', t('ws.report'), onReport)}
        {!readOnly && onShare ? action('share', t('ws.share'), onShare) : null}
        {!readOnly ? action('esign', t('ws.sendSign'), onSendForSignature) : null}
        {action('history', t('ws.versionsTitle'), onVersionHistory)}
      </GlassCard>
    </div>
  );
}
