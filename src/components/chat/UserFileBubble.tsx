import { fileTypeLabel } from '@/lib/fileKind';
import { FileIcon } from './FileIcon';
import styles from './chat.module.css';

interface FileBubbleProps {
  name: string;
  size: string;
}

/** Right-aligned user message showing an uploaded contract file. Формат — по
 *  имени файла («Word (.docx)», «PDF»), значок — в цвете программы. */
export function UserFileBubble({ name, size }: FileBubbleProps) {
  const type = fileTypeLabel(name);
  return (
    <div className={styles.userRow}>
      <div className={styles.fileBubble}>
        <FileIcon name={name} size={30} />
        <div style={{ minWidth: 0 }}>
          <div className={styles.fileName}>{name}</div>
          <div className={styles.fileMeta}>{type ? `${type} · ${size}` : size}</div>
        </div>
      </div>
    </div>
  );
}
