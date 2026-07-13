/**
 * Index builder (Этап 3): section units → retrieval chunks.
 *
 *  1. Contextual chunking: every chunk gets 1–2 sentences of AI-generated
 *     context (which norm, from which act, what it governs) — Haiku,
 *     structured output. Chunk body is the WHOLE section (never split).
 *  2. Embeddings backfill (when VOYAGE_API_KEY is present).
 *
 * Incremental: only sections whose unit checksum differs from the stored
 * chunk checksum are (re)built — safe to re-run any time.
 *
 *   npm run rag:index          # chunks + context + embeddings
 *   npm run rag:embed          # embeddings only (after the key arrives)
 */
import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config.ts';
import { getDb, migrate, type Db } from '../db.ts';
import { EMBEDDING_MODEL, embeddingsEnabled, embedTexts, toVectorLiteral } from './embeddings.ts';

const CONTEXT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['context'],
  properties: {
    context: {
      type: 'string',
      description: '1-2 plain sentences: what this provision is, from which act, and what it governs.',
    },
  },
} as const;

interface SectionRow {
  id: string;
  document_id: string;
  heading: string | null;
  breadcrumb: string;
  text: string;
  language: string;
  valid_from: string | null;
  valid_to: string | null;
  source_url: string;
  retrieved_at: string;
  sha256_checksum: string;
  jurisdiction: string;
}

async function generateContext(
  api: Anthropic,
  row: Pick<SectionRow, 'language' | 'breadcrumb' | 'heading' | 'text'>,
): Promise<string> {
  try {
    const system =
      row.language === 'ru'
        ? 'Ты аннотируешь статьи законов для юридического поискового индекса. По статье напиши 1-2 коротких предложения: из какого закона, что регулирует норма, какими терминами её будет искать юрист. По-русски, без преамбулы.'
        : row.language === 'de'
          ? 'Du annotierst Gesetzesparagraphen für einen juristischen Suchindex. Schreibe zu dem Paragraphen 1-2 kurze Sätze: aus welchem Gesetz, was die Norm regelt, mit welchen Begriffen ein Jurist danach sucht. Auf Deutsch, ohne Vorwort.'
          : 'You annotate statute sections for a legal search index. Given a section, write 1-2 short sentences situating it: which act, what the provision does, key terms a lawyer would search for. Plain English, no preamble.';
    const msg = await api.beta.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 300,
      system,
      output_config: { format: { type: 'json_schema', schema: CONTEXT_SCHEMA as unknown as Record<string, unknown> } },
      messages: [
        {
          role: 'user',
          content: `Path: ${row.breadcrumb}\nHeading: ${row.heading ?? '—'}\nText:\n${row.text.slice(0, 4000)}`,
        },
      ],
    });
    const text = msg.content.find((b) => b.type === 'text');
    const parsed = text && text.type === 'text' ? (JSON.parse(text.text) as { context: string }) : null;
    return parsed?.context?.trim() ?? '';
  } catch (err) {
    console.warn(`[index] context generation failed for ${row.breadcrumb}: ${(err as Error).message}`);
    return ''; // chunk still enters the index — context is an enhancement
  }
}

async function buildChunks(db: Db, docsFilter: string[] | null, maxAnnotate: number): Promise<{ built: number; annotated: number }> {
  const stale = await db.query<SectionRow>(
    `SELECT u.id, u.document_id, u.heading, u.breadcrumb, u.text, u.language,
            u.valid_from, u.valid_to, u.source_url, u.retrieved_at, u.sha256_checksum,
            d.jurisdiction
     FROM legal_units u
     JOIN legal_documents d ON d.id = u.document_id
     LEFT JOIN chunks c ON c.unit_id = u.id
     WHERE u.unit_type = 'section' AND u.text <> ''
       AND (c.id IS NULL OR c.sha256_checksum <> u.sha256_checksum)
       AND ($1::text[] IS NULL OR u.document_id = ANY($1))
     ORDER BY u.document_id, u.ord`,
    [docsFilter],
  );
  if (!stale.rows.length) {
    console.log('[index] chunks up to date');
    return { built: 0, annotated: 0 };
  }
  console.log(`[index] building ${stale.rows.length} chunks (whole-section; AI context for up to ${maxAnnotate})…`);
  const api = config.anthropicApiKey ? new Anthropic({ apiKey: config.anthropicApiKey }) : null;

  let built = 0;
  let annotated = 0;
  const CONCURRENCY = 6;
  for (let i = 0; i < stale.rows.length; i += CONCURRENCY) {
    const batch = stale.rows.slice(i, i + CONCURRENCY);
    await Promise.all(
      batch.map(async (row) => {
        // Budget cap: sections beyond the cap enter the index without an AI
        // annotation (still searchable; re-run later to enrich them).
        const context = api && annotated < maxAnnotate ? (annotated++, await generateContext(api, row)) : '';
        await db.query(
          `INSERT INTO chunks (id, unit_id, document_id, jurisdiction, language, source_type, breadcrumb, context_summary, body, valid_from, valid_to, source_url, retrieved_at, sha256_checksum)
           VALUES ($1, $2, $3, $4, $5, 'legislation', $6, $7, $8, $9, $10, $11, $12, $13)
           ON CONFLICT (unit_id) DO UPDATE SET
             breadcrumb = $6, context_summary = $7, body = $8, valid_from = $9, valid_to = $10,
             source_url = $11, retrieved_at = $12, sha256_checksum = $13, embedding = NULL`,
          [
            `ch_${row.id}`, row.id, row.document_id, row.jurisdiction, row.language,
            row.breadcrumb, context, row.text, row.valid_from, row.valid_to,
            row.source_url, row.retrieved_at, row.sha256_checksum,
          ],
        );
        built++;
      }),
    );
    if ((i / CONCURRENCY) % 10 === 0) console.log(`[index] ${Math.min(i + CONCURRENCY, stale.rows.length)}/${stale.rows.length}`);
  }
  return { built, annotated };
}

/** Enrichment pass: chunks that entered the index without an AI annotation
 *  (over the --max-annotate budget of an earlier run) get one now. The
 *  embedding is reset so the enriched text is re-vectorised. */
async function enrichChunks(db: Db, docsFilter: string[] | null, maxAnnotate: number): Promise<{ enriched: number }> {
  const api = config.anthropicApiKey ? new Anthropic({ apiKey: config.anthropicApiKey }) : null;
  if (!api || maxAnnotate <= 0) return { enriched: 0 };
  const rows = await db.query<{ id: string; breadcrumb: string; text: string; language: string; heading: string | null }>(
    `SELECT c.id, c.breadcrumb, c.body AS text, c.language, u.heading
     FROM chunks c JOIN legal_units u ON u.id = c.unit_id
     WHERE c.context_summary = '' AND ($1::text[] IS NULL OR c.document_id = ANY($1))
     ORDER BY c.document_id LIMIT $2`,
    [docsFilter, maxAnnotate],
  );
  if (!rows.rows.length) return { enriched: 0 };
  console.log(`[index] enriching ${rows.rows.length} chunks with AI context…`);
  let enriched = 0;
  const CONCURRENCY = 6;
  for (let i = 0; i < rows.rows.length; i += CONCURRENCY) {
    const batch = rows.rows.slice(i, i + CONCURRENCY);
    await Promise.all(
      batch.map(async (row) => {
        const context = await generateContext(api, row);
        if (!context) return; // failed annotation stays empty — retried next run
        await db.query('UPDATE chunks SET context_summary = $2, embedding = NULL WHERE id = $1', [row.id, context]);
        enriched++;
      }),
    );
    if ((i / CONCURRENCY) % 10 === 0) console.log(`[index] enriched ${Math.min(i + CONCURRENCY, rows.rows.length)}/${rows.rows.length}`);
  }
  return { enriched };
}

async function embedChunks(db: Db): Promise<{ embedded: number }> {
  if (!embeddingsEnabled()) {
    console.log('[index] VOYAGE_API_KEY not set — skipping embeddings (FTS-only mode). Run `npm run rag:embed` once the key is in server/.env.');
    return { embedded: 0 };
  }
  const hasColumn = await db.query<{ ok: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'chunks' AND column_name = 'embedding') AS ok`,
  );
  if (!hasColumn.rows[0]?.ok) {
    console.log('[index] no embedding column (pgvector unavailable) — skipping');
    return { embedded: 0 };
  }
  let embedded = 0;
  for (;;) {
    const rows = await db.query<{ id: string; breadcrumb: string; context_summary: string; body: string }>(
      `SELECT id, breadcrumb, context_summary, body FROM chunks WHERE embedding IS NULL ORDER BY id LIMIT 64`,
    );
    if (!rows.rows.length) break;
    const texts = rows.rows.map((r) => `${r.breadcrumb}\n${r.context_summary}\n${r.body}`.slice(0, 12_000));
    const vectors = await embedTexts(texts, 'document');
    for (let i = 0; i < rows.rows.length; i++) {
      await db.query('UPDATE chunks SET embedding = $2::vector WHERE id = $1', [
        rows.rows[i].id,
        toVectorLiteral(vectors[i]),
      ]);
    }
    embedded += rows.rows.length;
    console.log(`[index] embedded ${embedded} chunks (${EMBEDDING_MODEL})`);
  }
  return { embedded };
}

async function main(): Promise<void> {
  const embedOnly = process.argv.includes('--embed-only');
  const docsArg = process.argv.find((a) => a.startsWith('--docs='));
  const docsFilter = docsArg ? docsArg.slice(7).split(',').filter(Boolean) : null;
  const maxArg = process.argv.find((a) => a.startsWith('--max-annotate='));
  const maxAnnotate = maxArg ? Number(maxArg.slice(15)) : Number.MAX_SAFE_INTEGER;
  const db = await getDb();
  await migrate(db);
  const chunkStats = embedOnly ? { built: 0, annotated: 0 } : await buildChunks(db, docsFilter, maxAnnotate);
  const enrichStats = embedOnly ? { enriched: 0 } : await enrichChunks(db, docsFilter, maxAnnotate - chunkStats.annotated);
  const embedStats = await embedChunks(db);
  const totals = await db.query<{ chunks: string; with_context: string; with_embedding: string }>(
    `SELECT count(*) AS chunks,
            count(*) FILTER (WHERE context_summary <> '') AS with_context,
            count(*) FILTER (WHERE embedding IS NOT NULL) AS with_embedding
     FROM chunks`,
  ).catch(async () => db.query(`SELECT count(*) AS chunks, count(*) FILTER (WHERE context_summary <> '') AS with_context, 0 AS with_embedding FROM chunks`));
  console.log(
    `\n[index] done: +${chunkStats.built} chunks built, +${enrichStats.enriched} enriched, +${embedStats.embedded} embedded. Corpus: ${totals.rows[0].chunks} chunks, ${totals.rows[0].with_context} with context, ${totals.rows[0].with_embedding} with embeddings.`,
  );
  await db.close();
}

void main();
