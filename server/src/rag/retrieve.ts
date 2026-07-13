/**
 * Hybrid legal retrieval (Этап 3).
 *
 * Pipeline: query rewriting (Haiku, 2-3 legal search queries) → per query
 * BM25/tsvector + dense vectors (when embedded) with HARD SQL filters
 * (jurisdiction + redaction in force on asOfDate) → reciprocal-rank fusion →
 * cross-encoder reranker (Voyage rerank-2.5-lite, fail-open) → topK chunks
 * with full provenance.
 */
import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config.ts';
import type { Db } from '../db.ts';
import { embeddingsEnabled, embedTexts, rerankTexts, toVectorLiteral } from './embeddings.ts';
import type { RetrieveParams, RetrievedChunk } from './types.ts';

const REWRITE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['queries'],
  properties: {
    queries: {
      type: 'array',
      items: { type: 'string' },
      description: '2-3 short English legal search queries (statute terminology).',
    },
  },
} as const;

const REWRITE_SYSTEM: Record<string, string> = {
  UK: 'Rewrite the user question as 2-3 short search queries against UK statute text: use the legal terms of art a drafter would use (e.g. "implied term satisfactory quality" for "can I return faulty goods"). When you know the exact act and section, include one query naming them (e.g. "Arbitration Act 1996 section 9"). English only. No preamble.',
  UZ: 'Перепиши вопрос пользователя как 2-3 коротких поисковых запроса по русскоязычным текстам законов Узбекистана: используй термины законодателя («неустойка», «расторжение договора», «ненадлежащее исполнение обязательства»). Если уверен в конкретной статье — включи один запрос вида «ст. 260 ГК». Только по-русски. Без преамбулы.',
  KZ: 'Перепиши вопрос пользователя как 2-3 коротких поисковых запроса по русскоязычным текстам законов Казахстана: используй термины законодателя. Только по-русски. Без преамбулы.',
  DE: 'Formuliere die Nutzerfrage als 2-3 kurze Suchanfragen gegen den deutschen Gesetzestext um: benutze die juristischen Fachbegriffe des Gesetzgebers (z. B. „Sachmangel Nacherfüllung“ für „fehlerhafte Ware zurückgeben“). Wenn der Paragraph bekannt ist, füge eine Anfrage wie „§ 433 BGB“ hinzu. Nur auf Deutsch. Kein Vorwort.',
  US: 'Rewrite the user question as 2-3 short search queries against U.S. federal statute text (United States Code): use the drafter\'s terms of art (e.g. "agreement to arbitrate valid irrevocable enforceable", "electronic signature legal effect"). When you know the citation, include one query naming it (e.g. "9 U.S.C. 2", "15 U.S.C. 7001"). English only. No preamble.',
  CA: 'Rewrite the user question as 2-3 short search queries against the Civil Code of Québec (contract/obligations law): use the code\'s terms of art (e.g. "resolution of contract debtor default", "latent defect warranty of quality sale"). When you know the article, include one query naming it (e.g. "article 1385 obligations"). English only. No preamble.',
};

/** Corpus language → Postgres FTS regconfig. MUST mirror the `tsv` generated
 *  column CASE in the FTS migrations (015 russian, 023 german). English is the
 *  default (UK/US/CA). */
const FTS_CONFIG: Record<string, string> = { UK: 'english', UZ: 'russian', KZ: 'russian', DE: 'german', US: 'english', CA: 'english' };

/** User question → 2-3 statute-flavoured search queries. Falls back to the raw query. */
export async function rewriteQuery(query: string, jurisdiction: string = 'UK'): Promise<string[]> {
  if (!config.anthropicApiKey) return [query];
  try {
    const api = new Anthropic({ apiKey: config.anthropicApiKey });
    const msg = await api.beta.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 300,
      temperature: 0, // deterministic rewrites — retrieval quality must be reproducible for eval
      system: REWRITE_SYSTEM[jurisdiction] ?? REWRITE_SYSTEM.UK,
      output_config: { format: { type: 'json_schema', schema: REWRITE_SCHEMA as unknown as Record<string, unknown> } },
      messages: [{ role: 'user', content: query.slice(0, 2000) }],
    });
    const text = msg.content.find((b) => b.type === 'text');
    const parsed = text && text.type === 'text' ? (JSON.parse(text.text) as { queries: string[] }) : null;
    const queries = (parsed?.queries ?? []).filter((q) => q.trim()).slice(0, 3);
    return queries.length ? queries : [query];
  } catch {
    return [query];
  }
}

interface ChunkRow {
  id: string;
  unit_id: string;
  document_id: string;
  jurisdiction: RetrievedChunk['jurisdiction'];
  breadcrumb: string;
  context_summary: string;
  body: string;
  valid_from: string | null;
  valid_to: string | null;
  source_url: string;
}

const CHUNK_COLS = 'c.id, c.unit_id, c.document_id, c.jurisdiction, c.breadcrumb, c.context_summary, c.body, c.valid_from, c.valid_to, c.source_url';

/** Reranker slot: Voyage cross-encoder (rerank-2.5-lite) reorders the fused
 *  candidates by semantic relevance; on any failure (no key, 429, timeout)
 *  the RRF order stands — retrieval never breaks because of the reranker. */
async function rerank(query: string, candidates: RetrievedChunk[]): Promise<RetrievedChunk[]> {
  if (candidates.length < 2) return candidates;
  const docs = candidates.map((c) => `${c.breadcrumb}\n${c.contextSummary}\n${c.body}`.slice(0, 2000));
  const order = await rerankTexts(query, docs);
  if (!order || order.length !== candidates.length) return candidates;
  return order.map((i) => candidates[i]);
}

let embeddingColumnKnown: boolean | null = null;
async function hasEmbeddingColumn(db: Db): Promise<boolean> {
  if (embeddingColumnKnown === null) {
    const res = await db.query<{ ok: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'chunks' AND column_name = 'embedding') AS ok`,
    );
    embeddingColumnKnown = Boolean(res.rows[0]?.ok);
  }
  return embeddingColumnKnown;
}

/** Direct hit for citation-style queries ("Arbitration Act 1996 section 9", «ст. 260 ГК»). */
async function citationFastPath(db: Db, queries: string[], jurisdiction: string, asOf: string): Promise<ChunkRow[]> {
  const out: ChunkRow[] = [];
  for (const q of queries) {
    const unitId = await resolveCitationText(db, q, jurisdiction, asOf);
    if (!unitId) continue;
    const res = await db.query<ChunkRow>(
      `SELECT ${CHUNK_COLS}
       FROM chunks c
       WHERE c.unit_id = $1
         AND (c.valid_from IS NULL OR c.valid_from <= $2::date)
         AND (c.valid_to   IS NULL OR c.valid_to   >= $2::date)
       LIMIT 1`,
      [unitId, asOf],
    );
    out.push(...res.rows);
  }
  return out;
}

export async function retrieveLegalContext(db: Db, params: RetrieveParams): Promise<RetrievedChunk[]> {
  const asOf = params.asOfDate ?? new Date().toISOString().slice(0, 10);
  const topK = params.topK ?? 8;
  // Full-text config follows the corpus language: German stemmer for DE,
  // Russian for UZ/KZ, English for UK/US/CA. Must mirror the `tsv` CASE in the
  // FTS migrations, or lexical scoring uses the wrong stemmer.
  const ftsConfig = FTS_CONFIG[params.jurisdiction] ?? 'english';
  const rewrites = await rewriteQuery(params.query, params.jurisdiction);
  // Original question + rewrites (deduped) all participate in the search.
  const queries = [...new Set([params.query, ...rewrites])].slice(0, 4);

  const lists: ChunkRow[][] = [];
  const filters = `c.jurisdiction = $2
       AND (c.valid_from IS NULL OR c.valid_from <= $3::date)
       AND (c.valid_to   IS NULL OR c.valid_to   >= $3::date)`;

  // Citation-style direct lookup gets its own top-priority list.
  const direct = await citationFastPath(db, queries, params.jurisdiction, asOf);
  if (direct.length) lists.push(direct);

  // Lexical lists per query: strict AND match first, then a relaxed OR match —
  // long rewritten queries must degrade to best-effort ranking, not to zero rows.
  for (const q of queries) {
    const strict = await db.query<ChunkRow>(
      `SELECT ${CHUNK_COLS}, ts_rank(c.tsv, plainto_tsquery($4::regconfig, $1)) AS rank
       FROM chunks c
       WHERE ${filters} AND c.tsv @@ plainto_tsquery($4::regconfig, $1)
       ORDER BY rank DESC LIMIT 20`,
      [q, params.jurisdiction, asOf, ftsConfig],
    );
    if (strict.rows.length) lists.push(strict.rows);

    const orQuery = q
      .split(/\s+/)
      .map((w) => w.replace(/[^\p{L}\p{N}.]/gu, ''))
      .filter((w) => w.length > 1)
      .slice(0, 10)
      .join(' OR ');
    if (!orQuery) continue;
    const relaxed = await db.query<ChunkRow>(
      `SELECT ${CHUNK_COLS}, ts_rank(c.tsv, websearch_to_tsquery($4::regconfig, $1)) AS rank
       FROM chunks c
       WHERE ${filters} AND c.tsv @@ websearch_to_tsquery($4::regconfig, $1)
       ORDER BY rank DESC LIMIT 20`,
      [orQuery, params.jurisdiction, asOf, ftsConfig],
    );
    if (relaxed.rows.length) lists.push(relaxed.rows);
  }

  // Dense lists (skipped gracefully until embeddings exist).
  if (embeddingsEnabled() && (await hasEmbeddingColumn(db))) {
    try {
      const vectors = await embedTexts(queries, 'query');
      for (const vec of vectors) {
        const res = await db.query<ChunkRow>(
          `SELECT ${CHUNK_COLS}
           FROM chunks c
           WHERE ${filters} AND c.embedding IS NOT NULL
           ORDER BY c.embedding <=> $1::vector LIMIT 20`,
          [toVectorLiteral(vec), params.jurisdiction, asOf],
        );
        if (res.rows.length) lists.push(res.rows);
      }
    } catch (err) {
      console.warn(`[rag] dense search skipped: ${(err as Error).message}`);
    }
  }

  // Reciprocal-rank fusion across all lists.
  const byId = new Map<string, { row: ChunkRow; score: number }>();
  for (const list of lists) {
    list.forEach((row, rank) => {
      const entry = byId.get(row.id) ?? { row, score: 0 };
      entry.score += 1 / (60 + rank + 1);
      byId.set(row.id, entry);
    });
  }
  const fused = [...byId.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(topK * 2, topK))
    .map(({ row, score }): RetrievedChunk => ({
      chunkId: row.id,
      unitId: row.unit_id,
      documentId: row.document_id,
      jurisdiction: row.jurisdiction,
      breadcrumb: row.breadcrumb,
      contextSummary: row.context_summary,
      body: row.body,
      validFrom: row.valid_from,
      validTo: row.valid_to,
      sourceUrl: row.source_url,
      score,
    }));

  return (await rerank(params.query, fused)).slice(0, topK);
}

/** Resolve a textual citation to a unit in force.
 *  UK: "Late Payment …Act 1998, s.8"; UZ/KZ: «ст. 260 ГК», «ст. 14 Закона "О защите прав потребителей"». */
export async function resolveCitationText(
  db: Db,
  citation: string,
  jurisdiction: string = 'UK',
  asOfDate: string = new Date().toISOString().slice(0, 10),
): Promise<string | null> {
  // Bound the input before the (worst-case quadratic) citation regexes run — a
  // real citation appears near the start, so a 2 KB cap preserves detection
  // while making a crafted 20 K-char chat message harmless (event-loop ReDoS).
  citation = citation.slice(0, 2000);
  let titlePattern: string | null = null;
  let number: string | null = null;

  if (jurisdiction === 'UK') {
    const act = citation.match(/([A-Z][A-Za-z()'’,\s]*?Act\s+\d{4})/);
    const sec = citation.match(/s(?:ection)?s?\.?\s*(\d+[A-Z]?)\b/i);
    if (!act || !sec) return null;
    titlePattern = `%${act[1].replace(/\s+/g, ' ').trim()}%`;
    number = sec[1].toUpperCase();
  } else if (jurisdiction === 'US') {
    // U.S. citations: "9 U.S.C. § 2", "15 U.S.C. 7001". The number before U.S.C.
    // is the title (picks the document); the number after is the section.
    const m = citation.match(/\b(\d+)\s*U\.?\s?S\.?\s?C\.?\s*(?:§+\s*|sec(?:tion)?s?\.?\s*)?(\d+[A-Za-z]?)/i);
    if (!m) return null;
    titlePattern = `%Title ${Number(m[1])}%`;
    number = m[2];
  } else if (jurisdiction === 'CA') {
    // Québec citations: "art. 1385 CCQ", "article 1590 of the Civil Code of Québec".
    const art = citation.match(/art(?:icle)?\.?\s*(\d+(?:\.\d+)?)/i);
    if (!art) return null;
    number = art[1];
    titlePattern = '%Civil Code of Qu%bec%';
  } else if (jurisdiction === 'DE') {
    // German citations: «§ 433 BGB», «§ 312g Abs. 1 BGB». The § number is the
    // unit number; the trailing abbreviation (BGB/HGB) picks the code.
    const par = citation.match(/§\s*(\d+[a-z]*)/i);
    if (!par) return null;
    number = par[1].toLowerCase();
    // Citation gives the abbreviation (BGB/HGB); the stored title is the long
    // form — map abbreviation → title ILIKE pattern for the shared lookup.
    const abk = citation.match(/\b(BGB|HGB)\b/i)?.[1].toUpperCase();
    const byAbk: Record<string, string> = { BGB: '%Bürgerliches Gesetzbuch%', HGB: '%Handelsgesetzbuch%' };
    if (abk && byAbk[abk]) titlePattern = byAbk[abk];
    else return null;
  } else {
    const st = citation.match(/ст(?:атья|атьи|\.)?\s*№?\s*(\d+(?:[.-]\d+)*)/i);
    if (!st) return null;
    number = st[1];
    const quoted = citation.match(/«([^»]{4,80})»|"([^"]{4,80})"/);
    if (quoted) titlePattern = `%${(quoted[1] || quoted[2]).trim()}%`;
    else if (/\bГК\b|Гражданск/i.test(citation)) titlePattern = 'Гражданский кодекс%';
    if (!titlePattern) return null;
  }

  // Article numbering in the УЗ ГК is continuous across the two parts, so a
  // single (title-pattern, number) lookup is unambiguous.
  const unit = await db.query<{ id: string }>(
    `SELECT u.id
     FROM legal_units u
     JOIN legal_documents d ON d.id = u.document_id AND d.jurisdiction = $2 AND d.title ILIKE $1
     WHERE u.unit_type = 'section' AND u.number = $4
       AND (u.valid_from IS NULL OR u.valid_from <= $3::date)
       AND (u.valid_to   IS NULL OR u.valid_to   >= $3::date)
     LIMIT 1`,
    [titlePattern, jurisdiction, asOfDate, number],
  );
  return unit.rows[0]?.id ?? null;
}

/** Map the product's free-text jurisdiction (country selector) to a corpus code. */
export function jurisdictionCode(s: string | null | undefined): 'UK' | 'UZ' | 'KZ' | 'DE' | 'US' | 'CA' | null {
  if (!s) return null;
  const v = s.toLowerCase();
  if (/united kingdom|\buk\b|britain|england|english law/.test(v)) return 'UK';
  if (/uzbek|узбек/.test(v)) return 'UZ';
  if (/kazakh|казах/.test(v)) return 'KZ';
  if (/german|deutschland|\bgermany\b|немец|герман/.test(v)) return 'DE';
  if (/united states|\bus\b|\busa\b|american|сша/.test(v)) return 'US';
  if (/canad|québec|quebec|канада|квебек/.test(v)) return 'CA';
  return null;
}
