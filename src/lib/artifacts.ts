/**
 * «Артефакты» ответа ИИ — то, что открывается в боковой панели (как в Claude):
 *  - документ: блок ```…``` (претензия, договор, письмо) — правится и
 *    сохраняется в Vault → Documents, скачивается в Word/PDF/TXT;
 *  - большая таблица (≥5 столбцов или >12 строк) — вид как в Excel,
 *    скачивается в .xlsx/.csv;
 *  - колода (/slides) — см. deck.ts.
 *
 * Ключ артефакта = id сообщения + вид + хеш ИСХОДНОГО содержимого: он один и
 * тот же при каждом показе и на любом устройстве — по нему находится
 * сохранённая версия документа (saved_templates.source_template_id).
 */
import type { Deck } from './deck';

export interface DocArtifact {
  kind: 'doc';
  key: string;
  title: string;
  content: string;
}

export interface TableArtifact {
  kind: 'table';
  key: string;
  title: string;
  header: string[];
  rows: string[][];
}

export interface DeckArtifact {
  kind: 'deck';
  key: string;
  title: string;
  deck: Deck;
}

export type Artifact = DocArtifact | TableArtifact | DeckArtifact;

/** FNV-1a 32 бит — короткий устойчивый отпечаток содержимого. */
export function hash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** Связь «документ из чата ↔ сохранённый черновик» (≤60 символов на сервере). */
export const savedSourceId = (key: string) => `chat:${key}`.slice(0, 60);

// ── Документы ──────────────────────────────────────────────────────────────

/** Блок кода — документ, если он содержательный (не однострочная вставка). */
export function isDocBlock(content: string, lang = ''): boolean {
  if (/^questions?$/i.test(lang)) return false;
  const text = content.trim();
  return text.split('\n').length >= 6 || text.length >= 300;
}

/** Ближайший заголовок («### …» или строка «**…**») над блоком — если он рядом. */
export function headingBefore(before: string): string | null {
  const prev = before.trimEnd().split('\n').slice(-3).reverse();
  for (const line of prev) {
    const m = /^#{1,6}\s+(.+)$/.exec(line.trim()) ?? /^\*\*(.+?)\*\*:?$/.exec(line.trim());
    if (m) return clean(m[1]).replace(/:$/, '').slice(0, 120);
  }
  return null;
}

/** Заголовок документа: ближайший заголовок перед блоком, иначе первая строка. */
export function docTitle(content: string, before: string, fallback: string): string {
  const heading = headingBefore(before);
  if (heading) return heading;
  const first = content
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l && !/^\[.*\]$/.test(l) && !/^[_\s.№«»"0-9-]+$/.test(l));
  return first ? clean(first).slice(0, 120) : fallback;
}

export function docKey(messageId: string, content: string): string {
  return `${messageId}:doc:${hash(content.trim())}`;
}

// ── Таблицы ────────────────────────────────────────────────────────────────

function clean(s: string): string {
  return s
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function splitRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
  const cells: string[] = [];
  let cur = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '\\' && s[i + 1] === '|') {
      cur += '|';
      i++;
    } else if (ch === '|') {
      cells.push(cur);
      cur = '';
    } else cur += ch;
  }
  cells.push(cur);
  return cells.map(clean);
}

/** Таблица GFM из исходного Markdown (шапка, разделитель |---|, строки). */
export function parseMarkdownTable(raw: string): { header: string[]; rows: string[][] } | null {
  const lines = raw
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.includes('|'));
  if (lines.length < 2 || !/^\|?\s*:?-{2,}/.test(lines[1])) return null;
  const header = splitRow(lines[0]);
  const rows = lines.slice(2).map((l) => {
    const r = splitRow(l);
    // Выравниваем под ширину шапки: лишнее отрезаем, нехватку добиваем пустыми.
    return header.map((_, i) => r[i] ?? '');
  });
  return { header, rows };
}

/** Широкая или длинная таблица — в чате превью, целиком — в панели. */
export const isBigTable = (t: { header: string[]; rows: string[][] }) => t.header.length >= 5 || t.rows.length > 12;

export function tableKey(messageId: string, t: { header: string[]; rows: string[][] }): string {
  return `${messageId}:table:${hash(JSON.stringify([t.header, t.rows]))}`;
}

// ── Все артефакты ответа (для автооткрытия панели) ─────────────────────────

/**
 * Документы и большие таблицы ответа в порядке появления. Тот же разбор, что
 * и в MarkdownMessage, поэтому ключи совпадают с карточками в чате.
 */
export function extractArtifacts(
  text: string,
  messageId: string,
  labels: { document: string; table: string },
): Artifact[] {
  const out: Artifact[] = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const fence = /^\s*(```+|~~~+)\s*([\w-]*)/.exec(lines[i]);
    if (fence) {
      const close = lines.findIndex((l, j) => j > i && l.trim().startsWith(fence[1]));
      const end = close < 0 ? lines.length : close;
      const content = lines.slice(i + 1, end).join('\n');
      if (isDocBlock(content, fence[2])) {
        out.push({
          kind: 'doc',
          key: docKey(messageId, content),
          title: docTitle(content, lines.slice(0, i).join('\n'), labels.document),
          content: content.trim(),
        });
      }
      i = end;
      continue;
    }
    if (lines[i].includes('|') && lines[i + 1] && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
      let end = i + 2;
      while (end < lines.length && lines[end].includes('|') && lines[end].trim()) end++;
      const parsed = parseMarkdownTable(lines.slice(i, end).join('\n'));
      if (parsed && isBigTable(parsed)) {
        const title = headingBefore(lines.slice(0, i).join('\n')) ?? labels.table;
        out.push({ kind: 'table', key: tableKey(messageId, parsed), title, ...parsed });
      }
      i = end - 1;
    }
  }
  return out;
}
