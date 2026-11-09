/**
 * Сборщик карты связей между нормами (см. links.ts):
 *
 *   npm run rag:links -- --jurisdiction=UZ --dry-run   # только посчитать
 *   npm run rag:links -- --jurisdiction=UZ             # пересобрать в базе
 *
 * Идемпотентно: связи юрисдикции пересобираются целиком в одной транзакции
 * (DELETE + INSERT) — после переингеста закона просто запустить ещё раз.
 * Только действующие нормы (valid_to IS NULL). Внешних вызовов нет — $0.
 */
import { pathToFileURL } from 'node:url';
import { getDb, migrate, type Db } from '../db.ts';
import { LinkResolver, abbreviationFromTitle, cocitedLinks, findAbbreviations, linksFromUnit, type CorpusDoc, type Link } from './links.ts';

interface UnitRow {
  id: string;
  document_id: string;
  number: string | null;
  unit_type: string;
  text: string;
  source_url: string;
  sha256_checksum: string;
  retrieved_at: string | Date;
}

export interface BuildLinksResult {
  links: Link[];
  byKind: Record<string, number>;
  sources: number;
}

export async function buildLinks(db: Db, jurisdiction: string): Promise<BuildLinksResult & { unitsById: Map<string, UnitRow> }> {
  const docs = (
    await db.query<{ id: string; title: string; doc_type: string }>(
      `SELECT id, title, doc_type FROM legal_documents WHERE jurisdiction = $1 ORDER BY id`,
      [jurisdiction],
    )
  ).rows.map((d): CorpusDoc => ({ id: d.id, title: d.title, docType: d.doc_type }));
  const docType = new Map(docs.map((d) => [d.id, d.docType]));
  // Порциями по 10 документов: весь корпус одним запросом (11+ МБ текста) на
  // медленном канале упирался в statement_timeout 60 с.
  const units: UnitRow[] = [];
  for (let i = 0; i < docs.length; i += 10) {
    const ids = docs.slice(i, i + 10).map((d) => d.id);
    const part = await db.query<UnitRow>(
      `SELECT u.id, u.document_id, u.number, u.unit_type, u.text, u.source_url, u.sha256_checksum, u.retrieved_at
       FROM legal_units u
       WHERE u.document_id = ANY($1::text[]) AND u.valid_to IS NULL
       ORDER BY u.document_id, u.ord, u.id`,
      [ids],
    );
    units.push(...part.rows);
  }
  // Цель — только статья/пункт (unit_type 'section', как в резолвере цитат):
  // у глав и разделов свой номер («глава 11») и нет текста.
  const resolver = new LinkResolver(
    docs,
    units.filter((u) => u.unit_type === 'section' && u.text.trim() !== '').map((u) => ({ id: u.id, documentId: u.document_id, number: u.number })),
  );

  // Сокращения вводятся один раз на документ («(далее — Закон)» в п.1 Пленума).
  const fullText = new Map<string, string>();
  for (const u of units) fullText.set(u.document_id, `${fullText.get(u.document_id) ?? ''}\n${u.text}`);
  const abbreviations = new Map(
    [...fullText].map(([id, t]) => {
      const ab = findAbbreviations(t);
      // «Закон» без определения в тексте — из названия постановления (если закон один).
      const doc = docs.find((d) => d.id === id);
      const fromTitle = doc?.docType === 'plenum' ? abbreviationFromTitle(doc.title) : null;
      if (fromTitle && !ab.has('Закон')) ab.set('Закон', fromTitle);
      return [id, ab];
    }),
  );

  const links: Link[] = [];
  let sources = 0;
  for (const u of units) {
    if (!u.text.trim()) continue;
    const source = { id: u.id, documentId: u.document_id, docType: docType.get(u.document_id) ?? 'act', text: u.text };
    const own = linksFromUnit(source, resolver, abbreviations.get(u.document_id) ?? new Map(), jurisdiction);
    if (!own.length) continue;
    sources++;
    links.push(...own);
    if (source.docType === 'plenum') links.push(...cocitedLinks(source, own));
  }
  // Дубли (from, to, kind) — оставляем первое основание.
  const unique = new Map<string, Link>();
  for (const l of links) {
    const key = `${l.from}|${l.to}|${l.kind}`;
    if (!unique.has(key)) unique.set(key, l);
  }
  const out = [...unique.values()];
  const byKind: Record<string, number> = {};
  for (const l of out) byKind[l.kind] = (byKind[l.kind] ?? 0) + 1;
  return { links: out, byKind, sources, unitsById: new Map(units.map((u) => [u.id, u])) };
}

/** Записать связи: основание (provenance) — норма, в тексте которой стоит
 *  ссылка (для cocited — пункт Пленума): её source_url, sha256 и retrieved_at. */
export async function writeLinks(db: Db, jurisdiction: string, links: Link[], unitsById: Map<string, { source_url: string; sha256_checksum: string; retrieved_at: string | Date }>): Promise<void> {
  await db.withTx(async (tx) => {
    await tx.query(`DELETE FROM legal_links WHERE jurisdiction = $1`, [jurisdiction]);
    for (let i = 0; i < links.length; i += 1000) {
      const batch = links.slice(i, i + 1000);
      const prov = batch.map((l) => unitsById.get(l.via ?? l.from)!);
      await tx.query(
        `INSERT INTO legal_links (from_unit_id, to_unit_id, kind, jurisdiction, quote, via_unit_id, source_url, sha256_checksum, retrieved_at)
         SELECT f, t, k, $1, q, NULLIF(v, ''), s, h, r::timestamptz
         FROM unnest($2::text[], $3::text[], $4::text[], $5::text[], $6::text[], $7::text[], $8::text[], $9::text[]) AS x(f, t, k, q, v, s, h, r)`,
        [
          jurisdiction,
          batch.map((l) => l.from),
          batch.map((l) => l.to),
          batch.map((l) => l.kind),
          batch.map((l) => l.quote),
          batch.map((l) => l.via ?? ''),
          prov.map((p) => p.source_url),
          prov.map((p) => p.sha256_checksum),
          prov.map((p) => new Date(p.retrieved_at).toISOString()),
        ],
      );
    }
  });
}

async function main(): Promise<void> {
  const jurisdiction = (process.argv.find((a) => a.startsWith('--jurisdiction='))?.slice(15) ?? 'UZ').toUpperCase();
  const dryRun = process.argv.includes('--dry-run');
  const db = await getDb();
  if (!dryRun) await migrate(db);
  const t0 = Date.now();
  const { links, byKind, sources, unitsById } = await buildLinks(db, jurisdiction);
  console.log(`[links] ${jurisdiction}: ${links.length} связей от ${sources} норм-источников`, byKind, `${Math.round((Date.now() - t0) / 1000)} с`);
  if (dryRun) console.log('[links] --dry-run: в базу ничего не записано');
  else {
    await writeLinks(db, jurisdiction, links, unitsById);
    const n = await db.query<{ n: string }>(`SELECT count(*) AS n FROM legal_links WHERE jurisdiction = $1`, [jurisdiction]);
    console.log(`[links] записано: ${n.rows[0].n}`);
  }
  await db.close();
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) void main();
