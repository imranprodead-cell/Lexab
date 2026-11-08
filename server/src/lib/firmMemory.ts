/**
 * «Память фирмы» (решение владельца 2026-10-31): агент ищет по всем документам,
 * которые пользователь и так может открыть, — свои договоры и разборы в Vault,
 * документы, сохранённые из чата, и общие документы команды.
 *
 * Права — ровно как у списка документов (GET /documents):
 *  - свои: documents.user_id = я, не удалён;
 *  - командные: documents.team_shared, владелец — команда, где я АКТИВНЫЙ
 *    участник (team_members.member_user_id = я, status = 'active');
 *  - сохранённые из чата (saved_templates): только свои.
 * Тексты в базе зашифрованы ключом ВЛАДЕЛЬЦА документа — расшифровываем его
 * ключом; не расшифровалось — документ ищется только по имени. Модель может
 * открыть лишь документ из этого набора (id вне набора — «не найден»).
 */
import type { Db } from '../db.ts';
import { decJsonFromJsonb, decText } from './docCrypto.ts';
import type { DocBlock } from '../types.ts';

export interface MemoryDoc {
  id: string;
  kind: 'contract' | 'saved';
  name: string;
  counterparty: string;
  status: string;
  updated: string;
  /** Имя владельца, если документ общий командный (не свой). */
  sharedBy?: string;
  summary: string;
  text: string;
}

/** Сколько документов просматриваем за один ответ (самые свежие). */
const OWN_CAP = 200;
const SHARED_CAP = 100;
const SAVED_CAP = 100;
/** Потолок текста одного документа в памяти. */
const DOC_TEXT_CAP = 300_000;

/** Блоки разбора → текст (запасной текст, если исходный файл недоступен). */
export function blocksToText(blocks: unknown): string {
  if (!Array.isArray(blocks)) return '';
  return (blocks as DocBlock[])
    .map((b) => {
      if (typeof b?.text === 'string') return b.text;
      return (b?.segments ?? [])
        .map((s) => (typeof s === 'string' ? s : s && typeof s === 'object' && 'text' in s && typeof s.text === 'string' ? s.text : ''))
        .join('');
    })
    .filter(Boolean)
    .join('\n');
}

const dateOf = (v: unknown) => {
  const d = new Date(v as string);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
};

/** Все доступные пользователю документы с расшифрованным текстом. */
export async function loadFirmMemory(db: Db, userId: string): Promise<MemoryDoc[]> {
  type DocRow = { id: string; user_id: string; name: string; counterparty: string; status: string; updated_at: unknown; shared_by: string | null };
  const own = await db.query<DocRow>(
    `SELECT id, user_id, name, counterparty, status, updated_at, NULL AS shared_by
     FROM documents WHERE user_id = $1 AND deleted_at IS NULL
     ORDER BY updated_at DESC LIMIT ${OWN_CAP}`,
    [userId],
  );
  const shared = await db.query<DocRow>(
    `SELECT d.id, d.user_id, d.name, d.counterparty, d.status, d.updated_at, u.name AS shared_by
     FROM documents d JOIN users u ON u.id = d.user_id
     WHERE d.team_shared AND d.deleted_at IS NULL AND d.user_id <> $1
       AND d.user_id IN (SELECT owner_user_id FROM team_members WHERE member_user_id = $1 AND status = 'active')
     ORDER BY d.updated_at DESC LIMIT ${SHARED_CAP}`,
    [userId],
  );
  const docs = [...own.rows, ...shared.rows];
  const out: MemoryDoc[] = [];

  const BATCH = 10;
  for (let i = 0; i < docs.length; i += BATCH) {
    if (i > 0) await new Promise<void>((r) => setImmediate(r)); // не держим event loop
    const slice = docs.slice(i, i + BATCH);
    const analyses = await db.query<{ document_id: string; user_id: string; summary: string; document_blocks: unknown; upload_id: string | null }>(
      `SELECT DISTINCT ON (document_id) document_id, user_id, summary, document_blocks, upload_id
       FROM analyses WHERE document_id = ANY($1::text[])
       ORDER BY document_id, created_at DESC`,
      [slice.map((d) => d.id)],
    );
    const byDoc = new Map(analyses.rows.map((a) => [a.document_id, a]));
    // Исходные файлы пачки — одним запросом (не по запросу на документ).
    const uploadIds = analyses.rows.map((a) => a.upload_id).filter((x): x is string => Boolean(x));
    const uploads = uploadIds.length
      ? await db.query<{ id: string; user_id: string; extracted_text: string | null }>(
          'SELECT id, user_id, extracted_text FROM uploads WHERE id = ANY($1::text[])',
          [uploadIds],
        )
      : { rows: [] as { id: string; user_id: string; extracted_text: string | null }[] };
    const uploadById = new Map(uploads.rows.map((u) => [u.id, u]));
    for (const d of slice) {
      const a = byDoc.get(d.id);
      // Ключ — владельца документа (у командного — не мой).
      const owner = d.user_id;
      let summary = '';
      let text = '';
      if (a && a.user_id === owner) {
        summary = (await decText(db, owner, a.summary).catch(() => null)) ?? '';
        const up = a.upload_id ? uploadById.get(a.upload_id) : undefined;
        if (up && up.user_id === owner) text = (await decText(db, owner, up.extracted_text).catch(() => null)) ?? '';
        if (!text.trim()) text = blocksToText(await decJsonFromJsonb(db, owner, a.document_blocks).catch(() => null));
      }
      out.push({
        id: d.id,
        kind: 'contract',
        name: d.name,
        counterparty: d.counterparty && d.counterparty !== '—' ? d.counterparty : '',
        status: d.status,
        updated: dateOf(d.updated_at),
        ...(d.shared_by ? { sharedBy: d.shared_by } : {}),
        summary,
        text: text.slice(0, DOC_TEXT_CAP),
      });
    }
  }

  const saved = await db.query<{ id: string; title: string; content: string; created_at: unknown }>(
    `SELECT id, title, content, created_at FROM saved_templates WHERE user_id = $1 ORDER BY created_at DESC LIMIT ${SAVED_CAP}`,
    [userId],
  );
  for (const s of saved.rows) {
    out.push({
      id: s.id,
      kind: 'saved',
      name: s.title,
      counterparty: '',
      status: 'Saved',
      updated: dateOf(s.created_at),
      summary: '',
      text: ((await decText(db, userId, s.content).catch(() => null)) ?? '').slice(0, DOC_TEXT_CAP),
    });
  }
  return out;
}

/* ── поиск ─────────────────────────────────────────────────────────────── */

/** Основы слов: русская морфология режется до 6 букв («неустойки» → «неусто»). */
export function stemsOf(q: string): string[] {
  const words = q.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? [];
  return [...new Set(words.map((w) => (w.length > 6 ? w.slice(0, 6) : w)))].slice(0, 12);
}

export interface Passage {
  start: number;
  end: number;
  text: string;
  score: number;
}

/** Текст → куски по ~800 символов по границам строк, с оценкой по основам. */
export function scorePassages(text: string, stems: string[]): Passage[] {
  const out: Passage[] = [];
  let start = 0;
  let buf = '';
  let pos = 0;
  const flush = () => {
    if (!buf.trim()) return;
    const low = buf.toLowerCase();
    out.push({ start, end: start + buf.length, text: buf, score: stems.reduce((s, w) => s + (low.split(w).length - 1), 0) });
  };
  for (const line of text.split('\n')) {
    if (buf && buf.length + line.length > 800) {
      flush();
      start = pos;
      buf = '';
    }
    buf += (buf ? '\n' : '') + line;
    pos += line.length + 1;
  }
  flush();
  return out;
}

export interface MemoryHit {
  doc: MemoryDoc;
  score: number;
  passages: Passage[];
}

/** Лучшие документы по запросу: совпадение имени/контрагента весит больше текста. */
export function searchMemory(docs: MemoryDoc[], query: string, limit: number): MemoryHit[] {
  const stems = stemsOf(query);
  if (!stems.length) return [];
  const hits: MemoryHit[] = [];
  for (const doc of docs) {
    const head = `${doc.name} ${doc.counterparty}`.toLowerCase();
    const headScore = stems.filter((w) => head.includes(w)).length * 5;
    const summaryLow = doc.summary.toLowerCase();
    const summaryScore = stems.filter((w) => summaryLow.includes(w)).length * 2;
    const passages = scorePassages(doc.text, stems)
      .filter((p) => p.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 2);
    const score = headScore + summaryScore + (passages[0]?.score ?? 0) + (passages[1]?.score ?? 0) / 2;
    if (score > 0) hits.push({ doc, score, passages: passages.sort((a, b) => a.start - b.start) });
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, limit);
}

/** Шапка документа для модели. */
export function docHeader(doc: MemoryDoc): string {
  const bits = [
    doc.kind === 'saved' ? 'saved from chat' : `status ${doc.status}`,
    doc.counterparty && `counterparty ${doc.counterparty}`,
    doc.updated && `updated ${doc.updated}`,
    doc.sharedBy && `shared by ${doc.sharedBy} (team)`,
    `${doc.text.length} chars`,
  ].filter(Boolean);
  return `[${doc.id}] «${doc.name}» — ${bits.join(' · ')}`;
}
