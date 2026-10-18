import { Icon } from '@/components/icons/Icon';
import { fileKind } from '@/lib/format';
import styles from './chat.module.css';

interface FileBubbleProps {
  name: string;
  size: string;
}

/** Right-aligned user message showing an uploaded contract file. Формат — по
 *  имени файла: раньше на любом файле (PDF, фото, TXT) стояло «DOCX». */
export function UserFileBubble({ name, size }: FileBubbleProps) {
  const kind = fileKind(name);
  return (
    <div className={styles.userRow}>
      <div className={styles.fileBubble}>
        <div className={styles.fileIcon}>
          <Icon name="docs" size={20} />
        </div>
        <div style={{ minWidth: 0 }}>
          <div className={styles.fileName}>{name}</div>
          <div className={styles.fileMeta}>{kind ? `${kind} · ${size}` : size}</div>
        </div>
      </div>
    </div>
  );
}
