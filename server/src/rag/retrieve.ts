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
  UZ: 'Перепиши вопрос пользователя как 2-3 коротких поисковых запроса по русскоязычным текстам законов Узбекистана: используй термины законодателя («неустойка», «расторжение договора», «ненадлежащее исполнение обязательства»). Вопрос может быть задан на узбекском или английском — запросы всё равно пиши ТОЛЬКО по-русски, переводя понятия в русские термины законодателя (neustoyka/penya → «неустойка», shartnomani bekor qilish → «расторжение договора», elektron imzo → «электронная цифровая подпись»). Если уверен в конкретной статье — включи один запрос вида «ст. 260 ГК». Только по-русски. Без преамбулы.',
  KZ: 'Перепиши вопрос пользователя как 2-3 коротких поисковых запроса по русскоязычным текстам законов Казахстана: используй термины законодателя. Только по-русски. Без преамбулы.',
  DE: 'Formuliere die Nutzerfrage als 2-3 kurze Suchanfragen gegen den deutschen Gesetzestext um: benutze die juristischen Fachbegriffe des Gesetzgebers (z. B. „Sachmangel Nacherfüllung“ für „fehlerhafte Ware zurückgeben“). Wenn der Paragraph bekannt ist, füge eine Anfrage wie „§ 433 BGB“ hinzu. Nur auf Deutsch. Kein Vorwort.',
  US: 'Rewrite the user question as 2-3 short search queries against U.S. federal statute text (United States Code): use the drafter\'s terms of art (e.g. "agreement to arbitrate valid irrevocable enforceable", "electronic signature legal effect"). When you know the citation, include one query naming it (e.g. "9 U.S.C. 2", "15 U.S.C. 7001"). English only. No preamble.',
  CA: 'Rewrite the user question as 2-3 short search queries against the Civil Code of Québec (contract/obligations law): use the code\'s terms of art (e.g. "resolution of contract debtor default", "latent defect warranty of quality sale"). When you know the article, include one query naming it (e.g. "article 1385 obligations"). English only. No preamble.',
  AE: 'Rewrite the user question as 2-3 short search queries against the UAE Civil Transactions Law (Federal Law 5/1985 — contract/obligations law): use the code\'s terms of art (e.g. "offer acceptance formation of contract", "option to rescind defect", "guarantee kafala obligation"). When you know the article, include one query naming it (e.g. "article 125 contract"). English only. No preamble.',
};

/** Corpus language → Postgres FTS regconfig. MUST mirror the `tsv` generated
 *  column CASE in the FTS migrations (015 russian, 023 german). English is the
 *  default (UK/US/CA). */
const FTS_CONFIG: Record<string, string> = { UK: 'english', UZ: 'russian', KZ: 'russian', DE: 'german', US: 'english', CA: 'english', AE: 'english' };

/** User question → 2-3 statute-flavoured search queries. Falls back to the raw query. */
export async function rewriteQuery(query: string, jurisdiction: string = 'UK'): Promise<string[]> {
  if (!config.anthropicApiKey) return [query];
  try {
    // Live request path (analysis/chat): a hung rewrite must degrade to the raw
    // query fast, not block the reply (the SDK default timeout is 10 minutes).
    const api = new Anthropic({ apiKey: config.anthropicApiKey, timeout: 5_000, maxRetries: 0 });
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
  // Queries are independent → resolve them concurrently; flat() keeps the
  // original query order, so the resulting list is deterministic.
  const perQuery = await Promise.all(
    queries.map(async (q) => {
      const unitId = await resolveCitationText(db, q, jurisdiction, asOf);
      if (!unitId) return [] as ChunkRow[];
      const res = await db.query<ChunkRow>(
        `SELECT ${CHUNK_COLS}
         FROM chunks c
         WHERE c.unit_id = $1
           AND (c.valid_from IS NULL OR c.valid_from <= $2::date)
           AND (c.valid_to   IS NULL OR c.valid_to   >= $2::date)
         LIMIT 1`,
        [unitId, asOf],
      );
      return res.rows;
    }),
  );
  return perQuery.flat();
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

  // The three list groups (citation fast-path, lexical, dense) and every query
  // inside them are independent → fetch CONCURRENTLY. This is the hottest path
  // of analysis and chat; sequentially it was up to ~20 round-trips end-to-end.
  // The push order below stays deterministic (direct → lexical per query →
  // dense per vector), so RRF scoring and tie-breaking are bit-identical.

  // Citation-style direct lookup gets its own top-priority list.
  const directP = citationFastPath(db, queries, params.jurisdiction, asOf);

  // Lexical lists per query: strict AND match first, then a relaxed OR match —
  // long rewritten queries must degrade to best-effort ranking, not to zero rows.
  const lexicalP = Promise.all(
    queries.map(async (q) => {
      const strictP = db.query<ChunkRow>(
        `SELECT ${CHUNK_COLS}, ts_rank(c.tsv, plainto_tsquery($4::regconfig, $1)) AS rank
         FROM chunks c
         WHERE ${filters} AND c.tsv @@ plainto_tsquery($4::regconfig, $1)
         ORDER BY rank DESC LIMIT 20`,
        [q, params.jurisdiction, asOf, ftsConfig],
      );
      const orQuery = q
        .split(/\s+/)
        .map((w) => w.replace(/[^\p{L}\p{N}.]/gu, ''))
        .filter((w) => w.length > 1)
        .slice(0, 10)
        .join(' OR ');
      const relaxedP = orQuery
        ? db.query<ChunkRow>(
            `SELECT ${CHUNK_COLS}, ts_rank(c.tsv, websearch_to_tsquery($4::regconfig, $1)) AS rank
             FROM chunks c
             WHERE ${filters} AND c.tsv @@ websearch_to_tsquery($4::regconfig, $1)
             ORDER BY rank DESC LIMIT 20`,
            [orQuery, params.jurisdiction, asOf, ftsConfig],
          )
        : Promise.resolve({ rows: [] as ChunkRow[] });
      const [strict, relaxed] = await Promise.all([strictP, relaxedP]);
      return { strict: strict.rows, relaxed: relaxed.rows };
    }),
  );

  // Dense lists (skipped gracefully until embeddings exist).
  const denseP: Promise<ChunkRow[][]> = (async () => {
    if (!embeddingsEnabled() || !(await hasEmbeddingColumn(db))) return [];
    try {
      const vectors = await embedTexts(queries, 'query');
      const results = await Promise.all(
        vectors.map((vec) =>
          db.query<ChunkRow>(
            `SELECT ${CHUNK_COLS}
             FROM chunks c
             WHERE ${filters} AND c.embedding IS NOT NULL
             ORDER BY c.embedding <=> $1::vector LIMIT 20`,
            [toVectorLiteral(vec), params.jurisdiction, asOf],
          ),
        ),
      );
      return results.map((r) => r.rows);
    } catch (err) {
      console.warn(`[rag] dense search skipped: ${(err as Error).message}`);
      return [];
    }
  })();

  const [direct, lexical, dense] = await Promise.all([directP, lexicalP, denseP]);
  if (direct.length) lists.push(direct);
  for (const { strict, relaxed } of lexical) {
    if (strict.length) lists.push(strict);
    if (relaxed.length) lists.push(relaxed);
  }
  for (const rows of dense) if (rows.length) lists.push(rows);

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

/* ── Русские цитаты: чистый разбор + таблицы алиасов ─────────────────────────
   JS `\b` понимает только латиницу, поэтому для «ГК»/«ТК»/«ЭПК» нужны
   юникод-границы слова через lookaround. */
const cyrWord = (abbr: string): RegExp =>
  new RegExp(`(?<![А-Яа-яЁёA-Za-z])${abbr}(?![А-Яа-яЁёA-Za-z])`, 'u');

interface RuAlias {
  re: RegExp;
  pattern: string; // title ILIKE pattern
}

/** Порядок важен: первый сработавший алиас выигрывает; специфичное — выше
 *  (ипотека раньше залога: «залог недвижимости (ипотека)»). KZ намеренно
 *  сохраняет прежнее поведение (только развёрнутое «Гражданск…» — прежний
 *  `\bГК\b` на кириллице никогда не срабатывал); расширение KZ-таблицы —
 *  только вместе с прогоном KZ-eval. */
const RU_ALIASES: Record<string, RuAlias[]> = {
  UZ: [
    { re: /Гражданск/i, pattern: 'Гражданский кодекс%' },
    { re: cyrWord('ГК'), pattern: 'Гражданский кодекс%' },
    { re: /Трудов/i, pattern: '%Трудовой кодекс%' },
    { re: cyrWord('ТК'), pattern: '%Трудовой кодекс%' },
    { re: /(?:Экономическ|Хозяйственн)\S*\s+процессуальн/i, pattern: '%Экономический процессуальный кодекс%' },
    { re: cyrWord('ЭПК'), pattern: '%Экономический процессуальный кодекс%' },
    { re: /ипотек/i, pattern: '%Об ипотеке%' },
    { re: /залог/i, pattern: '%О залоге%' },
    { re: /обществ\S*\s+с\s+ограниченной/i, pattern: '%с ограниченной ответственностью%' },
    { re: cyrWord('ООО'), pattern: '%с ограниченной ответственностью%' },
    { re: /акционерн/i, pattern: '%Об акционерных обществах%' },
    { re: cyrWord('АО'), pattern: '%Об акционерных обществах%' },
    { re: /аренд/i, pattern: '%Об аренде%' },
    { re: /потребител/i, pattern: '%О защите прав потребителей%' },
    { re: /ЗоЗПП/i, pattern: '%О защите прав потребителей%' },
    { re: /электронн\S*\s+цифров\S*\s+подпис/i, pattern: '%Об электронной цифровой подписи%' },
    { re: cyrWord('ЭЦП'), pattern: '%Об электронной цифровой подписи%' },
    { re: /договорно-правов/i, pattern: '%О договорно-правовой базе%' },
    // Узбекские (латиница) формы: Fuqarolik kodeksi (FK), Mehnat kodeksi.
    { re: /fuqarolik\s+kodeks/i, pattern: 'Гражданский кодекс%' },
    { re: /(?<![A-Za-zА-Яа-я])FK(?:ning)?(?![A-Za-zА-Яа-я])/, pattern: 'Гражданский кодекс%' },
    { re: /mehnat\s+kodeks/i, pattern: '%Трудовой кодекс%' },
    // Узбекская КИРИЛЛИЦА: на узбекоязычном договоре модель цитирует
    // «Фуқаролик Кодексининг 260-моддаси» (живой кейс). «кодекс» сразу после
    // названия — обязателен: иначе «Фуқаролик процессуал кодекси» (ГПК, вне
    // корпуса) ложно резолвился бы в ГК.
    { re: /фу[қк]аролик\s+кодекс/i, pattern: 'Гражданский кодекс%' },
    { re: /ме[ҳх]нат\s+кодекс/i, pattern: '%Трудовой кодекс%' },
    { re: /соли[қк]\s+кодекс/i, pattern: '%Налоговый кодекс%' },
    { re: /ер\s+кодекс/i, pattern: '%Земельный кодекс%' },
    { re: /и[қк]тисодий\s+процессуал/i, pattern: '%Экономический процессуальный кодекс%' },
    { re: /гаров/i, pattern: '%О залоге%' },
    { re: /ижара/i, pattern: '%Об аренде%' },
    { re: /истеъмолчи/i, pattern: '%О защите прав потребителей%' },
    { re: /масъулияти\s+чекланган/i, pattern: '%с ограниченной ответственностью%' },
    { re: /акциядорлик/i, pattern: '%Об акционерных обществах%' },
    { re: /электрон\s+ра[қк]амли\s+имзо/i, pattern: '%Об электронной цифровой подписи%' },
  ],
  KZ: [
    { re: /Гражданск/i, pattern: 'Гражданский кодекс%' },
    { re: cyrWord('ГК'), pattern: 'Гражданский кодекс%' },
    // Казахские формы: Азаматтық кодекс (АК) = Гражданский кодекс.
    { re: /Азаматты[қк]/i, pattern: 'Гражданский кодекс%' },
    { re: cyrWord('АК'), pattern: 'Гражданский кодекс%' },
    { re: /потребител/i, pattern: '%О защите прав потребителей%' },
    { re: /тұтынушы/i, pattern: '%О защите прав потребителей%' },
    { re: /электронн\S*\s+цифров\S*\s+подпис/i, pattern: '%электронной цифровой подписи%' },
    { re: /электронды[қк]\S*\s+цифрлы[қк]/i, pattern: '%электронной цифровой подписи%' },
    { re: cyrWord('ЭЦП'), pattern: '%электронной цифровой подписи%' },
  ],
};

export interface RuCitation {
  number: string;
  titlePattern: string;
}

/** Разбор русской цитаты: «ст. 260 ГК», «статья 130 Трудового кодекса»,
 *  «ст. 36 Закона "Об ипотеке"». Кавычки — высший приоритет; ни один алиас
 *  не совпал → null (fail-closed). Чистая функция — покрыта юнит-тестами
 *  (server/test/citations.test.ts). */
export function parseRuCitation(citation: string, jurisdiction: string): RuCitation | null {
  // Номер статьи: русская форма «ст. 260», казахская «260-бап», узбекская
  // «260-modda(si)» и кириллицей «260-модда(си/сида)».
  const st =
    citation.match(/ст(?:атья|атьи|\.)?\s*№?\s*(\d+(?:[.-]\d+)*)/i) ??
    citation.match(/(\d+(?:[.-]\d+)*)\s*-\s*(?:бап|бабы|баптың|modda(?:si)?|модда(?:си(?:да)?)?)/i);
  if (!st) return null;
  const number = st[1];
  const quoted = citation.match(/«([^»]{4,80})»|"([^"]{4,80})"/);
  if (quoted) return { number, titlePattern: `%${(quoted[1] || quoted[2]).trim()}%` };
  for (const alias of RU_ALIASES[jurisdiction] ?? []) {
    if (alias.re.test(citation)) return { number, titlePattern: alias.pattern };
  }
  return null;
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
    // Left boundary keeps 'art' from matching inside "Part"/"party"/"apart".
    const art = citation.match(/(?<![A-Za-z])art(?:icle)?\.?\s*(\d+(?:\.\d+)?)/i);
    if (!art) return null;
    number = art[1];
    titlePattern = '%Civil Code of Qu%bec%';
  } else if (jurisdiction === 'AE') {
    // UAE citations: "Article 125", "Art. 246 Civil Transactions Law".
    // Left boundary keeps 'art' from matching inside "Part"/"party"/"apart".
    const art = citation.match(/(?<![A-Za-z])art(?:icle)?\.?\s*\(?(\d+)\)?/i);
    if (!art) return null;
    number = art[1];
    titlePattern = '%Civil Transactions Law%';
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
    const parsed = parseRuCitation(citation, jurisdiction);
    if (!parsed) return null;
    titlePattern = parsed.titlePattern;
    number = parsed.number;
  }

  // Deterministic pick when a title pattern matches more than one act (real at
  // scale: broad aliases like «%О залоге%» can hit several documents that both
  // carry article N). Prefer an exact title match, then the shortest (most
  // specific) title, then a stable id tiebreak — never an arbitrary LIMIT 1.
  // With a single matching act (the ГК's two continuously-numbered parts still
  // resolve by u.number) the ORDER BY is a no-op, so retrieval is unchanged.
  const unit = await db.query<{ id: string }>(
    `SELECT u.id
     FROM legal_units u
     JOIN legal_documents d ON d.id = u.document_id AND d.jurisdiction = $2 AND d.title ILIKE $1
     WHERE u.unit_type = 'section' AND u.number = $4
       AND (u.valid_from IS NULL OR u.valid_from <= $3::date)
       AND (u.valid_to   IS NULL OR u.valid_to   >= $3::date)
     ORDER BY (lower(d.title) = lower(btrim($1, '%'))) DESC, length(d.title) ASC, d.id ASC
     LIMIT 1`,
    [titlePattern, jurisdiction, asOfDate, number],
  );
  return unit.rows[0]?.id ?? null;
}

/** Map the product's free-text jurisdiction (country selector) to a corpus code. */
export function jurisdictionCode(s: string | null | undefined): 'UK' | 'UZ' | 'KZ' | 'DE' | 'US' | 'CA' | 'AE' | null {
  if (!s) return null;
  const v = s.toLowerCase();
  if (/united kingdom|\buk\b|britain|england|english law/.test(v)) return 'UK';
  if (/uzbek|узбек/.test(v)) return 'UZ';
  if (/kazakh|казах/.test(v)) return 'KZ';
  if (/german|deutschland|\bgermany\b|немец|герман/.test(v)) return 'DE';
  if (/united states|\bus\b|\busa\b|american|сша/.test(v)) return 'US';
  if (/canad|québec|quebec|канада|квебек/.test(v)) return 'CA';
  if (/\buae\b|emirat|оаэ|эмират/.test(v)) return 'AE';
  return null;
}
