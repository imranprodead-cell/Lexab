import { Icon } from '@/components/icons/Icon';
import styles from './chat.module.css';

interface FileBubbleProps {
  name: string;
  size: string;
}

/** Right-aligned user message showing an uploaded contract file. */
export function UserFileBubble({ name, size }: FileBubbleProps) {
  return (
    <div className={styles.userRow}>
      <div className={styles.fileBubble}>
        <div className={styles.fileIcon}>
          <Icon name="docs" size={20} />
        </div>
        <div style={{ minWidth: 0 }}>
          <div className={styles.fileName}>{name}</div>
          <div className={styles.fileMeta}>DOCX · {size}</div>
        </div>
      </div>
    </div>
  );
}
