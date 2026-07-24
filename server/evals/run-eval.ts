/**
 * Eval harness (Этап 5): runs the golden dataset through retrieval and the
 * findings pipeline, in TWO modes — WITHOUT RAG (baseline: the model cites
 * statutes from its own memory) and WITH RAG (retrieval + unit ids +
 * citation validator). This is the "how much did the AI improve" report.
 *
 * Metrics:
 *  - retrieval: hit@5 / hit@10 (expected section found), recall@10;
 *  - pipeline per mode: citation precision (share of citations that resolve
 *    to a real, in-force provision AND are confirmed to support the finding),
 *    unverified share.
 *
 *   npm run eval                       # everything (retrieval + both modes)
 *   npm run eval -- --retrieval-only
 *   npm run eval -- --model claude-opus-4-8
 *
 * RULE (also in CLAUDE.md): run this before and after ANY change to ranking,
 * prompts or the index; reports land in evals/reports/.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { config } from '../src/config.ts';
import { getDb, migrate, type Db } from '../src/db.ts';
import { extractJsonObject, isDeepSeekModel } from '../src/llm.ts';
import { resolveCitationText, retrieveLegalContext } from '../src/rag/retrieve.ts';
import { validateFindings } from '../src/rag/validate-citations.ts';
import type { Finding } from '../src/types.ts';

interface GoldenRow {
  question: string;
  expected_unit_ids: string[];
  jurisdiction: 'UK' | 'UZ' | 'KZ' | 'DE' | 'US' | 'CA' | 'AE';
  as_of_date?: string;
  notes?: string;
}

const HERE = path.dirname(fileURLToPath(import.meta.url));

const FINDINGS_SCHEMA = (withUnitId: boolean) =>
  ({
    type: 'object',
    additionalProperties: false,
    required: ['findings'],
    properties: {
      findings: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: withUnitId ? ['title', 'citation', 'unitId'] : ['title', 'citation'],
          properties: {
            title: { type: 'string', description: 'One-sentence legal conclusion.' },
            citation: { type: 'string', description: 'Statute citation, e.g. "Sale of Goods Act 1979, s.14(2)".' },
            ...(withUnitId
              ? {
                  unitId: {
                    type: 'string',
                    description: 'unit_id from LEGAL CONTEXT supporting this finding, or "" if none applies. Never invent ids.',
                  },
                }
              : {}),
          },
        },
      },
    },
  }) as unknown as Record<string, unknown>;

/* Baseline citations arrive as free text — resolved via the shared
 * resolveCitationText helper (same rule the product's validator uses). */

const ASK_SYSTEM: Record<string, string> = {
  UK: 'You are Lexab, a UK commercial lawyer. Answer the legal question as 1-3 findings, each with a precise statutory citation.',
  UZ: 'Ты Lexab, юрист по праву Республики Узбекистан. Ответь на вопрос 1-3 выводами, каждый с точной ссылкой на норму (например, «ст. 260 ГК» или «ст. 18 Закона «О защите прав потребителей»»).',
  KZ: 'Ты Lexab, юрист по праву Республики Казахстан. Ответь на вопрос 1-3 выводами, каждый с точной ссылкой на норму.',
  DE: 'Du bist Lexab, ein deutscher Wirtschaftsjurist. Beantworte die Rechtsfrage mit 1-3 Feststellungen, jede mit einer präzisen Gesetzeszitat (z. B. „§ 433 BGB“).',
  US: 'You are Lexab, a U.S. commercial lawyer. Answer the legal question as 1-3 findings, each with a precise federal statutory citation (e.g. "9 U.S.C. § 2").',
  CA: 'You are Lexab, a Québec (Canada) civil-law jurist. Answer the legal question as 1-3 findings, each with a precise citation to the Civil Code of Québec (e.g. "art. 1385 CCQ").',
  AE: 'You are Lexab, a UAE civil-law jurist. Answer the legal question as 1-3 findings, each with a precise citation to the UAE Civil Transactions Law (Federal Law 5/1985), e.g. "Article 125 Civil Transactions Law".',
};

async function askModel(
  api: Anthropic,
  model: string,
  question: string,
  contextBlock: string | null,
  jurisdiction: string,
): Promise<{ title: string; citation: string; unitId?: string }[]> {
  // DeepSeek path (same routing rule as the product, see src/llm.ts): JSON via
  // json_object mode with the schema embedded in the system prompt.
  if (isDeepSeekModel(model)) {
    if (!config.deepseekApiKey) throw new Error('DEEPSEEK_API_KEY is not set');
    // Hard per-request timeout: a stalled socket must fail (and retry), not
    // hang the whole eval for hours.
    const ds = new OpenAI({ apiKey: config.deepseekApiKey, baseURL: config.deepseekBaseUrl, timeout: 180_000, maxRetries: 2 });
    const res = await ds.chat.completions.create({
      model,
      max_tokens: 2000,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content:
            (ASK_SYSTEM[jurisdiction] ?? ASK_SYSTEM.UK) +
            (contextBlock
              ? ' Use ONLY the provisions in LEGAL CONTEXT for citations and set unitId to the id in square brackets ("" if none applies). Never invent ids.'
              : '') +
            `\nReturn ONLY one valid JSON object matching this JSON Schema — no fences, no commentary:\n${JSON.stringify(FINDINGS_SCHEMA(Boolean(contextBlock)))}`,
        },
        { role: 'user', content: contextBlock ? `${question}\n\nLEGAL CONTEXT:\n${contextBlock}` : question },
      ],
    });
    const raw = res.choices[0]?.message?.content ?? '';
    const parsed = extractJsonObject(raw) as { findings?: { title: string; citation: string; unitId?: string }[] };
    return Array.isArray(parsed.findings) ? parsed.findings : [];
  }

  const msg = await api.beta.messages.create({
    model,
    max_tokens: 2000,
    thinking: { type: 'adaptive' },
    system:
      (ASK_SYSTEM[jurisdiction] ?? ASK_SYSTEM.UK) +
      (contextBlock
        ? ' Use ONLY the provisions in LEGAL CONTEXT for citations and set unitId to the id in square brackets ("" if none applies). Never invent ids.'
        : ''),
    output_config: { format: { type: 'json_schema', schema: FINDINGS_SCHEMA(Boolean(contextBlock)) } },
    messages: [{ role: 'user', content: contextBlock ? `${question}\n\nLEGAL CONTEXT:\n${contextBlock}` : question }],
  });
  const text = msg.content.find((b) => b.type === 'text');
  if (!text || text.type !== 'text') return [];
  return (JSON.parse(text.text) as { findings: { title: string; citation: string; unitId?: string }[] }).findings ?? [];
}

async function main(): Promise<void> {
  const retrievalOnly = process.argv.includes('--retrieval-only');
  const modelFlag = process.argv.indexOf('--model');
  const model = modelFlag > -1 ? process.argv[modelFlag + 1] : 'claude-sonnet-5';
  const goldenArg = process.argv.find((a) => a.startsWith('--golden='));
  const goldenFile = goldenArg ? goldenArg.slice(9) : 'uk-contract-law.jsonl';
  // --limit N: only the first N golden questions (cheap paid-model sampling —
  // used to keep the Anthropic budget in check per the RAG rollout plan).
  const limitIdx = process.argv.indexOf('--limit');
  const limit = limitIdx > -1 ? Math.max(1, Number(process.argv[limitIdx + 1])) : Infinity;

  const rows: GoldenRow[] = readFileSync(path.join(HERE, 'golden', goldenFile), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as GoldenRow)
    .slice(0, limit);

  const db = await getDb();
  await migrate(db);
  const api = new Anthropic({ apiKey: config.anthropicApiKey });
  const report: Record<string, unknown> = { at: new Date().toISOString(), model, golden: goldenFile, questions: rows.length };

  /* ── Retrieval metrics ─────────────────────────────────────────────────── */
  let hit5 = 0, hit10 = 0, recallSum = 0;
  const retrieved = new Map<string, Awaited<ReturnType<typeof retrieveLegalContext>>>();
  // Per-question misses land in the report so a regression is traceable to the
  // exact question (indispensable once the golden set is 40+ rows).
  const misses: { question: string; expected_unit_ids: string[]; top10_unit_ids: string[] }[] = [];
  for (const row of rows) {
    const hits = await retrieveLegalContext(db, { query: row.question, jurisdiction: row.jurisdiction, asOfDate: row.as_of_date, topK: 10 });
    retrieved.set(row.question, hits);
    const ids5 = new Set(hits.slice(0, 5).map((h) => h.unitId));
    const ids10 = new Set(hits.map((h) => h.unitId));
    if (row.expected_unit_ids.some((id) => ids5.has(id))) hit5++;
    if (row.expected_unit_ids.some((id) => ids10.has(id))) hit10++;
    else misses.push({ question: row.question, expected_unit_ids: row.expected_unit_ids, top10_unit_ids: hits.map((h) => h.unitId) });
    recallSum += row.expected_unit_ids.filter((id) => ids10.has(id)).length / row.expected_unit_ids.length;
  }
  const retrieval = {
    'hit@5': +(hit5 / rows.length).toFixed(3),
    'hit@10': +(hit10 / rows.length).toFixed(3),
    'recall@10': +(recallSum / rows.length).toFixed(3),
  };
  report.retrieval = retrieval;
  if (misses.length) report.misses = misses;
  console.log('\n=== RETRIEVAL ===', JSON.stringify(retrieval));
  for (const m of misses) console.log(`  MISS: «${m.question.slice(0, 70)}» expected ${m.expected_unit_ids.join(',')}`);

  /* ── Corpus self-description: which index produced these numbers ─────────── */
  const evalJurisdiction = rows[0]?.jurisdiction;
  if (evalJurisdiction) {
    try {
      const docsQ = await db.query<{ n: string | number }>(
        `SELECT count(*) AS n FROM legal_documents WHERE jurisdiction = $1`,
        [evalJurisdiction],
      );
      const chunksQ = await db.query<{ total: string | number; no_context: string | number }>(
        `SELECT count(*) AS total, count(*) FILTER (WHERE context_summary = '') AS no_context
         FROM chunks WHERE jurisdiction = $1`,
        [evalJurisdiction],
      );
      let embedded: number | null = null;
      try {
        const e = await db.query<{ n: string | number }>(
          `SELECT count(*) AS n FROM chunks WHERE jurisdiction = $1 AND embedding IS NOT NULL`,
          [evalJurisdiction],
        );
        embedded = Number(e.rows[0].n);
      } catch {
        /* pgvector absent (dev) */
      }
      const total = Number(chunksQ.rows[0].total);
      report.corpus = {
        jurisdiction: evalJurisdiction,
        documents: Number(docsQ.rows[0].n),
        chunks: total,
        contextCoverage: total ? +((total - Number(chunksQ.rows[0].no_context)) / total).toFixed(3) : 0,
        embeddingCoverage: embedded === null ? 'n/a' : total ? +(embedded / total).toFixed(3) : 0,
      };
      console.log('=== CORPUS ===', JSON.stringify(report.corpus));
    } catch {
      /* corpus block is best-effort — never fails an eval run */
    }
  }

  /* ── Pipeline: baseline (no RAG) vs RAG ─────────────────────────────────── */
  if (!retrievalOnly) {
    for (const mode of ['baseline', 'rag'] as const) {
      let citations = 0, verified = 0, findingsTotal = 0;
      for (const row of rows) {
        const hits = mode === 'rag' ? retrieved.get(row.question)! : [];
        const contextBlock =
          mode === 'rag'
            ? hits.map((h) => `[${h.unitId}] ${h.breadcrumb}\n${h.body.slice(0, 900)}`).join('\n---\n')
            : null;
        const findings = await askModel(api, model, row.question, contextBlock, row.jurisdiction).catch(() => []);
        findingsTotal += findings.length;

        // Resolve citations to unit ids: direct in RAG mode, by text in baseline.
        const withIds: Omit<Finding, 'id'>[] = [];
        for (const f of findings) {
          citations++;
          const unitId = mode === 'rag' ? f.unitId?.trim() || null : await resolveCitationText(db, f.citation, row.jurisdiction, row.as_of_date);
          withIds.push({ severity: 'Medium', title: f.title, citation: f.citation, unitId });
        }
        const validated = await validateFindings(db, withIds, row.as_of_date, row.jurisdiction);
        verified += validated.filter((f) => !f.unverified).length;
      }
      const stats = {
        findings: findingsTotal,
        citationPrecision: citations ? +(verified / citations).toFixed(3) : 0,
        unverifiedShare: citations ? +(1 - verified / citations).toFixed(3) : 1,
      };
      report[mode] = stats;
      console.log(`=== PIPELINE ${mode.toUpperCase()} (${model}) ===`, JSON.stringify(stats));
    }
    const b = report.baseline as { citationPrecision: number };
    const r = report.rag as { citationPrecision: number };
    console.log(
      `=== ИТОГ: точность цитат ${(b.citationPrecision * 100).toFixed(1)}% → ${(r.citationPrecision * 100).toFixed(1)}% (${r.citationPrecision >= b.citationPrecision ? '+' : ''}${((r.citationPrecision - b.citationPrecision) * 100).toFixed(1)} п.п.) ===`,
    );
  }

  const dir = path.join(HERE, 'reports');
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `eval-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  writeFileSync(file, JSON.stringify(report, null, 2));
  console.log(`\n[eval] report saved: ${file}`);
  await db.close();
}

void main();
