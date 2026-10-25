import { Icon } from '@/components/icons/Icon';
import { Spinner } from '@/components/ui/Spinner';
import { useI18n } from '@/i18n/I18nProvider';
import { fileTypeLabel } from '@/lib/fileKind';
import { FileIcon } from './FileIcon';
import styles from './chat.module.css';

/** Файл, прикреплённый к полю ввода: грузится сразу, уходит с вопросом. */
export interface ComposerAttachment {
  key: string;
  name: string;
  size: string;
  status: 'uploading' | 'ready' | 'error';
  /** id загрузки на сервере — появляется, когда файл загрузился. */
  uploadId?: string;
}

/**
 * Карточка файла: значок Microsoft по типу, имя, «Word (.docx) · 48 KB». В поле ввода — с
 * крестиком «убрать», в сообщении — без него.
 */
export function AttachmentChip({
  name,
  size,
  status = 'ready',
  onRemove,
}: {
  name: string;
  size: string;
  status?: ComposerAttachment['status'];
  onRemove?: () => void;
}) {
  const { t } = useI18n();
  const sub =
    status === 'uploading'
      ? t('chat.attach.uploading')
      : status === 'error'
        ? t('chat.attach.failed')
        : [fileTypeLabel(name), size].filter(Boolean).join(' · ');
  return (
    <div className={styles.attChip} data-status={status} title={name}>
      <span className={styles.attIcon}>{status === 'uploading' ? <Spinner size={18} /> : <FileIcon name={name} size={28} />}</span>
      <span className={styles.attText}>
        <span className={styles.attName} dir="auto">
          {name}
        </span>
        <span className={styles.attSub}>{sub}</span>
      </span>
      {onRemove ? (
        <button type="button" className={styles.attRemove} aria-label={t('chat.attach.remove', { name })} title={t('chat.attach.remove', { name })} onClick={onRemove}>
          <Icon name="x" size={12} strokeWidth={2.2} />
        </button>
      ) : null}
    </div>
  );
}

/** Файлы над пузырём вопроса в ленте чата. */
export function MessageFiles({ files }: { files: { name: string; size: string }[] }) {
  return (
    <div className={styles.msgFiles}>
      {files.map((f, i) => (
        <AttachmentChip key={`${f.name}-${i}`} name={f.name} size={f.size} />
      ))}
    </div>
  );
}
