/**
 * Превью документа для карточек «Недавние файлы» и Vault → Documents
 * (ui-test 2026-11-15, по образцу галереи Claude): заголовок и первые абзацы
 * — чтобы по карточке было видно, что внутри. Только начало текста самого
 * документа, без ИИ; больше PREVIEW_CHARS знаков наружу не уходит.
 */
import type { DocBlock } from '../types.ts';

export const PREVIEW_CHARS = 600;
const TITLE_CHARS = 140;
/** Сколько первых блоков разбора смотреть: дальше превью всё равно обрезано. */
export const PREVIEW_BLOCKS = 14;

export interface DocPreview {
  title?: string;
  text: string;
}

const squash = (s: string) => s.replace(/\s+/g, ' ').trim();

function clip(s: string, max: number): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/** Абзацы → превью: не длиннее PREVIEW_CHARS, абзацы через \n. */
function collect(title: string | undefined, paragraphs: string[]): DocPreview {
  const out: string[] = [];
  let left = PREVIEW_CHARS;
  for (const p of paragraphs) {
    if (left <= 0) break;
    const line = clip(p, left);
    out.push(line);
    left -= line.length + 1;
  }
  return { ...(title ? { title: clip(title, TITLE_CHARS) } : {}), text: out.join('\n') };
}

/** Похоже на заголовок: коротко и без точки в конце, либо капсом. */
function looksLikeTitle(line: string): boolean {
  if (line.length < 3 || line.length > TITLE_CHARS) return false;
  if (/\p{L}/u.test(line) && line === line.toUpperCase()) return true;
  return line.length <= 90 && !/[.;:,]$/.test(line);
}

/**
 * Из блоков последнего разбора. Сегменты-правки (redlineId) показываются
 * исходной формулировкой договора — превью = документ, как его загрузили.
 */
export function previewFromBlocks(blocks: DocBlock[], delTextById: Map<string, string>): DocPreview {
  const texts: { heading: boolean; text: string }[] = [];
  for (const b of blocks.slice(0, PREVIEW_BLOCKS)) {
    const raw =
      b.type === 'heading'
        ? (b.text ?? '')
        : (b.segments ?? [])
            .map((seg) => (typeof seg === 'string' ? seg : 'redlineId' in seg ? (delTextById.get(seg.redlineId) ?? '') : seg.text))
            .join('');
    const text = squash(raw);
    if (text) texts.push({ heading: b.type === 'heading', text });
  }
  if (!texts.length) return { text: '' };
  const first = texts[0];
  const title = first.heading || looksLikeTitle(first.text) ? first.text : undefined;
  return collect(title, (title ? texts.slice(1) : texts).map((x) => x.text));
}

/** Из распознанного текста загрузки (если разбора ещё нет). */
export function previewFromText(text: string): DocPreview {
  const lines = text
    .slice(0, PREVIEW_CHARS * 4)
    .split(/\n+/)
    .map(squash)
    .filter(Boolean);
  if (!lines.length) return { text: '' };
  const title = looksLikeTitle(lines[0]) ? lines[0] : undefined;
  return collect(title, title ? lines.slice(1) : lines);
}

/** Блоки, на которые ссылается превью (чтобы расшифровать только их правки). */
export function redlineIdsIn(blocks: DocBlock[]): string[] {
  const ids: string[] = [];
  for (const b of blocks.slice(0, PREVIEW_BLOCKS)) {
    for (const seg of b.segments ?? []) if (typeof seg !== 'string' && 'redlineId' in seg) ids.push(seg.redlineId);
  }
  return ids;
}
