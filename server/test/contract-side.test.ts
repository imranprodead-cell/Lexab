/**
 * «На чьей вы стороне» в разборе договора (lib/contractSide.ts, миграция 069):
 * роль из запроса, указание модели, хранение у разбора и загрузка обратно.
 */
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATABASE_URL = '';
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lexab-side-test-'));
process.env.ANTHROPIC_API_KEY = '';
process.env.DEEPSEEK_API_KEY = '';
process.env.JWT_SECRET = 'test-secret-that-is-definitely-long-enough-32+';
process.env.SEED_DEMO_DATA = 'false';

const { parseSide, sideInstruction } = await import('../src/lib/contractSide.ts');
const { getDb, migrate } = await import('../src/db.ts');
const { loadAnalysis } = await import('../src/routes/analysis.routes.ts');
const { encText, encJsonForJsonb } = await import('../src/lib/docCrypto.ts');

const db = await getDb();
await migrate(db);

describe('роль пользователя по договору', () => {
  it('только известные роли; остальное — нейтрально', () => {
    assert.equal(parseSide('buyer'), 'buyer');
    assert.equal(parseSide('lessor'), 'lessor');
    assert.equal(parseSide('neutral'), null);
    assert.equal(parseSide('admin; DROP TABLE'), null);
    assert.equal(parseSide(undefined), null);
  });

  it('указание модели: роль по-русски и по-узбекски, разбор с её стороны, нейтрально если роли нет', () => {
    const s = sideInstruction('buyer');
    assert.match(s, /Покупатель/u);
    assert.match(s, /Xaridor/u);
    assert.match(s, /in this party's favour/u);
    assert.match(s, /review neutrally/u);
  });

  it('роль хранится у разбора и возвращается; чужое значение база не примет', async () => {
    const U = 'u_side';
    await db.query(`INSERT INTO users (id, email, password_hash, name, initials) VALUES ($1, 'side@t.local', 'x', 'Side', 'S')`, [U]);
    await db.query(`INSERT INTO documents (id, user_id, name, counterparty, status, risk, jurisdiction) VALUES ('d_side', $1, 'Поставка.docx', '—', 'Reviewed', 'Low', 'UZ')`, [U]);
    const insert = async (id: string, side: string | null) =>
      db.query(
        `INSERT INTO analyses (id, user_id, document_id, file_name, file_size, summary, risk_score, risk_level, clauses_reviewed, document_blocks, side)
         VALUES ($1, $2, 'd_side', 'Поставка.docx', '1 KB', $3, 10, 'Low', 1, $4::jsonb, $5)`,
        [id, U, await encText(db, U, 'Разбор'), await encJsonForJsonb(db, U, []), side],
      );
    await insert('an_buyer', 'buyer');
    await insert('an_neutral', null);
    assert.equal((await loadAnalysis(db, U, 'an_buyer')).side, 'buyer');
    assert.equal((await loadAnalysis(db, U, 'an_neutral')).side, undefined);
    await assert.rejects(insert('an_bad', 'hacker'));
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
