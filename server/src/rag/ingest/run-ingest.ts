/**
 * Ingestion runner: loads the pilot set of UK contract-law acts from
 * legislation.gov.uk into the corpus. Idempotent (re-run changes nothing when
 * the source is unchanged — compared by sha256 of the raw XML) and
 * incremental (only re-parses acts whose XML changed).
 *
 * No partial saves: the document's checksum is written LAST — if a run dies
 * midway, the stale checksum makes the next run redo that act from scratch.
 *
 *   npm run rag:ingest                 # the whole pilot set
 *   npm run rag:ingest -- ukpga/1979/54  # specific act(s)
 */
import { getDb, migrate, type Db } from '../../db.ts';
import { newId } from '../../lib/ids.ts';
import { fetchActXml, parseActXml, type ParsedAct } from './legislation-uk.ts';

/** Pilot: acts most relevant to commercial contract review. */
export const PILOT_ACTS = [
  'ukpga/1979/54', // Sale of Goods Act 1979
  'ukpga/1977/50', // Unfair Contract Terms Act 1977
  'ukpga/2015/15', // Consumer Rights Act 2015
  'ukpga/1998/20', // Late Payment of Commercial Debts (Interest) Act 1998
  'ukpga/1996/23', // Arbitration Act 1996
  'ukpga/1999/31', // Contracts (Rights of Third Parties) Act 1999
  'ukpga/1967/7', // Misrepresentation Act 1967
  'ukpga/1980/58', // Limitation Act 1980
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function upsertAct(db: Db, act: ParsedAct, force: boolean): Promise<{ docId: string; units: number; changed: boolean }> {
  const docId = `ld_uk_${act.officialSourceId.replace(/\//g, '-')}`;
  const existing = await db.query<{ sha256_checksum: string }>(
    'SELECT sha256_checksum FROM legal_documents WHERE id = $1',
    [docId],
  );
  if (!force && existing.rows[0]?.sha256_checksum === act.sha256) {
    return { docId, units: 0, changed: false };
  }

  // 1. Document row (checksum intentionally NOT updated yet — see header).
  await db.query(
    `INSERT INTO legal_documents (id, jurisdiction, official_source_id, doc_type, title, status, source_url, retrieved_at, sha256_checksum, modified_on_source)
     VALUES ($1, 'UK', $2, 'act', $3, 'in_force', $4, $5, coalesce((SELECT sha256_checksum FROM legal_documents WHERE id = $1), 'pending'), $6)
     ON CONFLICT (jurisdiction, official_source_id)
     DO UPDATE SET title = $3, source_url = $4, retrieved_at = $5, modified_on_source = $6, updated_at = now()`,
    [docId, act.officialSourceId, act.title, act.sourceUrl, act.retrievedAt, act.modifiedOnSource],
  );

  // 2. Units: upsert by deterministic id, then drop the ones that disappeared.
  for (const u of act.units) {
    await db.query(
      `INSERT INTO legal_units (id, document_id, parent_id, unit_type, number, heading, breadcrumb, text, language, ord, valid_from, valid_to, official_unit_uri, source_url, retrieved_at, sha256_checksum)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
       ON CONFLICT (id) DO UPDATE SET
         parent_id = $3, unit_type = $4, number = $5, heading = $6, breadcrumb = $7, text = $8,
         ord = $10, valid_from = $11, valid_to = $12, official_unit_uri = $13,
         source_url = $14, retrieved_at = $15, sha256_checksum = $16`,
      [
        u.id, docId, u.parentId, u.unitType, u.number, u.heading, u.breadcrumb, u.text, u.language,
        u.ord, u.validFrom, u.validTo, u.officialUnitUri, u.sourceUrl, u.retrievedAt, u.sha256Checksum,
      ],
    );
  }
  await db.query(`DELETE FROM legal_units WHERE document_id = $1 AND NOT (id = ANY($2::text[]))`, [
    docId,
    act.units.map((u) => u.id),
  ]);

  // 3. Checksum last — commits the act as fully ingested.
  await db.query('UPDATE legal_documents SET sha256_checksum = $2, updated_at = now() WHERE id = $1', [
    docId,
    act.sha256,
  ]);
  return { docId, units: act.units.length, changed: true };
}

async function main(): Promise<void> {
  const requested = process.argv.slice(2).filter((a) => !a.startsWith('-'));
  const force = process.argv.includes('--force'); // re-parse even when the source XML is unchanged
  const acts = requested.length ? requested : PILOT_ACTS;
  const db = await getDb();
  await migrate(db);

  const runId = newId('ir');
  await db.query(`INSERT INTO ingestion_runs (id, source) VALUES ($1, 'legislation.gov.uk')`, [runId]);
  let fetched = 0, changed = 0, unchanged = 0, errors = 0;
  const detail: Record<string, unknown> = {};

  for (const officialId of acts) {
    try {
      const { xml, url } = await fetchActXml(officialId);
      fetched++;
      const act = parseActXml(officialId, xml, url);
      const res = await upsertAct(db, act, force);
      if (res.changed) changed++; else unchanged++;

      const secs = act.units.filter((u) => u.unitType === 'section');
      const subs = act.units.filter((u) => u.unitType === 'subsection');
      detail[officialId] = { title: act.title, units: act.units.length, sections: secs.length, subsections: subs.length, changed: res.changed };
      console.log(
        `[ingest] ${act.title}: ${res.changed ? `${act.units.length} units (${secs.length} sections, ${subs.length} subsections)` : 'unchanged — skipped'}`,
      );
      if (res.changed && secs.length) {
        console.log(`         e.g. ${secs[Math.floor(secs.length / 2)].breadcrumb}`);
      }
    } catch (err) {
      errors++;
      detail[officialId] = { error: (err as Error).message };
      console.error(`[ingest] ${officialId} FAILED: ${(err as Error).message}`);
    }
    await sleep(600); // politeness towards the official API
  }

  await db.query(
    `UPDATE ingestion_runs SET finished_at = now(), docs_fetched = $2, docs_changed = $3, docs_unchanged = $4, errors = $5, detail = $6 WHERE id = $1`,
    [runId, fetched, changed, unchanged, errors, JSON.stringify(detail)],
  );

  const totals = await db.query<{ docs: string; units: string; sections: string }>(
    `SELECT (SELECT count(*) FROM legal_documents) AS docs,
            (SELECT count(*) FROM legal_units) AS units,
            (SELECT count(*) FROM legal_units WHERE unit_type = 'section') AS sections`,
  );
  console.log(`\n[ingest] run ${runId}: fetched ${fetched}, changed ${changed}, unchanged ${unchanged}, errors ${errors}`);
  console.log(`[ingest] corpus now: ${totals.rows[0].docs} documents, ${totals.rows[0].units} units (${totals.rows[0].sections} sections)`);
  await db.close();
  if (errors > 0) process.exitCode = 1;
}

void main();
