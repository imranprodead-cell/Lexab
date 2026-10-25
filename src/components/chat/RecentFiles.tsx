import { useLayoutEffect, useRef } from 'react';
import { motion } from 'motion/react';
import { useNavigate } from 'react-router-dom';
import { documentsApi, savedDocsApi } from '@/api';
import { useAsync } from '@/hooks/useAsync';
import { useI18n } from '@/i18n/I18nProvider';
import { relativeTime } from '@/i18n/dates';
import { EASE } from '@/lib/motion';
import { useChatStore } from '@/store/useChatStore';
import { FileIcon } from './FileIcon';
import styles from './chat.module.css';

const LIMIT = 5;

/** Высота списка при прошлом показе: на перезагрузке место под список сразу
 *  такое, каким он окажется, — поле ввода над ним не прыгает (раньше держали
 *  место под 5 строк, и у кого файлов меньше, поле съезжало вниз). */
const HEIGHT_KEY = 'lexai.recentFilesHeight';
const DEFAULT_HEIGHT = 262;

function rememberedHeight(): number {
  try {
    const v = Number(localStorage.getItem(HEIGHT_KEY));
    return v > 0 && v < 800 ? v : DEFAULT_HEIGHT;
  } catch {
    return DEFAULT_HEIGHT;
  }
}

interface RecentItem {
  id: string;
  name: string;
  at: string;
  open: () => void;
}

/**
 * «Недавние файлы» под полем ввода нового чата: последние договоры и
 * сохранённые из чата документы (Vault → Documents), вперемешку по времени.
 */
export function RecentFiles({ delay = 0.34 }: { delay?: number }) {
  const { t, lang } = useI18n();
  const navigate = useNavigate();
  const adoptDraft = useChatStore((s) => s.adoptDraft);

  // Каждый источник сам по себе: сбой одного не прячет другой.
  const docs = useAsync((signal) => documentsApi.recent(LIMIT, signal).catch(() => []), []);
  const saved = useAsync((signal) => savedDocsApi.list(signal, LIMIT).catch(() => []), []);
  const ready = docs.data !== null && saved.data !== null;
  const sectionRef = useRef<HTMLElement>(null);

  const items: RecentItem[] = ready
    ? [
        ...(docs.data ?? []).map((d) => ({
          id: `d:${d.id}`,
          name: d.name,
          at: d.updatedAt,
          open: () => navigate(`/documents/${d.id}`),
        })),
        ...(saved.data ?? []).map((s) => ({
          id: `s:${s.id}`,
          name: s.title,
          at: s.createdAt,
          open: () => {
            adoptDraft({ id: s.id, title: s.title, content: s.content });
            navigate('/workspace');
          },
        })),
      ]
        .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
        .slice(0, LIMIT)
    : [];

  useLayoutEffect(() => {
    const h = sectionRef.current?.offsetHeight;
    if (!ready || !h) return;
    try {
      localStorage.setItem(HEIGHT_KEY, String(h));
    } catch {
      /* хранилище недоступно — в следующий раз место по умолчанию */
    }
  }, [ready, items.length]);

  // Пока грузится — пустое место той высоты, каким список был в прошлый раз.
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
      <h2 className={styles.recentTitle}>{t('chat.recent.title')}</h2>
      {items.length === 0 ? (
        <p className={styles.recentEmpty}>{t('chat.recent.empty')}</p>
      ) : (
        <ul className={styles.recentList}>
          {items.map((it) => (
            <li key={it.id}>
              <button type="button" className={styles.recentRow} onClick={it.open} title={it.name}>
                <FileIcon name={it.name} size={20} />
                <span className={styles.recentName} dir="auto">
                  {it.name}
                </span>
                <span className={styles.recentTime}>{relativeTime(it.at, lang, t('chat.recent.justNow'))}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </motion.section>
  );
}
