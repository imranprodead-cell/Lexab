/**
 * Замер РАЗБОРА договора (ui-test 2026-11-15): прогоняет тестовые договоры
 * (evals/golden/analysis-fixtures.json) через настоящий путь разбора —
 * поиск норм → generateAnalysis (модель тарифа) → проверка ссылок — и меряет:
 *  - точность ссылок (доля находок с подтверждённой нормой), долю «проверить вручную»;
 *  - тему находки (есть ли, совпадает ли с угадыванием по словам — для ручного разбора);
 *  - противоречия: найдены ли заложенные пары, ложные срабатывания, дословность цитат.
 *
 * Нужен потому, что `npm run eval` не задевает ANALYSIS_SYSTEM (у него своя
 * инструкция для вопросов) — правило №5 для правки разбора проверяется здесь.
 *
 *   PG_POOL_MAX=3 RAG_VALIDATE_MODEL=deepseek-flash node --env-file=.env evals/run-analysis.ts --plan=Free --label=before
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../src/config.ts';
import { getDb } from '../src/db.ts';
import { generateAnalysis } from '../src/llm.ts';
import { jurisdictionCode, retrieveLegalContext } from '../src/rag/retrieve.ts';
import { validateFindings } from '../src/rag/validate-citations.ts';
import { topicOf } from '../../src/lib/batchTopics.ts';

interface Fixture {
  id: string;
  fileName: string;
  jurisdiction: string;
  text: string;
  /** Пары заложенных противоречий: [варианты стороны A], [варианты стороны B]. */
  contradictions: [string[], string[]][];
}

type AnyFinding = {
  severity: string;
  title: string;
  citation: string;
  unitId?: string | null;
  unverified?: boolean;
  topic?: string | null;
  conflict?: { a: string; b: string } | null;
};

const HERE = path.dirname(fileURLToPath(import.meta.url));
const arg = (name: string, dflt: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? dflt;
const plan = arg('plan', 'Free');
const label = arg('label', 'run');
const only = arg('only', '');

const norm = (s: string) => s.toLowerCase().replace(/[«»“”"]/g, '"').replace(/\s+/g, ' ').trim();

async function deepseekBalance(): Promise<number | null> {
  if (!config.deepseekApiKey) return null;
  try {
    const res = await fetch(`${config.deepseekBaseUrl.replace(/\/$/, '')}/user/balance`, { headers: { Authorization: `Bearer ${config.deepseekApiKey}` } });
    if (!res.ok) return null;
    const j = (await res.json()) as { balance_infos?: { currency: string; total_balance: string }[] };
    const usd = j.balance_infos?.find((b) => b.currency === 'USD') ?? j.balance_infos?.[0];
    return usd ? Number(usd.total_balance) : null;
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  const fixtures = (JSON.parse(readFileSync(path.join(HERE, 'golden', 'analysis-fixtures.json'), 'utf8')) as Fixture[]).filter(
    (f) => !only || only.split(',').includes(f.id),
  );
  const db = await getDb();
  const balanceBefore = await deepseekBalance();
  const warnings: string[] = [];
  const origWarn = console.warn;
  console.warn = (...a: unknown[]) => {
    warnings.push(a.map(String).join(' '));
    origWarn(...a);
  };

  const rows: Record<string, unknown>[] = [];
  let findingsTotal = 0;
  let withCitation = 0;
  let verified = 0;
  let unverified = 0;
  let withTopic = 0;
  let topicAgree = 0;
  let plantedTotal = 0;
  let plantedFound = 0;
  let conflictsTotal = 0;
  let conflictsFalse = 0;
  let conflictsNotVerbatim = 0;

  for (const fx of fixtures) {
    const corpus = jurisdictionCode(fx.jurisdiction);
    const t0 = Date.now();
    const legalContext = corpus ? await retrieveLegalContext(db, { query: fx.text.slice(0, 2500), jurisdiction: corpus, topK: 10 }).catch(() => []) : [];
    const gen = await generateAnalysis({ fileName: fx.fileName, text: fx.text, jurisdiction: fx.jurisdiction, plan, legalContext });
    const findings = (legalContext.length ? await validateFindings(db, gen.findings, undefined, corpus ?? 'UK') : gen.findings) as AnyFinding[];
    const text = norm(fx.text);

    const conflicts = findings.filter((f) => f.conflict);
    const matched = new Set<number>();
    const conflictRows = conflicts.map((f) => {
      const a = norm(f.conflict!.a);
      const b = norm(f.conflict!.b);
      const verbatim = text.includes(a) && text.includes(b) && a !== b;
      if (!verbatim) conflictsNotVerbatim += 1;
      const hit = fx.contradictions.findIndex(
        ([sa, sb]) =>
          (sa.some((n) => a.includes(norm(n))) && sb.some((n) => b.includes(norm(n)))) ||
          (sa.some((n) => b.includes(norm(n))) && sb.some((n) => a.includes(norm(n)))),
      );
      if (hit >= 0) matched.add(hit);
      else conflictsFalse += 1;
      return { title: f.title, a: f.conflict!.a, b: f.conflict!.b, verbatim, planted: hit >= 0 ? hit : null };
    });
    plantedTotal += fx.contradictions.length;
    plantedFound += matched.size;
    conflictsTotal += conflicts.length;

    const findingRows = findings.map((f) => {
      findingsTotal += 1;
      if (f.citation?.trim()) withCitation += 1;
      if (f.citation?.trim() && f.unitId && !f.unverified) verified += 1;
      if (f.unverified) unverified += 1;
      const guess = topicOf({ title: f.title, citation: f.citation });
      if (f.topic) {
        withTopic += 1;
        if (f.topic === guess) topicAgree += 1;
      }
      return { severity: f.severity, title: f.title, citation: f.citation, verified: Boolean(f.unitId && !f.unverified), topic: f.topic ?? null, keywordTopic: guess, conflict: Boolean(f.conflict) };
    });

    const row = { id: fx.id, ms: Date.now() - t0, findings: findingRows, conflicts: conflictRows, plantedFound: matched.size, planted: fx.contradictions.length };
    rows.push(row);
    console.log(`\n## ${fx.id} (${Math.round(row.ms / 1000)} с): находок ${findings.length}, противоречий ${conflicts.length}, заложено найдено ${matched.size}/${fx.contradictions.length}`);
    for (const f of findingRows) console.log(`  [${f.severity}] ${f.verified ? '✓' : '·'} ${f.topic ?? '—'}${f.topic && f.topic !== f.keywordTopic ? ` (по словам: ${f.keywordTopic})` : ''} ${f.conflict ? '⇄ ' : ''}${f.title} | ${f.citation}`);
    for (const c of conflictRows) console.log(`    ⇄ ${c.verbatim ? 'дословно' : 'НЕ ДОСЛОВНО'}${c.planted === null ? ' ЛОЖНОЕ?' : ''}: «${c.a.slice(0, 80)}» ↔ «${c.b.slice(0, 80)}»`);
  }

  const balanceAfter = await deepseekBalance();
  const summary = {
    label,
    plan,
    model: config.planModels[plan] ?? plan,
    judge: process.env.RAG_VALIDATE_MODEL || 'default',
    contracts: fixtures.length,
    findings: findingsTotal,
    citationPrecision: withCitation ? +(verified / withCitation).toFixed(3) : null,
    unverifiedShare: findingsTotal ? +(unverified / findingsTotal).toFixed(3) : null,
    topicCoverage: findingsTotal ? +(withTopic / findingsTotal).toFixed(3) : null,
    topicAgreeWithKeywords: withTopic ? +(topicAgree / withTopic).toFixed(3) : null,
    contradictionsPlanted: plantedTotal,
    contradictionsFound: plantedFound,
    contradictionRecall: plantedTotal ? +(plantedFound / plantedTotal).toFixed(3) : null,
    conflictsReported: conflictsTotal,
    conflictsNotPlanted: conflictsFalse,
    conflictsNotVerbatim,
    fallbackUsed: warnings.some((w) => w.includes('dev fallback')),
    conflictsDroppedNotVerbatim: warnings
      .map((w) => /(\d+) contradiction quote pair/.exec(w)?.[1])
      .filter(Boolean)
      .reduce((n, v) => n + Number(v), 0),
    deepseekSpentUsd: balanceBefore != null && balanceAfter != null ? +(balanceBefore - balanceAfter).toFixed(4) : null,
  };
  console.log(`\n=== ИТОГ ${label} ===\n${JSON.stringify(summary, null, 1)}`);
  const dir = path.join(HERE, 'reports');
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `analysis-${label}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  writeFileSync(file, JSON.stringify({ summary, rows, warnings }, null, 1));
  console.log(`[eval] report saved: ${file}`);
  await db.close();
}

await main();
