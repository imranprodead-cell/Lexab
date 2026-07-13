/**
 * United States ingestion runner: официальные федеральные тексты из United
 * States Code, публикуемого GPO на govinfo.gov (per-title / per-chapter PDF).
 *
 *   npm run rag:ingest:us                 # пилот: FAA (Title 9) + E-SIGN (Title 15, гл.96)
 *   npm run rag:ingest:us -- --force      # перепарсить без изменений источника
 *
 * ЯДРО договорного права США (UCC Статья 2) — это право штатов; добавляется
 * отдельно, когда появится официальный машиночитаемый источник штата.
 */
import { createHash } from 'node:crypto';
import { getDb, migrate } from '../../db.ts';
import { extractText } from '../../extract.ts';
import { newId } from '../../lib/ids.ts';
import { fetchUscodePdf, parseUscodeText, type UscodeTitleConfig } from './govinfo-us.ts';
import { upsertParsedDocument } from './upsert.ts';

/** Пилот США: федеральные акты, релевантные договорам. pkgYear — год издания
 *  тома US Code на govinfo (текущий — 2024). */
export const PILOT_US_DOCS: UscodeTitleConfig[] = [
  {
    titleNum: 9,
    code: 'usc09',
    pkgYear: 2024,
    title: 'United States Code, Title 9 — Arbitration (Federal Arbitration Act)',
  },
  {
    titleNum: 15,
    code: 'usc15-esign',
    pkgYear: 2024,
    granule: 'chap96',
    title: 'United States Code, Title 15, Chapter 96 — Electronic Signatures in Global and National Commerce (E-SIGN)',
    sectionFilter: (n) => n >= 7001 && n <= 7031,
  },
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  const force = process.argv.includes('--force');
  const db = await getDb();
  await migrate(db);
  const runId = newId('ir');
  await db.query(`INSERT INTO ingestion_runs (id, source) VALUES ($1, 'govinfo.gov')`, [runId]);
  let fetched = 0, changed = 0, unchanged = 0, errors = 0;
  const detail: Record<string, unknown> = {};

  for (const cfg of PILOT_US_DOCS) {
    try {
      const { pdf, url } = await fetchUscodePdf(cfg);
      fetched++;
      const text = (await extractText(pdf, `${cfg.code}.pdf`)) ?? '';
      if (!text) throw new Error('empty PDF text extraction');
      const sha256 = createHash('sha256').update(pdf).digest('hex');
      const parsed = parseUscodeText(cfg, text, url, sha256);
      const upserted = await upsertParsedDocument(db, parsed, force);
      if (upserted.changed) changed++; else unchanged++;
      const secs = parsed.units.filter((u) => u.unitType === 'section');
      detail[cfg.code] = { title: parsed.title, units: parsed.units.length, sections: secs.length, changed: upserted.changed };
      console.log(`[ingest:us] ${parsed.title}: ${upserted.changed ? `${parsed.units.length} units (${secs.length} §)` : 'unchanged — skipped'}`);
      if (upserted.changed && secs.length) console.log(`            e.g. ${secs[Math.floor(secs.length / 2)].breadcrumb}`);
    } catch (err) {
      errors++;
      detail[cfg.code] = { error: (err as Error).message };
      console.error(`[ingest:us] ${cfg.code} FAILED: ${(err as Error).message}`);
    }
    await sleep(1200); // вежливость к официальному сайту
  }

  await db.query(
    `UPDATE ingestion_runs SET finished_at = now(), docs_fetched = $2, docs_changed = $3, docs_unchanged = $4, errors = $5, detail = $6 WHERE id = $1`,
    [runId, fetched, changed, unchanged, errors, JSON.stringify(detail)],
  );
  const totals = await db.query<{ docs: string; units: string; sections: string }>(
    `SELECT count(*) AS docs,
            (SELECT count(*) FROM legal_units u JOIN legal_documents d ON d.id = u.document_id WHERE d.jurisdiction = 'US') AS units,
            (SELECT count(*) FROM legal_units u JOIN legal_documents d ON d.id = u.document_id WHERE d.jurisdiction = 'US' AND u.unit_type = 'section') AS sections
     FROM legal_documents WHERE jurisdiction = 'US'`,
  );
  console.log(`\n[ingest:us] run ${runId}: fetched ${fetched}, changed ${changed}, unchanged ${unchanged}, errors ${errors}`);
  console.log(`[ingest:us] корпус US: ${totals.rows[0].docs} документов, ${totals.rows[0].units} юнитов (${totals.rows[0].sections} §)`);
  await db.close();
  if (errors > 0) process.exitCode = 1;
}

void main();
