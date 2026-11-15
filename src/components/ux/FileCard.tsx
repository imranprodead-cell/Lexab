import type { ReactNode } from 'react';
import { FileIcon } from '@/components/chat/FileIcon';
import { fileKind } from '@/lib/fileKind';
import type { DocPreview } from '@/types/domain';
import styles from './fileCard.module.css';

/*
 * Карточка файла по образцу галереи Claude (ui-test 2026-11-15): цветной фон
 * по типу файла (Word — синий, PDF — красный, Excel — зелёный, PowerPoint —
 * оранжевый, текст — графит), на нём «лист» с началом документа, под ним —
 * название и время. Вся карточка — одна кнопка «открыть» (растянутая
 * невидимая кнопка), действия — отдельные кнопки поверх фона.
 */

/** Условные строки, когда текста нет: ширины фиксированы, чтобы не прыгали. */
const GHOST = [96, 88, 92, 70, 94, 84, 60];

interface FileCardProps {
  /** Имя для типа (цвет фона и значок): «договор.pdf», «saved.docx». */
  kindOf: string;
  /** Название под фоном. */
  title: string;
  /** Заголовок на листе (если в тексте документа заголовка нет). */
  paperTitle: string;
  /** Мелкая строка на листе под заголовком (контрагент или дата). */
  paperMeta?: string;
  /** undefined — грузится, null — текста нет. */
  preview: DocPreview | null | undefined;
  sub?: ReactNode;
  /** Справа в подписи (плашка риска). */
  aside?: ReactNode;
  /** Кнопки поверх фона справа сверху (видны при наведении). */
  actions?: ReactNode;
  variant: 'compact' | 'gallery';
  onOpen: () => void;
}

export function FileCard({ kindOf, title, paperTitle, paperMeta, preview, sub, aside, actions, variant, onOpen }: FileCardProps) {
  const kind = fileKind(kindOf);
  const head = preview?.title || paperTitle;
  const paragraphs = preview?.text ? preview.text.split('\n').filter(Boolean) : [];
  return (
    <article className={styles.card} data-kind={kind} data-variant={variant}>
      <div className={styles.stage} aria-hidden="true">
        <div className={styles.sheetBack} />
        <div className={styles.paper}>
          <div className={styles.paperTitle} dir="auto">
            {head}
          </div>
          {paperMeta ? (
            <div className={styles.paperMeta} dir="auto">
              {paperMeta}
            </div>
          ) : null}
          {paragraphs.length ? (
            <div className={styles.paperText} dir="auto">
              {paragraphs.map((p, i) => (
                <p key={i}>{p}</p>
              ))}
            </div>
          ) : (
            <div className={styles.ghost} data-loading={preview === undefined ? 'true' : undefined}>
              {GHOST.map((w, i) => (
                <span key={i} style={{ width: `${w}%` }} />
              ))}
            </div>
          )}
        </div>
      </div>
      <div className={styles.foot}>
        {variant === 'gallery' ? (
          <span className={styles.tile} aria-hidden="true">
            <FileIcon name={kindOf} size={22} />
          </span>
        ) : null}
        <div className={styles.footText}>
          <div className={styles.name} dir="auto">
            {title}
          </div>
          {sub || aside ? (
            // Плашка риска — во второй строке: название остаётся во всю ширину.
            <div className={styles.subRow}>
              {aside ? <span className={styles.aside}>{aside}</span> : null}
              {sub ? <span className={styles.sub}>{sub}</span> : null}
            </div>
          ) : null}
        </div>
      </div>
      <button type="button" className={styles.cover} onClick={onOpen} aria-label={title} title={title} />
      {actions ? <div className={styles.actions}>{actions}</div> : null}
    </article>
  );
}

/** Заглушка карточки на время загрузки списка. */
export function FileCardSkeleton({ variant }: { variant: 'compact' | 'gallery' }) {
  return (
    <div className={`${styles.card} ${styles.skeleton}`} data-variant={variant} aria-hidden="true">
      <div className={styles.stage} />
      <div className={styles.foot}>
        <div className={styles.footText}>
          <span className={styles.skelLine} style={{ width: '70%' }} />
          <span className={styles.skelLine} style={{ width: '40%' }} />
        </div>
      </div>
    </div>
  );
}
