import { useId, useLayoutEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Link, useNavigate } from 'react-router-dom';
import { documentsApi, savedDocsApi } from '@/api';
import { Icon } from '@/components/icons/Icon';
import { FileCard } from '@/components/ux/FileCard';
import { useAsync } from '@/hooks/useAsync';
import { useI18n } from '@/i18n/I18nProvider';
import { useUxT } from '@/i18n/uxMessages';
import { localeFor, relativeTime } from '@/i18n/dates';
import { previewFromMarkdown, useDocPreviews } from '@/lib/docPreviews';
import { EASE } from '@/lib/motion';
import { useChatStore } from '@/store/useChatStore';
import type { DocPreview } from '@/types/domain';
import styles from './chat.module.css';

/** Три карточки в ряд, как «Recent artifacts» у Claude (ui-test 2026-11-15). */
const LIMIT = 3;

/** Высота блока при прошлом показе: на перезагрузке место под него сразу
 *  такое, каким он окажется, — поле ввода над ним не прыгает. */
const HEIGHT_KEY = 'lexai.recentFilesHeight.cards';
const DEFAULT_HEIGHT = 232;

function rememberedHeight(): number {
  try {
    const v = Number(localStorage.getItem(HEIGHT_KEY));
    return v > 0 && v < 800 ? v : DEFAULT_HEIGHT;
  } catch {
    return DEFAULT_HEIGHT;
  }
}

/** Свёрнут ли блок (как «Recent artifacts ⌄» у Claude) — помним в браузере. */
const COLLAPSED_KEY = 'lexai.recentFiles.collapsed';

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === '1';
  } catch {
    return false;
  }
}

function writeCollapsed(v: boolean): void {
  try {
    if (v) localStorage.setItem(COLLAPSED_KEY, '1');
    else localStorage.removeItem(COLLAPSED_KEY);
  } catch {
    /* хранилище недоступно — состояние живёт до перезагрузки */
  }
}

interface RecentItem {
  id: string;
  /** id договора — для превью с сервера; у сохранённого из чата нет. */
  docId?: string;
  name: string;
  /** Имя для типа файла (цвет и значок). */
  kindOf: string;
  at: string;
  /** Превью сохранённого из чата документа — из его же текста. */
  local?: DocPreview;
  open: () => void;
}

const stripExt = (name: string) => name.replace(/\.[a-z0-9]{1,5}$/i, '');

/**
 * «Недавние файлы» под полем ввода нового чата: последние договоры и
 * сохранённые из чата документы (Vault → Documents), вперемешку по времени —
 * карточками с началом текста, цвет фона по типу файла.
 */
export function RecentFiles({ delay = 0.34 }: { delay?: number }) {
  const { t, lang } = useI18n();
  const u = useUxT();
  const navigate = useNavigate();
  const adoptDraft = useChatStore((s) => s.adoptDraft);

  // Каждый источник сам по себе: сбой одного не прячет другой.
  const docs = useAsync((signal) => documentsApi.recent(LIMIT, signal).catch(() => []), []);
  const saved = useAsync((signal) => savedDocsApi.list(signal, LIMIT).catch(() => []), []);
  const ready = docs.data !== null && saved.data !== null;
  const sectionRef = useRef<HTMLElement>(null);
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const bodyId = useId();
  const toggle = () =>
    setCollapsed((v) => {
      writeCollapsed(!v);
      return !v;
    });

  const items: RecentItem[] = ready
    ? [
        ...(docs.data ?? []).map(
          (d): RecentItem => ({
            id: `d:${d.id}`,
            docId: d.id,
            name: d.name,
            kindOf: d.name,
            at: d.updatedAt,
            open: () => navigate(`/documents/${d.id}`),
          }),
        ),
        ...(saved.data ?? []).map(
          (s): RecentItem => ({
            id: `s:${s.id}`,
            name: s.title,
            kindOf: 'saved.docx',
            at: s.createdAt,
            local: previewFromMarkdown(s.content),
            open: () => {
              adoptDraft({ id: s.id, title: s.title, content: s.content });
              navigate('/workspace');
            },
          }),
        ),
      ]
        .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
        .slice(0, LIMIT)
    : [];

  const previews = useDocPreviews(items.filter((x) => x.docId).map((x) => ({ id: x.docId as string, updatedAt: x.at })));
  const dateFmt = new Intl.DateTimeFormat(localeFor(lang), { day: 'numeric', month: 'short', year: 'numeric' });

  useLayoutEffect(() => {
    const h = sectionRef.current?.offsetHeight;
    if (!ready || !h) return;
    try {
      localStorage.setItem(HEIGHT_KEY, String(h));
    } catch {
      /* хранилище недоступно — в следующий раз место по умолчанию */
    }
  }, [ready, items.length, collapsed]);

  // Пока грузится — пустое место той высоты, каким блок был в прошлый раз.
  if (!ready) return <div className={styles.recent} style={{ minHeight: rememberedHeight() }} aria-hidden="true" data-loading="true" />;

  return (
    <motion.section
      ref={sectionRef}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: EASE, delay }}
      className={styles.recent}
      aria-label={t('chat.recent.title')}
    >
      <div className={styles.recentHead}>
        <h2 className={styles.recentTitle}>
          <button type="button" className={styles.recentToggle} onClick={toggle} aria-expanded={!collapsed} aria-controls={bodyId}>
            {t('chat.recent.title')}
            <Icon name="chevron" size={14} className={collapsed ? styles.recentChevron : `${styles.recentChevron} ${styles.recentChevronOpen}`} />
          </button>
        </h2>
        {items.length ? (
          <Link to="/documents" className={styles.recentAll}>
            {u('rf.viewAll')}
          </Link>
        ) : null}
      </div>
      <AnimatePresence initial={false}>
        {collapsed ? null : (
          <motion.div
            key="body"
            id={bodyId}
            className={styles.recentBody}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.26, ease: EASE }}
          >
            {items.length === 0 ? (
              <p className={styles.recentEmpty}>{t('chat.recent.empty')}</p>
            ) : (
              <ul className={styles.recentCards}>
                {items.map((it) => (
                  <li key={it.id}>
                    <FileCard
                      variant="compact"
                      kindOf={it.kindOf}
                      title={it.name}
                      paperTitle={stripExt(it.name)}
                      paperMeta={dateFmt.format(new Date(it.at))}
                      preview={it.local ?? previews.get(it.docId as string)}
                      sub={relativeTime(it.at, lang, t('chat.recent.justNow'))}
                      onOpen={it.open}
                    />
                  </li>
                ))}
              </ul>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.section>
  );
}
