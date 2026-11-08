/**
 * Фоновая починка ссылок разбора (решение владельца 2026-11-08): разбор
 * показывается сразу, агент дочинивает неподтверждённые ссылки после ответа.
 * Проверяем: починка дописывается в уже сохранённые находки и правки, отметка
 * «идёт починка» снимается и при успехе, и при сбое, зависшая отметка через
 * 5 минут перестаёт считаться.
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATABASE_URL = '';
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lexab-repair-test-'));
process.env.ANTHROPIC_API_KEY = '';
process.env.DEEPSEEK_API_KEY = '';
process.env.VOYAGE_API_KEY = '';
process.env.JWT_SECRET = 'test-secret-that-is-definitely-long-enough-32+';
process.env.SEED_DEMO_DATA = 'false';

const { getDb, migrate } = await import('../src/db.ts');
const { finishRepairInBackground, loadAnalysis } = await import('../src/routes/analysis.routes.ts');
const { encText, encJsonForJsonb } = await import('../src/lib/docCrypto.ts');
type Gen = import('../src/llm.ts').GeneratedAnalysis;

const db = await getDb();
await migrate(db);

const U = 'u_rep';
async function analysis(id: string, startedAgoMs: number | null): Promise<void> {
  await db.query(
    `INSERT INTO documents (id, user_id, name, counterparty, status, risk, jurisdiction) VALUES ($1, $2, 'Поставка.docx', '—', 'Reviewed', 'High', 'UZ')`,
    [`d_${id}`, U],
  );
  await db.query(
    `INSERT INTO analyses (id, user_id, document_id, file_name, file_size, summary, risk_score, risk_level, clauses_reviewed, document_blocks, repair_started_at)
     VALUES ($1, $2, $3, 'Поставка.docx', '1 KB', $4, 70, 'High', 3, $5::jsonb, $6)`,
    [id, U, `d_${id}`, await encText(db, U, 'Разбор'), await encJsonForJsonb(db, U, []), startedAgoMs === null ? null : new Date(Date.now() - startedAgoMs)],
  );
  // Находка f1 подтверждена, f2 — нет (понижена до Low до починки).
  await db.query(
    `INSERT INTO findings (analysis_id, id, ord, severity, title, citation, unit_id, redline_id, unverified, playbook_deviation) VALUES
     ($1, 'f1', 0, 'High', 'Пеня без потолка', 'ст. 32 Закона № 670-I', 'lu_uz_10872_st-32', 'r1', false, false),
     ($1, 'f2', 1, 'Low', 'Отказ от проверки качества', 'ст. 999 ГК', NULL, 'r2', true, false)`,
    [id],
  );
  await db.query(
    `INSERT INTO redlines (analysis_id, id, ord, del_text, ins_text, severity, status) VALUES
     ($1, 'r1', 0, $2, $3, 'High', 'pending'), ($1, 'r2', 1, $2, $3, 'Low', 'pending')`,
    [id, await encText(db, U, 'старый текст'), await encText(db, U, 'новый текст')],
  );
}

const repaired = (): Gen =>
  ({
    summary: '',
    riskScore: 70,
    riskLevel: 'High',
    clausesReviewed: 3,
    findings: [
      { severity: 'High', title: 'Пеня без потолка', citation: 'ст. 32 Закона № 670-I', unitId: 'lu_uz_10872_st-32', redlineId: 'r1', unverified: false },
      { severity: 'Medium', title: 'Отказ от проверки качества', citation: 'ст. 26 Закона № 670-I', unitId: 'lu_uz_10872_st-26', redlineId: 'r2', unverified: false },
    ],
    redlines: [
      { id: 'r1', delText: 'старый текст', insText: 'новый текст', severity: 'High' },
      { id: 'r2', delText: 'старый текст', insText: 'новый текст', severity: 'Medium' },
    ],
    document: [],
  }) as unknown as Gen;

describe('background citation repair of an analysis', () => {
  before(async () => {
    await db.query(`INSERT INTO users (id, email, password_hash, name, initials) VALUES ($1, 'rep@t.local', 'x', 'Rep', 'R')`, [U]);
  });

  it('while repair runs the analysis says repairPending; afterwards the fixed citation is saved and the flag is gone', async () => {
    await analysis('an_ok', 1000);
    assert.equal((await loadAnalysis(db, U, 'an_ok')).repairPending, true);
    await finishRepairInBackground(db, 'an_ok', async () => repaired());
    const a = await loadAnalysis(db, U, 'an_ok');
    assert.equal(a.repairPending, undefined);
    const f2 = a.findings.find((f) => f.id === 'f2');
    assert.equal(f2?.citation, 'ст. 26 Закона № 670-I');
    assert.equal(f2?.unitId, 'lu_uz_10872_st-26');
    assert.equal(f2?.unverified, false);
    assert.equal(f2?.severity, 'Medium', 'серьёзность восстановлена');
    assert.equal(a.redlines.find((r) => r.id === 'r2')?.severity, 'Medium', 'правка синхронизирована');
    assert.equal(a.findings.find((f) => f.id === 'f1')?.citation, 'ст. 32 Закона № 670-I', 'подтверждённая находка не тронута');
  });

  it('a failed repair keeps the analysis as it was and still clears the flag', async () => {
    await analysis('an_fail', 1000);
    const warnings: string[] = [];
    await finishRepairInBackground(db, 'an_fail', async () => { throw new Error('model down'); }, (m) => warnings.push(m));
    const a = await loadAnalysis(db, U, 'an_fail');
    assert.equal(a.repairPending, undefined);
    assert.equal(a.findings.find((f) => f.id === 'f2')?.unverified, true, 'неподтверждённая ссылка осталась помеченной');
    assert.match(warnings.join(' '), /model down/);
  });

  it('a stale flag (server restarted mid-repair) stops counting after 5 minutes', async () => {
    await analysis('an_stale', 6 * 60 * 1000);
    assert.equal((await loadAnalysis(db, U, 'an_stale')).repairPending, undefined);
    await analysis('an_none', null);
    assert.equal((await loadAnalysis(db, U, 'an_none')).repairPending, undefined);
  });
});

after(async () => {
  await db.close();
  try {
    fs.rmSync(process.env.DATA_DIR as string, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});
