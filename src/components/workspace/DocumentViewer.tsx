import {
  createElement,
  forwardRef,
  Fragment,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Icon } from '@/components/icons/Icon';
import { Badge } from '@/components/ui/Badge';
import type { AnalysisResult, DocBlock, DocBlockType, DocSegment, TextRun } from '@/types/domain';
import { isRedlineSlot, isTextRun } from '@/types/domain';
import { RedlineSpan } from './RedlineSpan';
import { escapeHtml, htmlToSegments, sanitizeHref, segmentsToHtml } from './richText';
import { useChatStore } from '@/store/useChatStore';
import { useUIStore } from '@/store/useUIStore';
import { useI18n } from '@/i18n/I18nProvider';
import styles from './workspace.module.css';

/** What the currently-focused editable block is — drives the toolbar state. */
export interface ActiveBlock {
  index: number;
  type: DocBlockType;
  align: 'left' | 'center' | 'right';
  /** Heading level (1 or 2); undefined for non-heading blocks. Drives the
   *  style dropdown so an H1 shows "Heading 1" instead of always "Heading 2". */
  level?: 1 | 2;
}

/** Imperative editor commands the top toolbar calls into. */
export interface DocEditorHandle {
  /** Toggle an inline mark on the current selection (keeps editor focus). */
  format: (cmd: 'bold' | 'italic' | 'underline' | 'strikeThrough') => void;
  /** Change the active block's type (heading/paragraph/list item). */
  applyBlockType: (type: DocBlockType) => void;
  applyAlign: (align: 'left' | 'center' | 'right') => void;
  applyLevel: (level: 1 | 2) => void;
  /** Wrap the selection in a link (or unlink when url is null/empty). */
  insertLink: (url: string | null) => void;
  clipboard: (cmd: 'cut' | 'copy' | 'paste') => void;
  /** Close the open editor without committing stale DOM (used before undo/redo). */
  exitEdit: () => void;
}

interface DocumentViewerProps {
  analysis: AnalysisResult;
  pendingCount: number;
  /** Editing enabled (owner / team admin / editor). */
  canEdit: boolean;
  /** Persist a new document (updates store + server + undo snapshot). */
  onChange?: (document: DocBlock[]) => void;
  /** Reports which block is focused so the toolbar can reflect its style. */
  onActiveChange?: (active: ActiveBlock | null) => void;
  anchor?: { redlineId: string; nonce: number } | null;
  /** The top editing toolbar, rendered above the document header. */
  topBar?: ReactNode;
  /** Draft mode: the name/badge header duplicates the draft action bar — hide it. */
  hideHeader?: boolean;
  children?: ReactNode; // floating toolbar slot
}

/** Render one formatted text run with its marks + optional link. */
function FormattedRun({ run }: { run: TextRun }) {
  const marks = new Set(run.marks ?? []);
  let node: ReactNode = run.text;
  if (marks.has('s')) node = <s>{node}</s>;
  if (marks.has('u')) node = <u>{node}</u>;
  if (marks.has('i')) node = <em>{node}</em>;
  if (marks.has('b')) node = <strong>{node}</strong>;
  const href = sanitizeHref(run.href); // never render a javascript:/data: link
  if (href) {
    node = (
      <a href={href} target="_blank" rel="noreferrer noopener">
        {node}
      </a>
    );
  }
  return <>{node}</>;
}

/**
 * A single contentEditable block. Uncontrolled: its HTML is seeded once on
 * mount so the caret is never reset while typing. Inline formatting flows
 * through the browser; on blur the DOM is serialized back to the model.
 */
function BlockEditor({
  tagName,
  className,
  initialHtml,
  onCommit,
  onFocusBlock,
}: {
  tagName: string;
  className: string;
  initialHtml: string;
  onCommit: (el: HTMLElement) => void;
  onFocusBlock: (el: HTMLElement) => void;
}) {
  const ref = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.innerHTML = initialHtml;
    el.focus();
    // Caret to end of the seeded content.
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    // Mount-only: never re-seed (would wipe the caret mid-edit).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return createElement(tagName, {
    ref,
    contentEditable: true,
    suppressContentEditableWarning: true,
    className,
    spellCheck: true,
    onFocus: () => ref.current && onFocusBlock(ref.current),
    onBlur: () => ref.current && onCommit(ref.current),
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        ref.current?.blur();
      }
    },
  });
}

/** The right-hand paper view: renders the contract with inline AI redlines and
 *  a rich contentEditable editor driven by the top toolbar. */
export const DocumentViewer = forwardRef<DocEditorHandle, DocumentViewerProps>(function DocumentViewer(
  { analysis, pendingCount, canEdit, onChange, onActiveChange, anchor, topBar, hideHeader, children },
  ref,
) {
  const { t } = useI18n();
  const showEdits = useChatStore((s) => s.showEdits);
  const pushToast = useUIStore((s) => s.pushToast);
  const redlineById = new Map(analysis.redlines.map((r) => [r.id, r]));
  const [editIdx, setEditIdx] = useState<number | null>(null);
  // Bumped after a block-level op (type/align/level) to remount the editor with
  // fresh content, so the block stays open and the toolbar stays enabled.
  const [editorKey, setEditorKey] = useState(0);
  const [flashIdx, setFlashIdx] = useState<number | null>(null);
  const blockRefs = useRef(new Map<number, HTMLElement>());
  /** The DOM node of the block currently being edited (for execCommand). */
  const activeElRef = useRef<HTMLElement | null>(null);
  /** Nonce of the last finding-click we scrolled to, so a mere identity change
   *  of `analysis.document` never re-triggers the jump. */
  const consumedAnchorNonce = useRef<number | null>(null);

  const resolveSlot = (redlineId: string): string => {
    const rl = redlineById.get(redlineId);
    if (!rl) return '';
    return rl.status === 'accepted' ? rl.insText : rl.delText;
  };

  /** Flatten a block's inline content to plain text (resolving redline slots) —
   *  used when converting a body block into a heading (headings store `text`). */
  const flattenToText = (block: DocBlock): string =>
    (block.segments ?? [])
      .map((s) => (typeof s === 'string' ? s : isRedlineSlot(s) ? resolveSlot(s.redlineId) : s.text))
      .join('');

  const exitEditor = () => {
    setEditIdx(null);
    activeElRef.current = null;
    onActiveChange?.(null);
  };

  // Click a finding → scroll to and flash the clause whose paragraph carries
  // that redline. Only a NEW click (fresh nonce) jumps; a plain identity change
  // of `analysis.document` (block edit, undo/redo, reanalyze) must NOT yank the
  // view back to the old finding and re-flash. Repeat clicks on the same finding
  // carry a fresh nonce, so they still scroll.
  useEffect(() => {
    if (!anchor || anchor.nonce === consumedAnchorNonce.current) return;
    const targetIdx = analysis.document.findIndex((b) =>
      (b.segments ?? []).some((s) => isRedlineSlot(s) && s.redlineId === anchor.redlineId),
    );
    if (targetIdx < 0) return;
    const el = blockRefs.current.get(targetIdx);
    if (!el) return; // block not mounted yet — retry on the next render
    consumedAnchorNonce.current = anchor.nonce; // this click is now handled
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setFlashIdx(targetIdx);
    const timer = setTimeout(() => setFlashIdx(null), 1300);
    return () => clearTimeout(timer);
  }, [anchor, analysis.document]);

  /** Replace one block and persist the whole document. */
  const commitBlock = (index: number, next: DocBlock) => {
    if (!onChange) return;
    const document = analysis.document.map((b, i) => (i === index ? next : b));
    onChange(document);
  };

  /** Serialize an editor's DOM into a fresh block (preserving type/align/level). */
  const serialize = (index: number, el: HTMLElement): DocBlock => {
    const prev = analysis.document[index];
    if (prev.type === 'heading') {
      return { ...prev, text: (el.textContent ?? '').trim() };
    }
    return { ...prev, segments: htmlToSegments(el) };
  };

  const onEditorCommit = (index: number) => (el: HTMLElement) => {
    const before = analysis.document[index];
    const next = serialize(index, el);
    // Only persist when something actually changed (avoids churn on focus loss).
    if (JSON.stringify(before) !== JSON.stringify(next)) commitBlock(index, next);
  };

  const beginEdit = (index: number) => {
    if (!canEdit) return;
    setEditIdx(index);
  };

  const reportActive = (index: number) => {
    const b = analysis.document[index];
    onActiveChange?.({ index, type: b.type, align: b.align ?? 'left', level: b.level });
  };

  /** Serialize the open editor into a fresh block, apply `mutate`, persist, and
   *  keep the block open (remount with fresh content so the toolbar stays live). */
  const applyBlockChange = (mutate: (base: DocBlock) => DocBlock) => {
    if (editIdx === null) return;
    const idx = editIdx;
    const el = activeElRef.current;
    const base = el ? serialize(idx, el) : analysis.document[idx];
    commitBlock(idx, mutate(base));
    setEditorKey((k) => k + 1); // remount editor → fresh content + refocus
  };

  // ── Imperative API for the top toolbar ────────────────────────────────────
  useImperativeHandle(ref, () => ({
    format: (cmd) => {
      const el = activeElRef.current;
      if (!el) return;
      el.focus();
      document.execCommand(cmd);
    },
    applyBlockType: (type) =>
      applyBlockChange((base) => {
        const wasHeading = base.type === 'heading';
        const nowHeading = type === 'heading';
        if (wasHeading && !nowHeading) return { type, segments: [base.text ?? ''], align: base.align };
        if (!wasHeading && nowHeading) return { type, text: flattenToText(base), align: base.align, level: base.level ?? 2 };
        return { ...base, type };
      }),
    applyAlign: (align) => applyBlockChange((base) => ({ ...base, align })),
    applyLevel: (level) =>
      // Converting a body block to a heading MUST flatten its segments to text —
      // a heading with only `segments` renders/exports as empty (data loss).
      applyBlockChange((base) =>
        base.type === 'heading'
          ? { ...base, level }
          : { type: 'heading', text: flattenToText(base), align: base.align, level },
      ),
    insertLink: (url) => {
      const el = activeElRef.current;
      if (!el) return;
      el.focus();
      const safe = sanitizeHref(url ?? undefined);
      if (!safe) {
        document.execCommand('unlink');
        return;
      }
      const sel = window.getSelection();
      if (sel && !sel.isCollapsed) document.execCommand('createLink', false, safe);
      else document.execCommand('insertHTML', false, `<a href="${escapeHtml(safe)}" data-href="${escapeHtml(safe)}">${escapeHtml(safe)}</a>`);
    },
    clipboard: (cmd) => {
      const el = activeElRef.current;
      if (!el) return;
      el.focus();
      if (cmd === 'paste') {
        // Programmatic paste is blocked by browsers; read the clipboard instead.
        if (!navigator.clipboard?.readText) {
          pushToast(t('editor.pasteUnsupported'), 'default');
          return;
        }
        void navigator.clipboard
          .readText()
          .then((text) => text && document.execCommand('insertText', false, text))
          .catch(() => pushToast(t('editor.pasteUnsupported'), 'default'));
        return;
      }
      document.execCommand(cmd);
    },
    exitEdit: exitEditor,
  }));

  /** Render one block's inline content honoring the show-edits toggle. */
  const renderInline = (block: DocBlock): ReactNode =>
    (block.segments ?? []).map((seg: DocSegment, j) => {
      if (typeof seg === 'string') return <Fragment key={j}>{seg}</Fragment>;
      if (isRedlineSlot(seg)) {
        const rl = redlineById.get(seg.redlineId);
        if (!rl) return null;
        // "Show edits" off → render the clean resolved wording (no markup).
        if (!showEdits) return <Fragment key={j}>{rl.status === 'accepted' ? rl.insText : rl.delText}</Fragment>;
        return <RedlineSpan key={j} redline={rl} />;
      }
      if (isTextRun(seg)) return <FormattedRun key={j} run={seg} />;
      return null;
    });

  const setStaticRef = (i: number) => (el: HTMLElement | null) => {
    if (el) blockRefs.current.set(i, el);
    else blockRefs.current.delete(i);
  };

  /** Render a single block — editor when active, otherwise static. */
  const renderBlock = (index: number, tag: 'h3' | 'p' | 'li'): ReactNode => {
    const block = analysis.document[index];
    const alignStyle = block.align && block.align !== 'left' ? { textAlign: block.align } : undefined;

    if (editIdx === index && canEdit) {
      const cls =
        block.type === 'heading'
          ? `${styles.clauseHeading} ${styles.blockEditing}`
          : `${styles.clause} ${styles.blockEditing}`;
      const initialHtml =
        block.type === 'heading' ? escapeHtml(block.text ?? '') : segmentsToHtml(block.segments ?? [], resolveSlot);
      return (
        <BlockEditor
          key={`${index}-${editorKey}`}
          tagName={tag}
          className={cls}
          initialHtml={initialHtml}
          onFocusBlock={(el) => {
            activeElRef.current = el;
            reportActive(index);
          }}
          onCommit={onEditorCommit(index)}
        />
      );
    }

    if (block.type === 'heading') {
      const HeadingTag = block.level === 1 ? 'h2' : 'h3';
      return createElement(
        HeadingTag,
        {
          key: index,
          ref: setStaticRef(index),
          className: `${styles.clauseHeading} ${canEdit ? styles.clauseEditable : ''} ${flashIdx === index ? styles.clauseFlash : ''}`,
          style: alignStyle,
          onClick: () => beginEdit(index),
        },
        block.text,
      );
    }

    return createElement(
      tag,
      {
        key: index,
        ref: setStaticRef(index),
        className: `${styles.clause} ${canEdit ? styles.clauseEditable : ''} ${flashIdx === index ? styles.clauseFlash : ''}`,
        style: alignStyle,
        onClick: canEdit ? () => beginEdit(index) : undefined,
      },
      renderInline(block),
      canEdit ? (
        <button
          key="edit"
          type="button"
          className={styles.clauseEditIcon}
          title={t('ws.editParagraph')}
          aria-label={t('ws.editParagraph')}
          onClick={(e) => {
            e.stopPropagation();
            beginEdit(index);
          }}
        >
          <Icon name="pen" size={12} />
        </button>
      ) : null,
    );
  };

  // Walk the blocks, grouping consecutive list items into a single <ul>/<ol>.
  const rendered: ReactNode[] = [];
  const doc = analysis.document;
  for (let i = 0; i < doc.length; ) {
    const type = doc[i].type;
    if (type === 'bullet' || type === 'numbered') {
      const start = i;
      const items: ReactNode[] = [];
      while (i < doc.length && doc[i].type === type) {
        items.push(renderBlock(i, 'li'));
        i++;
      }
      rendered.push(
        createElement(
          type === 'bullet' ? 'ul' : 'ol',
          { key: `list-${start}`, className: styles.clauseList },
          items,
        ),
      );
      continue;
    }
    rendered.push(renderBlock(i, type === 'heading' ? 'h3' : 'p'));
    i++;
  }

  return (
    <section className={styles.rightPane} aria-label="Document viewer">
      {topBar}
      {!hideHeader ? (
        <div className={styles.docHeader}>
          <div className={styles.docHeaderLeft}>
            <div className={styles.docHeaderIcon}>
              <Icon name="docs" size={17} />
            </div>
            <span className={styles.docName}>{analysis.fileName}</span>
          </div>
          {pendingCount > 0 ? (
            <Badge color="accent">{t('ws.suggestionsCount', { n: pendingCount })}</Badge>
          ) : (
            <Badge color="Low">{t('ws.allReviewedBadge')}</Badge>
          )}
        </div>
      ) : null}

      <div className={`${styles.docBody} scroll`}>
        <article className={`${styles.paper} lx-print`}>
          <header className={styles.paperHeader}>
            <div className={styles.paperKicker}>{t('ws.paperKicker')}</div>
            <div className={styles.paperTitle}>
              {analysis.fileName.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ')}
            </div>
          </header>
          {rendered}
        </article>
      </div>

      {children}
    </section>
  );
});
