/**
 * Canada ingestion runner: официальные консолидированные тексты с LégisQuébec
 * (Publications Québec). Пилот — Гражданский кодекс Квебека (CCQ-1991),
 * Книга Пятая «Обязательства» (договорное право, ст. 1371–2643).
 *
 *   npm run rag:ingest:ca                # пилот (CCQ, обязательства)
 *   npm run rag:ingest:ca -- --force     # перепарсить без изменений источника
 *
 * Общее право провинций (судебные прецеденты) не входит в корпус статутов.
 */
import { getDb, migrate } from '../../db.ts';
import { newId } from '../../lib/ids.ts';
import { fetchCcqHtml, parseCcqHtml, type CcqConfig } from './legisquebec-ca.ts';
import { upsertParsedDocument } from './upsert.ts';

/** Пилот Канады: договорное право = CCQ Книга Пятая «Обязательства». */
export const PILOT_CA_DOCS: CcqConfig[] = [
  {
    docId: 'CCQ-1991',
    code: 'ccq',
    title: 'Civil Code of Québec',
    articleRange: [1371, 2643], // Book Five — Obligations (general + nominate contracts)
  },
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  const force = process.argv.includes('--force');
  const db = await getDb();
  await migrate(db);
  const runId = newId('ir');
  await db.query(`INSERT INTO ingestion_runs (id, source) VALUES ($1, 'legisquebec.gouv.qc.ca')`, [runId]);
  let fetched = 0, changed = 0, unchanged = 0, errors = 0;
  const detail: Record<string, unknown> = {};

  for (const cfg of PILOT_CA_DOCS) {
    try {
      const { html, url } = await fetchCcqHtml(cfg);
      fetched++;
      const parsed = parseCcqHtml(cfg, html, url);
      const res = await upsertParsedDocument(db, parsed, force);
      if (res.changed) changed++; else unchanged++;
      const secs = parsed.units.filter((u) => u.unitType === 'section');
      detail[cfg.code] = { title: parsed.title, units: parsed.units.length, articles: secs.length, changed: res.changed };
      console.log(`[ingest:ca] ${parsed.title}: ${res.changed ? `${parsed.units.length} units (${secs.length} статей)` : 'unchanged — skipped'}`);
      if (res.changed && secs.length) console.log(`            e.g. ${secs[Math.floor(secs.length / 2)].breadcrumb}`);
    } catch (err) {
      errors++;
      detail[cfg.code] = { error: (err as Error).message };
      console.error(`[ingest:ca] ${cfg.code} FAILED: ${(err as Error).message}`);
    }
    await sleep(1200);
  }

  await db.query(
    `UPDATE ingestion_runs SET finished_at = now(), docs_fetched = $2, docs_changed = $3, docs_unchanged = $4, errors = $5, detail = $6 WHERE id = $1`,
    [runId, fetched, changed, unchanged, errors, JSON.stringify(detail)],
  );
  const totals = await db.query<{ docs: string; units: string; sections: string }>(
    `SELECT count(*) AS docs,
            (SELECT count(*) FROM legal_units u JOIN legal_documents d ON d.id = u.document_id WHERE d.jurisdiction = 'CA') AS units,
            (SELECT count(*) FROM legal_units u JOIN legal_documents d ON d.id = u.document_id WHERE d.jurisdiction = 'CA' AND u.unit_type = 'section') AS sections
     FROM legal_documents WHERE jurisdiction = 'CA'`,
  );
  console.log(`\n[ingest:ca] run ${runId}: fetched ${fetched}, changed ${changed}, unchanged ${unchanged}, errors ${errors}`);
  console.log(`[ingest:ca] корпус CA: ${totals.rows[0].docs} документов, ${totals.rows[0].units} юнитов (${totals.rows[0].sections} статей)`);
  await db.close();
  if (errors > 0) process.exitCode = 1;
}

void main();
