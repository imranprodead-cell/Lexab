/**
 * Kazakhstan ingestion runner: официальные тексты с adilet.zan.kz (ИПС «Әділет»,
 * русская версия).
 *
 *   npm run rag:ingest:kz                    # пилотный набор
 *   npm run rag:ingest:kz -- K940001000_     # конкретные документы
 *   npm run rag:ingest:kz -- --force         # перепарсить без изменений источника
 */
import { getDb, migrate } from '../../db.ts';
import { newId } from '../../lib/ids.ts';
import { fetchAdiletHtml, parseAdiletHtml } from './adilet-kz.ts';
import { upsertParsedDocument } from './upsert.ts';

/** Пилот: договорное право РК (зеркалит узбекский набор). */
export const PILOT_KZ_DOCS = [
  'K940001000_', // Гражданский кодекс РК (Общая часть, 1994)
  'K990000409_', // Гражданский кодекс РК (Особенная часть, 1999)
  'Z100000274_', // О защите прав потребителей (№ 274-IV, 2010)
  'Z030000370_', // Об электронном документе и электронной цифровой подписи (№ 370-II, 2003)
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  const requested = process.argv.slice(2).filter((a) => !a.startsWith('-'));
  const force = process.argv.includes('--force');
  const docs = requested.length ? requested : PILOT_KZ_DOCS;

  const db = await getDb();
  await migrate(db);
  const runId = newId('ir');
  await db.query(`INSERT INTO ingestion_runs (id, source) VALUES ($1, 'adilet.zan.kz')`, [runId]);
  let fetched = 0, changed = 0, unchanged = 0, errors = 0;
  const detail: Record<string, unknown> = {};

  for (const code of docs) {
    try {
      const { html, url } = await fetchAdiletHtml(code);
      fetched++;
      const parsed = parseAdiletHtml(code, html, url);
      const res = await upsertParsedDocument(db, parsed, force);
      if (res.changed) changed++; else unchanged++;
      const secs = parsed.units.filter((u) => u.unitType === 'section');
      detail[code] = { title: parsed.title, units: parsed.units.length, articles: secs.length, changed: res.changed };
      console.log(`[ingest:kz] ${parsed.title}: ${res.changed ? `${parsed.units.length} units (${secs.length} статей)` : 'unchanged — skipped'}`);
      if (res.changed && secs.length) console.log(`            e.g. ${secs[Math.floor(secs.length / 2)].breadcrumb}`);
    } catch (err) {
      errors++;
      detail[code] = { error: (err as Error).message };
      console.error(`[ingest:kz] ${code} FAILED: ${(err as Error).message}`);
    }
    await sleep(1200); // вежливость к официальному сайту
  }

  await db.query(
    `UPDATE ingestion_runs SET finished_at = now(), docs_fetched = $2, docs_changed = $3, docs_unchanged = $4, errors = $5, detail = $6 WHERE id = $1`,
    [runId, fetched, changed, unchanged, errors, JSON.stringify(detail)],
  );
  const totals = await db.query<{ docs: string; units: string; sections: string }>(
    `SELECT count(*) AS docs,
            (SELECT count(*) FROM legal_units u JOIN legal_documents d ON d.id = u.document_id WHERE d.jurisdiction = 'KZ') AS units,
            (SELECT count(*) FROM legal_units u JOIN legal_documents d ON d.id = u.document_id WHERE d.jurisdiction = 'KZ' AND u.unit_type = 'section') AS sections
     FROM legal_documents WHERE jurisdiction = 'KZ'`,
  );
  console.log(`\n[ingest:kz] run ${runId}: fetched ${fetched}, changed ${changed}, unchanged ${unchanged}, errors ${errors}`);
  console.log(`[ingest:kz] корпус KZ: ${totals.rows[0].docs} документов, ${totals.rows[0].units} юнитов (${totals.rows[0].sections} статей)`);
  await db.close();
  if (errors > 0) process.exitCode = 1;
}

void main();
