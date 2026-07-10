/**
 * Uzbekistan ingestion runner: официальные тексты с lex.uz (русская версия).
 *
 *   npm run rag:ingest:uz              # пилотный набор
 *   npm run rag:ingest:uz -- 111181    # конкретные документы
 *   npm run rag:ingest:uz -- --force   # перепарсить без изменений источника
 */
import { getDb, migrate } from '../../db.ts';
import { newId } from '../../lib/ids.ts';
import { fetchLexUzHtml, parseLexUzHtml } from './lex-uz.ts';
import { upsertParsedDocument } from './upsert.ts';

/** Пилот: договорное право РУз. */
export const PILOT_UZ_DOCS = [
  '111181', // Гражданский кодекс РУз, часть первая (1995)
  '180550', // Гражданский кодекс РУз, часть вторая (1996)
  '10872', // О договорно-правовой базе деятельности хозяйствующих субъектов (1998)
  '6234906', // Об электронной цифровой подписи (ЗРУ-793, 2022 — действующий)
  '14643', // О защите прав потребителей (1996)
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  const requested = process.argv.slice(2).filter((a) => !a.startsWith('-'));
  const force = process.argv.includes('--force');
  const docs = requested.length ? requested : PILOT_UZ_DOCS;

  const db = await getDb();
  await migrate(db);
  const runId = newId('ir');
  await db.query(`INSERT INTO ingestion_runs (id, source) VALUES ($1, 'lex.uz')`, [runId]);
  let fetched = 0, changed = 0, unchanged = 0, errors = 0;
  const detail: Record<string, unknown> = {};

  for (const docId of docs) {
    try {
      const { html, url } = await fetchLexUzHtml(docId);
      fetched++;
      const parsed = parseLexUzHtml(docId, html, url);
      const res = await upsertParsedDocument(db, parsed, force);
      if (res.changed) changed++; else unchanged++;
      const secs = parsed.units.filter((u) => u.unitType === 'section');
      detail[docId] = { title: parsed.title, units: parsed.units.length, articles: secs.length, changed: res.changed };
      console.log(`[ingest:uz] ${parsed.title}: ${res.changed ? `${parsed.units.length} units (${secs.length} статей)` : 'unchanged — skipped'}`);
      if (res.changed && secs.length) console.log(`            e.g. ${secs[Math.floor(secs.length / 2)].breadcrumb}`);
    } catch (err) {
      errors++;
      detail[docId] = { error: (err as Error).message };
      console.error(`[ingest:uz] ${docId} FAILED: ${(err as Error).message}`);
    }
    await sleep(1200); // вежливость к официальному сайту
  }

  await db.query(
    `UPDATE ingestion_runs SET finished_at = now(), docs_fetched = $2, docs_changed = $3, docs_unchanged = $4, errors = $5, detail = $6 WHERE id = $1`,
    [runId, fetched, changed, unchanged, errors, JSON.stringify(detail)],
  );
  const totals = await db.query<{ docs: string; units: string; sections: string }>(
    `SELECT count(*) AS docs,
            (SELECT count(*) FROM legal_units u JOIN legal_documents d ON d.id = u.document_id WHERE d.jurisdiction = 'UZ') AS units,
            (SELECT count(*) FROM legal_units u JOIN legal_documents d ON d.id = u.document_id WHERE d.jurisdiction = 'UZ' AND u.unit_type = 'section') AS sections
     FROM legal_documents WHERE jurisdiction = 'UZ'`,
  );
  console.log(`\n[ingest:uz] run ${runId}: fetched ${fetched}, changed ${changed}, unchanged ${unchanged}, errors ${errors}`);
  console.log(`[ingest:uz] корпус UZ: ${totals.rows[0].docs} документов, ${totals.rows[0].units} юнитов (${totals.rows[0].sections} статей)`);
  await db.close();
  if (errors > 0) process.exitCode = 1;
}

void main();
