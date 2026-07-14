/**
 * UAE ingestion runner: официальный английский перевод Гражданского кодекса ОАЭ
 * (Federal Law No. 5 of 1985, Civil Transactions Law) от Минюста ОАЭ.
 *
 * Живой офиц. портал (uaelegislation.gov.ae) закрыт Cloudflare-челленджем и не
 * качается скриптом; берём точный снимок официальной страницы из Internet
 * Archive (см. `uaelegislation-ae.ts`). Provenance указывает исходный офиц. URL.
 *
 *   npm run rag:ingest:ae                # пилот (весь ГК, 1526 статей)
 *   npm run rag:ingest:ae -- --force     # перепарсить без изменений источника
 */
import { getDb, migrate } from '../../db.ts';
import { newId } from '../../lib/ids.ts';
import { fetchUaeHtml, parseUaeHtml, type UaeConfig } from './uaelegislation-ae.ts';
import { upsertParsedDocument } from './upsert.ts';

/** Пилот ОАЭ: весь Гражданский кодекс (единый кодекс, договорное право внутри). */
export const PILOT_AE: UaeConfig = {
  code: 'civil',
  title: 'Federal Law No. 5 of 1985 (Civil Transactions Law)',
  // весь кодекс; при желании можно сузить диапазоном статей
};

async function main(): Promise<void> {
  const force = process.argv.includes('--force');
  const db = await getDb();
  await migrate(db);
  const runId = newId('ir');
  await db.query(`INSERT INTO ingestion_runs (id, source) VALUES ($1, 'uaelegislation.gov.ae (via web.archive.org)')`, [runId]);
  let fetched = 0, changed = 0, unchanged = 0, errors = 0;
  const detail: Record<string, unknown> = {};

  try {
    const { html, url } = await fetchUaeHtml();
    fetched++;
    const parsed = parseUaeHtml(PILOT_AE, html, url);
    const res = await upsertParsedDocument(db, parsed, force);
    if (res.changed) changed++; else unchanged++;
    const secs = parsed.units.filter((u) => u.unitType === 'section');
    detail[PILOT_AE.code] = { title: parsed.title, units: parsed.units.length, articles: secs.length, changed: res.changed };
    console.log(`[ingest:ae] ${parsed.title}: ${res.changed ? `${parsed.units.length} units (${secs.length} статей)` : 'unchanged — skipped'}`);
    if (res.changed && secs.length) console.log(`            e.g. ${secs[Math.floor(secs.length / 2)].breadcrumb}`);
  } catch (err) {
    errors++;
    detail[PILOT_AE.code] = { error: (err as Error).message };
    console.error(`[ingest:ae] ${PILOT_AE.code} FAILED: ${(err as Error).message}`);
  }

  await db.query(
    `UPDATE ingestion_runs SET finished_at = now(), docs_fetched = $2, docs_changed = $3, docs_unchanged = $4, errors = $5, detail = $6 WHERE id = $1`,
    [runId, fetched, changed, unchanged, errors, JSON.stringify(detail)],
  );
  const totals = await db.query<{ docs: string; units: string; sections: string }>(
    `SELECT count(*) AS docs,
            (SELECT count(*) FROM legal_units u JOIN legal_documents d ON d.id = u.document_id WHERE d.jurisdiction = 'AE') AS units,
            (SELECT count(*) FROM legal_units u JOIN legal_documents d ON d.id = u.document_id WHERE d.jurisdiction = 'AE' AND u.unit_type = 'section') AS sections
     FROM legal_documents WHERE jurisdiction = 'AE'`,
  );
  console.log(`\n[ingest:ae] run ${runId}: fetched ${fetched}, changed ${changed}, unchanged ${unchanged}, errors ${errors}`);
  console.log(`[ingest:ae] корпус AE: ${totals.rows[0].docs} документов, ${totals.rows[0].units} юнитов (${totals.rows[0].sections} статей)`);
  await db.close();
  if (errors > 0) process.exitCode = 1;
}

void main();
