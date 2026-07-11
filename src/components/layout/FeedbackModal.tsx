import { useEffect, useRef, useState, type DragEvent } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/icons/Icon';
import { feedbackApi, type FeedbackAttachment, type FeedbackCategory } from '@/api/feedback.api';
import { useUIStore } from '@/store/useUIStore';
import { useI18n } from '@/i18n/I18nProvider';
import ui from '@/components/ui/ui.module.css';
import styles from './layout.module.css';

const CATEGORIES: FeedbackCategory[] = ['general', 'bug', 'legal', 'quality', 'feature', 'billing'];
const MAX_FILES = 5;
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_TOTAL_BYTES = 8 * 1024 * 1024;
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);

interface Attached extends FeedbackAttachment {
  size: number;
  /** data: URL used for the thumbnail. */
  preview: string;
}

/**
 * Feedback form (settings menu → «Обратная связь»): message, up to 5 image
 * attachments (drag & drop), optional category. Lands in the founder's inbox.
 */
export function FeedbackModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const pushToast = useUIStore((s) => s.pushToast);

  const [text, setText] = useState('');
  const [files, setFiles] = useState<Attached[]>([]);
  const [category, setCategory] = useState<FeedbackCategory | null>(null);
  const [catOpen, setCatOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  // In-flight FileReader count: blocks Send so an attachment can't be dropped
  // from the payload by clicking Send before its bytes are read.
  const [pending, setPending] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const catWrapRef = useRef<HTMLDivElement>(null);
  // Reserved slots (committed + in-flight) and reserved bytes — authoritative
  // synchronous counters so rapid drops can't overshoot the 5-file / 8 MB caps.
  const slotRef = useRef(0);
  const bytesRef = useRef(0);
  // Bumped on reset/close so a late read can't re-add a phantom file.
  const genRef = useRef(0);

  const addFiles = (incoming: FileList | File[]) => {
    for (const file of Array.from(incoming)) {
      if (slotRef.current >= MAX_FILES) {
        pushToast(t('feedback.tooMany'), 'error');
        break;
      }
      if (!IMAGE_TYPES.has(file.type)) {
        pushToast(t('feedback.imagesOnly'), 'error');
        continue;
      }
      if (file.size > MAX_FILE_BYTES) {
        pushToast(t('feedback.tooBig'), 'error');
        continue;
      }
      if (bytesRef.current + file.size > MAX_TOTAL_BYTES) {
        pushToast(t('feedback.tooLarge'), 'error');
        continue;
      }
      slotRef.current += 1;
      bytesRef.current += file.size;
      const gen = genRef.current;
      const release = () => {
        slotRef.current = Math.max(0, slotRef.current - 1);
        bytesRef.current = Math.max(0, bytesRef.current - file.size);
      };
      setPending((p) => p + 1);
      const reader = new FileReader();
      reader.onloadend = () => setPending((p) => Math.max(0, p - 1));
      reader.onerror = release;
      reader.onload = () => {
        if (gen !== genRef.current) return release(); // modal was reset/closed
        const preview = String(reader.result ?? '');
        const data = preview.split(',')[1] ?? '';
        if (!data) return release();
        setFiles((cur) => {
          if (cur.some((f) => f.preview === preview)) {
            release(); // duplicate — give the reserved slot/bytes back
            return cur;
          }
          return [...cur, { name: file.name, type: file.type, data, size: file.size, preview }];
        });
      };
      reader.readAsDataURL(file);
    }
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
  };

  const removeFile = (preview: string) =>
    setFiles((cur) => {
      const f = cur.find((x) => x.preview === preview);
      if (f) {
        slotRef.current = Math.max(0, slotRef.current - 1);
        bytesRef.current = Math.max(0, bytesRef.current - f.size);
      }
      return cur.filter((x) => x.preview !== preview);
    });

  const reset = () => {
    genRef.current += 1; // invalidate any in-flight reads
    slotRef.current = 0;
    bytesRef.current = 0;
    setPending(0);
    setText('');
    setFiles([]);
    setCategory(null);
    setCatOpen(false);
    setDragOver(false);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  // Escape while the category dropdown is open closes only the dropdown, not
  // the whole modal. A capture-phase listener runs before Modal's own Esc
  // handler and stops it; a pointer-outside click also closes the dropdown.
  useEffect(() => {
    if (!catOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopImmediatePropagation();
        setCatOpen(false);
      }
    };
    const onPointer = (e: MouseEvent) => {
      if (catWrapRef.current && !catWrapRef.current.contains(e.target as Node)) setCatOpen(false);
    };
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('mousedown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('mousedown', onPointer);
    };
  }, [catOpen]);

  const send = () => {
    const message = text.trim();
    if (message.length < 3 || sending || pending > 0) return;
    setSending(true);
    feedbackApi
      .send(message, {
        page: window.location.pathname,
        category: category ?? undefined,
        attachments: files.map(({ name, type, data }) => ({ name, type, data })),
      })
      .then(() => {
        reset();
        onClose();
        pushToast(t('feedback.sent'), 'success');
      })
      .catch(() => pushToast(t('common.error'), 'error'))
      .finally(() => setSending(false));
  };

  return (
    <Modal
      open={open}
      title={t('feedback.title')}
      onClose={handleClose}
      maxWidth={560}
      footer={
        <>
          <Button variant="ghost" onClick={handleClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" onClick={send} disabled={sending || pending > 0 || text.trim().length < 3}>
            {sending ? t('feedback.sending') : t('feedback.send')}
          </Button>
        </>
      }
    >
      <textarea
        className={`${ui.input} ${styles.fbArea}`}
        value={text}
        maxLength={2000}
        rows={5}
        placeholder={t('feedback.placeholder')}
        onChange={(e) => setText(e.target.value)}
        aria-label={t('feedback.placeholder')}
        data-autofocus
      />

      <div className={styles.fbLabel}>
        {t('feedback.attach')} <span className={styles.fbLabelDim}>({files.length}/{MAX_FILES})</span>
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        multiple
        style={{ display: 'none' }}
        onChange={(e) => {
          if (e.target.files?.length) addFiles(e.target.files);
          e.target.value = '';
        }}
      />
      <button
        type="button"
        className={`${styles.fbDrop} ${dragOver ? styles.fbDropOver : ''}`}
        onClick={() => fileInputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
      >
        <Icon name="upload" size={17} />
        {t('feedback.attachHint')}
      </button>
      {files.length ? (
        <div className={styles.fbThumbs}>
          {files.map((f) => (
            <div key={f.preview} className={styles.fbThumb}>
              <img src={f.preview} alt={f.name} className={styles.fbThumbImg} />
              <button
                type="button"
                className={styles.fbThumbRemove}
                aria-label={`${t('docs.delete')} ${f.name}`}
                onClick={() => removeFile(f.preview)}
              >
                <Icon name="x" size={12} strokeWidth={2.4} />
              </button>
            </div>
          ))}
        </div>
      ) : null}

      <div className={styles.fbLabel}>
        {t('feedback.type')} <span className={styles.fbLabelDim}>{t('feedback.typeOptional')}</span>
      </div>
      <div className={styles.fbSelectWrap} ref={catWrapRef}>
        <button
          type="button"
          className={styles.fbSelect}
          aria-haspopup="listbox"
          aria-expanded={catOpen}
          onClick={() => setCatOpen((v) => !v)}
        >
          <span className={category ? '' : styles.fbSelectPlaceholder}>
            {category ? t(`fbcat.${category}`) : t('feedback.typePlaceholder')}
          </span>
          <span className={`${styles.fbSelectChevron} ${catOpen ? styles.fbSelectChevronOpen : ''}`}>
            <Icon name="chevron" size={14} strokeWidth={2} />
          </span>
        </button>
        {catOpen ? (
          <div className={styles.fbSelectMenu} role="listbox" aria-label={t('feedback.type')}>
            {CATEGORIES.map((c) => (
              <button
                key={c}
                type="button"
                role="option"
                aria-selected={category === c}
                className={`${styles.fbSelectItem} ${category === c ? styles.fbSelectItemOn : ''}`}
                onClick={() => {
                  setCategory((cur) => (cur === c ? null : c));
                  setCatOpen(false);
                }}
              >
                {t(`fbcat.${c}`)}
                {category === c ? <Icon name="check" size={14} color="var(--accent)" strokeWidth={2.4} /> : null}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
