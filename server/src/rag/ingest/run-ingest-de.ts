/**
 * Germany ingestion runner: официальные консолидированные тексты с
 * gesetze-im-internet.de (Bundesministerium der Justiz).
 *
 *   npm run rag:ingest:de                # пилотный набор (BGB)
 *   npm run rag:ingest:de -- hgb         # конкретные законы по abbr
 *   npm run rag:ingest:de -- --force     # перепарсить без изменений источника
 */
import { getDb, migrate } from '../../db.ts';
import { newId } from '../../lib/ids.ts';
import { fetchGesetzXml, parseGesetzXml } from './gesetze-de.ts';
import { upsertParsedDocument } from './upsert.ts';

/** Пилот: договорное право Германии. BGB — ядро (обязательства §§ 241–853,
 *  заключение договора §§ 145–157, купля-продажа §§ 433–479 и т.д.). */
export const PILOT_DE_DOCS = [
  'bgb', // Bürgerliches Gesetzbuch — гражданский кодекс
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  const requested = process.argv.slice(2).filter((a) => !a.startsWith('-'));
  const force = process.argv.includes('--force');
  const docs = requested.length ? requested : PILOT_DE_DOCS;

  const db = await getDb();
  await migrate(db);
  const runId = newId('ir');
  await db.query(`INSERT INTO ingestion_runs (id, source) VALUES ($1, 'gesetze-im-internet.de')`, [runId]);
  let fetched = 0, changed = 0, unchanged = 0, errors = 0;
  const detail: Record<string, unknown> = {};

  for (const abbr of docs) {
    try {
      const { xml, url } = await fetchGesetzXml(abbr);
      fetched++;
      const parsed = parseGesetzXml(abbr, xml, url);
      const res = await upsertParsedDocument(db, parsed, force);
      if (res.changed) changed++; else unchanged++;
      const secs = parsed.units.filter((u) => u.unitType === 'section');
      detail[abbr] = { title: parsed.title, units: parsed.units.length, sections: secs.length, changed: res.changed };
      console.log(`[ingest:de] ${parsed.title}: ${res.changed ? `${parsed.units.length} units (${secs.length} §)` : 'unchanged — skipped'}`);
      if (res.changed && secs.length) console.log(`            e.g. ${secs[Math.floor(secs.length / 2)].breadcrumb}`);
    } catch (err) {
      errors++;
      detail[abbr] = { error: (err as Error).message };
      console.error(`[ingest:de] ${abbr} FAILED: ${(err as Error).message}`);
    }
    await sleep(1200); // вежливость к официальному сайту
  }

  await db.query(
    `UPDATE ingestion_runs SET finished_at = now(), docs_fetched = $2, docs_changed = $3, docs_unchanged = $4, errors = $5, detail = $6 WHERE id = $1`,
    [runId, fetched, changed, unchanged, errors, JSON.stringify(detail)],
  );
  const totals = await db.query<{ docs: string; units: string; sections: string }>(
    `SELECT count(*) AS docs,
            (SELECT count(*) FROM legal_units u JOIN legal_documents d ON d.id = u.document_id WHERE d.jurisdiction = 'DE') AS units,
            (SELECT count(*) FROM legal_units u JOIN legal_documents d ON d.id = u.document_id WHERE d.jurisdiction = 'DE' AND u.unit_type = 'section') AS sections
     FROM legal_documents WHERE jurisdiction = 'DE'`,
  );
  console.log(`\n[ingest:de] run ${runId}: fetched ${fetched}, changed ${changed}, unchanged ${unchanged}, errors ${errors}`);
  console.log(`[ingest:de] корпус DE: ${totals.rows[0].docs} документов, ${totals.rows[0].units} юнитов (${totals.rows[0].sections} §)`);
  await db.close();
  if (errors > 0) process.exitCode = 1;
}

void main();
