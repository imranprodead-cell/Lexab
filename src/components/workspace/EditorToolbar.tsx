import type { MouseEvent, ReactNode } from 'react';
import { Icon, type IconName } from '@/components/icons/Icon';
import { useI18n } from '@/i18n/I18nProvider';
import type { ActiveBlock, DocEditorHandle } from './DocumentViewer';
import styles from './workspace.module.css';

interface EditorToolbarProps {
  canEdit: boolean;
  active: ActiveBlock | null;
  editor: React.RefObject<DocEditorHandle>;
  showEdits: boolean;
  onToggleShowEdits: () => void;
  /** «Весь договор»: чистый полный текст без пометок правок (режим чтения). */
  fullView: boolean;
  onToggleFullView: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  versionLabel: string | null;
  onVersionHistory: () => void;
  onClose: () => void;
}

/**
 * Top editing toolbar for the document workspace (formatting like Word).
 * Formatting buttons use onMouseDown+preventDefault so the contentEditable
 * block keeps focus and selection while the command runs.
 */
export function EditorToolbar({
  canEdit,
  active,
  editor,
  showEdits,
  onToggleShowEdits,
  fullView,
  onToggleFullView,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  versionLabel,
  onVersionHistory,
  onClose,
}: EditorToolbarProps) {
  const { t } = useI18n();
  const hasActive = active !== null;

  /** A formatting button that never steals focus from the editor. */
  const FmtBtn = ({
    icon,
    label,
    onRun,
    disabled,
    on,
  }: {
    icon: IconName;
    label: string;
    onRun: () => void;
    disabled?: boolean;
    on?: boolean;
  }) => (
    <button
      type="button"
      className={`${styles.etBtn} ${on ? styles.etBtnOn : ''}`}
      title={label}
      aria-label={label}
      aria-pressed={on}
      disabled={disabled}
      onMouseDown={(e: MouseEvent) => {
        e.preventDefault(); // keep the editor's selection
        if (!disabled) onRun();
      }}
    >
      <Icon name={icon} size={16} />
    </button>
  );

  const Divider = () => <span className={styles.etDivider} aria-hidden="true" />;

  const linkPrompt = () => {
    const url = window.prompt(t('editor.linkPrompt'), 'https://');
    if (url === null) return; // cancelled
    editor.current?.insertLink(url.trim() || null);
  };

  const formatButtons: ReactNode = (
    <>
      <FmtBtn icon="bold" label={t('editor.bold')} disabled={!hasActive} onRun={() => editor.current?.format('bold')} />
      <FmtBtn icon="italic" label={t('editor.italic')} disabled={!hasActive} onRun={() => editor.current?.format('italic')} />
      <FmtBtn icon="underline" label={t('editor.underline')} disabled={!hasActive} onRun={() => editor.current?.format('underline')} />
      <FmtBtn icon="strikethrough" label={t('editor.strikethrough')} disabled={!hasActive} onRun={() => editor.current?.format('strikeThrough')} />
      <Divider />
      <FmtBtn icon="list" label={t('editor.bulletList')} disabled={!hasActive} on={active?.type === 'bullet'} onRun={() => editor.current?.applyBlockType('bullet')} />
      <FmtBtn icon="listNumbered" label={t('editor.numberedList')} disabled={!hasActive} on={active?.type === 'numbered'} onRun={() => editor.current?.applyBlockType('numbered')} />
      <Divider />
      <FmtBtn icon="alignLeft" label={t('editor.alignLeft')} disabled={!hasActive} on={(active?.align ?? 'left') === 'left'} onRun={() => editor.current?.applyAlign('left')} />
      <FmtBtn icon="alignCenter" label={t('editor.alignCenter')} disabled={!hasActive} on={active?.align === 'center'} onRun={() => editor.current?.applyAlign('center')} />
      <FmtBtn icon="alignRight" label={t('editor.alignRight')} disabled={!hasActive} on={active?.align === 'right'} onRun={() => editor.current?.applyAlign('right')} />
      <Divider />
      <FmtBtn icon="link" label={t('editor.link')} disabled={!hasActive} onRun={linkPrompt} />
      <FmtBtn icon="cut" label={t('editor.cut')} disabled={!hasActive} onRun={() => editor.current?.clipboard('cut')} />
      <FmtBtn icon="copy" label={t('editor.copy')} disabled={!hasActive} onRun={() => editor.current?.clipboard('copy')} />
      <FmtBtn icon="paste" label={t('editor.paste')} disabled={!hasActive} onRun={() => editor.current?.clipboard('paste')} />
      <Divider />
      <FmtBtn icon="undo" label={t('editor.undo')} disabled={!canUndo} onRun={onUndo} />
      <FmtBtn icon="redo" label={t('editor.redo')} disabled={!canRedo} onRun={onRedo} />
      <Divider />
    </>
  );

  return (
    <div className={styles.editorToolbar} role="toolbar" aria-label={t('editor.toolbar')}>
      <div className={styles.editorToolbarInner}>
        {canEdit ? formatButtons : null}

        {/* Show/hide AI tracked changes — available to everyone. В режиме «Весь
            договор» правки и так скрыты, поэтому переключатель неактивен: иначе
            клик по нему скрытно менял бы сохранённое состояние показа правок. */}
        <button
          type="button"
          className={`${styles.etBtn} ${styles.etTextBtn} ${showEdits ? styles.etBtnOn : ''}`}
          title={t('editor.showEdits')}
          aria-pressed={showEdits}
          disabled={fullView}
          onClick={onToggleShowEdits}
        >
          <Icon name={showEdits ? 'eye' : 'eyeOff'} size={16} />
          <span className={styles.etBtnText}>{t('editor.showEdits')}</span>
        </button>

        {/* «Весь договор»: чистый полный текст всех листов без пометок правок —
            удобно прочитать документ целиком как финальную версию. */}
        <button
          type="button"
          className={`${styles.etBtn} ${styles.etTextBtn} ${fullView ? styles.etBtnOn : ''}`}
          title={t('ws.fullView')}
          aria-pressed={fullView}
          onClick={onToggleFullView}
        >
          <Icon name="docs" size={16} />
          <span className={styles.etBtnText}>{t('ws.fullView')}</span>
        </button>

        {versionLabel ? (
          <button type="button" className={`${styles.etBtn} ${styles.etTextBtn}`} title={t('editor.versionHistory')} onClick={onVersionHistory}>
            <Icon name="history" size={15} />
            <span className={styles.etBtnText}>{versionLabel}</span>
          </button>
        ) : null}

        <span className={styles.etSpacer} />

        <button type="button" className={styles.etBtn} title={t('editor.close')} aria-label={t('editor.close')} onClick={onClose}>
          <Icon name="x" size={16} />
        </button>
      </div>
    </div>
  );
}
