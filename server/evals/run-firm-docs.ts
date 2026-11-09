/**
 * Проверка «памяти фирмы» и графа документов (этап 4, 2026-11-09). Как в
 * эксперименте Harvey с context graph: агент отвечает о ТЕКУЩИХ условиях
 * договоров, а правильный ответ — только с учётом допсоглашений, приложений и
 * версий. Своя ВРЕМЕННАЯ локальная база (PGlite) — рабочую не трогает (иначе
 * скрипт отказывается работать): тестовый пользователь + вымышленные документы
 * (golden/firm-docs.fixture.json); вопросы — golden/firm-docs.jsonl, проверка
 * кодом (facts). DOC_GRAPH=off — без графа.
 *
 *   node --env-file=.env evals/run-firm-docs.ts --plan=Free
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// До импорта базы: только временная локальная PGlite, никогда не рабочая.
process.env.DATABASE_URL = '';
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lexab-firm-docs-'));
process.env.SEED_DEMO_DATA = 'false';

const { getDb, migrate } = await import('../src/db.ts');
const { generateChatReply, usesChatAgent } = await import('../src/llm.ts');
const { CHAT_AGENT_INSTRUCTIONS, createChatToolRunner } = await import('../src/lib/chatTools.ts');
const { encJsonForJsonb, encText } = await import('../src/lib/docCrypto.ts');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const USER = 'u_firm_eval';

interface FixtureDoc {
  id: string;
  name: string;
  counterparty: string;
  status: string;
  text: string;
}
interface Row {
  question: string;
  facts: string[];
  notes?: string;
}

async function main(): Promise<void> {
  const plan = arg('plan') ?? 'Free';
  if (!usesChatAgent(plan)) throw new Error(`агент чата для тарифа ${plan} выключен или нет ключа модели`);
  const db = await getDb();
  if (db.kind !== 'pglite') throw new Error('отказ: это не временная локальная база');
  await migrate(db);

  const fixture = JSON.parse(fs.readFileSync(path.join(HERE, 'golden', 'firm-docs.fixture.json'), 'utf8')) as { documents: FixtureDoc[] };
  await db.query(`INSERT INTO users (id, email, password_hash, name, initials) VALUES ($1, 'firm-eval@test.local', 'x', 'Firm Eval', 'FE')`, [USER]);
  for (const [i, d] of fixture.documents.entries()) {
    await db.query(
      `INSERT INTO documents (id, user_id, name, counterparty, status, risk, jurisdiction, updated_at) VALUES ($1, $2, $3, $4, $5, 'Low', 'UZ', now() - ($6 || ' minutes')::interval)`,
      [d.id, USER, d.name, d.counterparty, d.status, String(i)],
    );
    const blocks = d.text.split('\n').map((text, k) => ({ id: `b${k}`, text }));
    await db.query(
      `INSERT INTO analyses (id, user_id, document_id, file_name, file_size, summary, risk_score, risk_level, clauses_reviewed, document_blocks)
       VALUES ($1, $2, $3, $4, '1 KB', $5, 0, 'Low', 0, $6::jsonb)`,
      [`an_${d.id}`, USER, d.id, d.name, await encText(db, USER, ''), await encJsonForJsonb(db, USER, blocks)],
    );
  }

  const rows = fs
    .readFileSync(path.join(HERE, 'golden', 'firm-docs.jsonl'), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Row);
  const results: Record<string, unknown>[] = [];
  let passed = 0, factsOk = 0, factsAll = 0, errors = 0;
  for (const [i, row] of rows.entries()) {
    const t0 = Date.now();
    let reply = '';
    let error: string | undefined;
    try {
      const runner = createChatToolRunner({
        db,
        userId: USER,
        plan,
        jurisdiction: 'UZ',
        documents: [],
        toRefs: async (units) => units.map((u) => ({ label: u.unitId, doc: u.breadcrumb })),
      });
      reply = await generateChatReply([], row.question, undefined, undefined, 'Uzbekistan', plan, null, null, null, {
        tools: runner.tools,
        run: runner.run,
        instructions: CHAT_AGENT_INSTRUCTIONS,
      });
    } catch (err) {
      error = (err as Error).message;
      errors++;
    }
    const facts = row.facts.map((f) => new RegExp(f, 'iu').test(reply));
    const ok = !error && facts.every(Boolean);
    if (ok) passed++;
    factsOk += facts.filter(Boolean).length;
    factsAll += facts.length;
    results.push({ question: row.question, ok, facts, error, seconds: Math.round((Date.now() - t0) / 100) / 10, reply });
    console.log(`${ok ? '✓' : '✗'} ${i + 1}. ${row.question.slice(0, 70)}${error ? ` — ОШИБКА: ${error.slice(0, 120)}` : ok ? '' : ` — факты ${facts.map((f) => (f ? '+' : '−')).join('')}`}`);
  }
  const summary = { plan, docGraph: process.env.DOC_GRAPH !== 'off', questions: rows.length, pass: +(passed / rows.length).toFixed(3), facts: +(factsOk / Math.max(1, factsAll)).toFixed(3), errors };
  console.log('\n=== FIRM DOCS ===', JSON.stringify(summary));
  const dir = path.join(HERE, 'reports');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `firm-docs-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(file, JSON.stringify({ at: new Date().toISOString(), ...summary, results }, null, 1));
  console.log(`[firm-docs] report saved: ${file}`);
  await db.close();
  fs.rmSync(process.env.DATA_DIR as string, { recursive: true, force: true });
}

void main();
