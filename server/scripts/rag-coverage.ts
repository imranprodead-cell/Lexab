/**
 * RAG corpus coverage gate (Часть 2, Фаза 0 плана).
 *
 *   node --env-file-if-exists=.env scripts/rag-coverage.ts UZ
 *
 * Per legal_document of the jurisdiction, reports:
 *   sections (unit_type='section', non-empty) · chunks · sections WITHOUT a
 *   chunk · chunks with EMPTY context_summary · chunks with NULL embedding.
 * Also lints the jurisdiction's golden set: every expected_unit_id must exist
 * in legal_units (catches typos in hand-authored golden rows).
 *
 * Exit code 1 when coverage < 100% or the golden lint fails — a standing
 * policy: no eval report is quotable unless this gate exits 0 (CLAUDE.md).
 */
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDb, migrate } from '../src/db.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const jurisdiction = (process.argv[2] || 'UZ').toUpperCase();

async function main(): Promise<void> {
  const db = await getDb();
  await migrate(db);
  let failed = false;

  const docs = await db.query<{ id: string; title: string; status: string }>(
    `SELECT id, title, status FROM legal_documents WHERE jurisdiction = $1 ORDER BY id`,
    [jurisdiction],
  );
  if (docs.rows.length === 0) {
    console.error(`[coverage] no legal_documents for jurisdiction ${jurisdiction}`);
    await db.close();
    process.exit(1);
  }

  console.log(`\n=== RAG coverage · ${jurisdiction} · ${docs.rows.length} documents ===\n`);
  let totSections = 0, totChunks = 0, totNoChunk = 0, totNoContext = 0, totNoEmbedding = 0;
  let embeddingColumn = true;

  for (const doc of docs.rows) {
    const sections = await db.query<{ n: string | number }>(
      `SELECT count(*) AS n FROM legal_units WHERE document_id = $1 AND unit_type = 'section' AND text <> ''`,
      [doc.id],
    );
    const chunks = await db.query<{ n: string | number }>(`SELECT count(*) AS n FROM chunks WHERE document_id = $1`, [
      doc.id,
    ]);
    const noChunk = await db.query<{ n: string | number }>(
      `SELECT count(*) AS n FROM legal_units u
       WHERE u.document_id = $1 AND u.unit_type = 'section' AND u.text <> ''
         AND NOT EXISTS (SELECT 1 FROM chunks c WHERE c.unit_id = u.id)`,
      [doc.id],
    );
    const noContext = await db.query<{ n: string | number }>(
      `SELECT count(*) AS n FROM chunks WHERE document_id = $1 AND context_summary = ''`,
      [doc.id],
    );
    let noEmbedding = 0;
    if (embeddingColumn) {
      try {
        const r = await db.query<{ n: string | number }>(
          `SELECT count(*) AS n FROM chunks WHERE document_id = $1 AND embedding IS NULL`,
          [doc.id],
        );
        noEmbedding = Number(r.rows[0].n);
      } catch {
        embeddingColumn = false; // pgvector absent (PGlite dev) — reported below
      }
    }

    const s = Number(sections.rows[0].n);
    const c = Number(chunks.rows[0].n);
    const nc = Number(noChunk.rows[0].n);
    const nx = Number(noContext.rows[0].n);
    totSections += s;
    totChunks += c;
    totNoChunk += nc;
    totNoContext += nx;
    totNoEmbedding += noEmbedding;
    const bad = nc > 0 || nx > 0 || noEmbedding > 0;
    if (bad) failed = true;
    console.log(
      `${bad ? '✗' : '✓'} ${doc.id}  «${doc.title.slice(0, 60)}»\n` +
        `   sections=${s} chunks=${c} missing-chunk=${nc} empty-context=${nx} null-embedding=${embeddingColumn ? noEmbedding : 'n/a'}`,
    );
  }

  console.log(
    `\nTOTAL: sections=${totSections} chunks=${totChunks} missing-chunk=${totNoChunk} ` +
      `empty-context=${totNoContext} null-embedding=${embeddingColumn ? totNoEmbedding : 'COLUMN ABSENT'}`,
  );
  if (!embeddingColumn) {
    console.error('[coverage] pgvector/embedding column is absent — run against the real database for a quotable gate');
    failed = true;
  }

  /* ── Golden lint: every expected_unit_id must exist ─────────────────────── */
  const goldenFile = path.join(HERE, '..', 'evals', 'golden', `${jurisdiction.toLowerCase()}-contract-law.jsonl`);
  if (existsSync(goldenFile)) {
    const rows = readFileSync(goldenFile, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l, i) => ({ line: i + 1, row: JSON.parse(l) as { question: string; expected_unit_ids: string[] } }));
    const allIds = [...new Set(rows.flatMap((r) => r.row.expected_unit_ids))];
    const found = await db.query<{ id: string }>(`SELECT id FROM legal_units WHERE id = ANY($1::text[])`, [allIds]);
    const existing = new Set(found.rows.map((r) => r.id));
    const missing = rows.flatMap((r) =>
      r.row.expected_unit_ids.filter((id) => !existing.has(id)).map((id) => ({ line: r.line, id, q: r.row.question })),
    );
    if (missing.length) {
      failed = true;
      console.error(`\n✗ GOLDEN LINT (${path.basename(goldenFile)}): ${missing.length} expected_unit_ids do not exist:`);
      for (const m of missing) console.error(`   line ${m.line}: ${m.id}  («${m.q.slice(0, 60)}…»)`);
    } else {
      console.log(`\n✓ GOLDEN LINT: all ${allIds.length} expected_unit_ids exist (${rows.length} questions)`);
    }
  } else {
    console.log(`\n(no golden file for ${jurisdiction} — lint skipped)`);
  }

  await db.close();
  if (failed) {
    console.error('\n[coverage] INCOMPLETE — fix coverage before quoting any eval report.');
    process.exit(1);
  }
  console.log('\n[coverage] 100% — eval reports are quotable.');
}

void main();
