/**
 * Rich-text (de)serialization between the stored document model and the HTML
 * that lives inside a `contentEditable` block editor.
 *
 * The stored inline model is `DocSegment[]`:
 *   - bare `string`        → plain run (backward-compatible with old documents)
 *   - `TextRun`            → text + inline marks (b/i/u/s) and/or a hyperlink
 *   - `{ redlineId }`      → a tracked-change slot (AI redline)
 *
 * Redline slots are the legally-critical core: they render inside the editor as
 * an ATOMIC, non-editable token and are passed through serialization unchanged,
 * so formatting/rewriting the surrounding text can never split or drop them.
 *
 * `htmlToSegments` never trusts how the browser produced its HTML — it reads
 * both semantic tags (b/strong/i/em/u/s) AND inline styles (execCommand may emit
 * either), so the round-trip is stable across browsers.
 */
import type { DocSegment, Mark, TextRun } from '@/types/domain';
import { isRedlineSlot, isTextRun } from '@/types/domain';

const MARK_ORDER: Mark[] = ['b', 'i', 'u', 's'];

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Allow only safe link schemes. Anything else (javascript:, data:, vbscript:…)
 * is dropped — a contract link must never be able to run script when a viewer
 * (including a read-only teammate) clicks it. Relative and anchor links pass.
 */
export function sanitizeHref(href: string | undefined): string | undefined {
  if (!href) return undefined;
  const trimmed = href.trim();
  if (!trimmed) return undefined;
  // Relative / same-page links are safe.
  if (/^(\/|#|\.|mailto:|tel:)/i.test(trimmed)) return trimmed;
  // Absolute links: only http(s).
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  // A bare "example.com/x" typed by the user → treat as https.
  if (/^[\w.-]+\.[a-z]{2,}(\/|$)/i.test(trimmed)) return `https://${trimmed}`;
  return undefined; // unsafe or unrecognised scheme → no link
}

/** Wrap escaped text in the tags for its marks and (optionally) a link. */
function wrapRun(run: TextRun): string {
  let html = escapeHtml(run.text);
  if (!run.text) return '';
  const marks = new Set(run.marks ?? []);
  if (marks.has('s')) html = `<s>${html}</s>`;
  if (marks.has('u')) html = `<u>${html}</u>`;
  if (marks.has('i')) html = `<i>${html}</i>`;
  if (marks.has('b')) html = `<b>${html}</b>`;
  const href = sanitizeHref(run.href);
  if (href) html = `<a href="${escapeHtml(href)}" data-href="${escapeHtml(href)}">${html}</a>`;
  return html;
}

/**
 * Model → HTML string for the contentEditable editor.
 * `resolveSlotText(redlineId)` supplies the read-only text shown for a redline
 * atom (the resolved wording — accepted insertion or original text).
 */
export function segmentsToHtml(segments: DocSegment[], resolveSlotText: (redlineId: string) => string): string {
  let html = '';
  for (const seg of segments) {
    if (typeof seg === 'string') {
      html += escapeHtml(seg);
    } else if (isRedlineSlot(seg)) {
      const text = escapeHtml(resolveSlotText(seg.redlineId));
      html += `<span class="lx-redline-atom" contenteditable="false" data-redline="${escapeHtml(seg.redlineId)}">${text}</span>`;
    } else if (isTextRun(seg)) {
      html += wrapRun(seg);
    }
  }
  return html;
}

interface MarkState {
  marks: Set<Mark>;
  href?: string;
}

/** Marks an element adds AND removes (nested `font-weight:normal` clears bold),
 *  from tag name AND inline style — so explicit un-formatting (e.g. pasted from
 *  Word/Docs) is honored instead of ignored. */
function marksFromElement(el: Element): { add: Mark[]; remove: Mark[]; href?: string } {
  const tag = el.tagName.toLowerCase();
  const add: Mark[] = [];
  const remove: Mark[] = [];
  if (tag === 'b' || tag === 'strong') add.push('b');
  if (tag === 'i' || tag === 'em') add.push('i');
  if (tag === 'u' || tag === 'ins') add.push('u');
  if (tag === 's' || tag === 'strike' || tag === 'del') add.push('s');

  const style = (el as HTMLElement).style;
  if (style) {
    const fw = style.fontWeight;
    if (fw === 'bold' || fw === 'bolder' || (/^\d+$/.test(fw) && Number(fw) >= 600)) add.push('b');
    else if (fw === 'normal' || fw === 'lighter' || (/^\d+$/.test(fw) && Number(fw) < 600)) remove.push('b');
    if (style.fontStyle === 'italic') add.push('i');
    else if (style.fontStyle === 'normal') remove.push('i');
    const deco = `${style.textDecoration} ${style.textDecorationLine}`.trim();
    if (deco.includes('underline')) add.push('u');
    if (deco.includes('line-through')) add.push('s');
    if (deco === 'none') remove.push('u', 's');
  }

  let href: string | undefined;
  if (tag === 'a') {
    const h = el.getAttribute('href') ?? el.getAttribute('data-href') ?? '';
    if (h && h !== '#') href = sanitizeHref(h);
  }
  return { add, remove, href };
}

/** Normalize marks into a stable order and drop duplicates. */
function orderMarks(marks: Set<Mark>): Mark[] | undefined {
  const out = MARK_ORDER.filter((m) => marks.has(m));
  return out.length ? out : undefined;
}

function sameRun(a: TextRun, b: TextRun): boolean {
  return (a.marks ?? []).join(',') === (b.marks ?? []).join(',') && (a.href ?? '') === (b.href ?? '');
}

/** Collapse a run into a bare string when it carries no formatting. */
function toSegment(run: TextRun): DocSegment {
  if ((!run.marks || run.marks.length === 0) && !run.href) return run.text;
  return run;
}

/** Merge adjacent runs with identical formatting; drop empty runs. */
function normalize(raw: DocSegment[]): DocSegment[] {
  const out: DocSegment[] = [];
  for (const seg of raw) {
    if (typeof seg === 'string') {
      if (!seg) continue;
      const prev = out[out.length - 1];
      if (typeof prev === 'string') out[out.length - 1] = prev + seg;
      else out.push(seg);
      continue;
    }
    if (isRedlineSlot(seg)) {
      out.push(seg);
      continue;
    }
    // TextRun
    if (!seg.text) continue;
    const prev = out[out.length - 1];
    if (prev && typeof prev !== 'string' && isTextRun(prev) && sameRun(prev, seg)) {
      prev.text += seg.text;
    } else {
      out.push({ ...seg, marks: seg.marks ? [...seg.marks] : undefined });
    }
  }
  return out.map((s) => (typeof s === 'string' || isRedlineSlot(s) ? s : toSegment(s)));
}

/**
 * HTML (from the contentEditable editor) → the stored inline model.
 * Redline atoms (`[data-redline]`) pass through as `{ redlineId }` untouched.
 */
export function htmlToSegments(root: Node): DocSegment[] {
  const raw: DocSegment[] = [];

  const walk = (node: Node, state: MarkState) => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === 3 /* text */) {
        // Keep text verbatim, including non-breaking spaces (meaningful in
        // legal text) — do not normalise them to spaces.
        const text = child.nodeValue ?? '';
        if (text) raw.push({ text, marks: orderMarks(state.marks), href: state.href });
        continue;
      }
      if (child.nodeType !== 1 /* element */) continue;
      const el = child as Element;

      // A redline atom is opaque: emit the slot and never descend into it.
      const rid = el.getAttribute('data-redline');
      if (rid) {
        raw.push({ redlineId: rid });
        continue;
      }

      const tag = el.tagName.toLowerCase();
      if (tag === 'br') {
        raw.push({ text: '\n' });
        continue;
      }

      const { add, remove, href } = marksFromElement(el);
      const nextMarks = new Set(state.marks);
      for (const m of add) nextMarks.add(m);
      for (const m of remove) nextMarks.delete(m);

      // A block-level child (div/p) starts a new line: emit the separator
      // BEFORE its content when the line already has content. Handles a leading
      // text node before a block AND consecutive blocks.
      const isBlock = tag === 'div' || tag === 'p';
      const last = raw[raw.length - 1];
      const atLineStart = raw.length === 0 || (isTextRun(last) && last.text.endsWith('\n'));
      if (isBlock && !atLineStart) raw.push({ text: '\n' });
      walk(el, { marks: nextMarks, href: href ?? state.href });
    }
  };

  walk(root, { marks: new Set() });
  return normalize(raw);
}

/** Plain text of a segment list (marks stripped), for previews/measurements. */
export function segmentsToPlainText(segments: DocSegment[], resolveSlotText: (redlineId: string) => string): string {
  return segments
    .map((seg) => {
      if (typeof seg === 'string') return seg;
      if (isRedlineSlot(seg)) return resolveSlotText(seg.redlineId);
      return seg.text;
    })
    .join('');
}
