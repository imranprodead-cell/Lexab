/**
 * Deterministic citation resolution against a MULTI-ACT corpus (PGlite).
 * Guards the scale risk: when a broad alias title-pattern («%О залоге%») matches
 * more than one legal_document that both carry the cited article number, the
 * resolver must pick the SAME, most-specific act every time — never an arbitrary
 * `LIMIT 1`. See resolveCitationText's ORDER BY in src/rag/retrieve.ts.
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATABASE_URL = '';
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lexab-cite-test-'));
process.env.ANTHROPIC_API_KEY = '';
process.env.DEEPSEEK_API_KEY = '';
process.env.VOYAGE_API_KEY = ''; // FTS/resolver only — no embeddings needed
process.env.JWT_SECRET = 'test-secret-that-is-definitely-long-enough-32+';
process.env.SEED_DEMO_DATA = 'false';

const { getDb, migrate } = await import('../src/db.ts');
const { resolveCitationText } = await import('../src/rag/retrieve.ts');

const db = await getDb();
await migrate(db);

/** Insert a UZ act with one section, all provenance fields satisfied. */
async function seedAct(docId: string, title: string, articleNumber: string): Promise<string> {
  await db.query(
    `INSERT INTO legal_documents (id, jurisdiction, official_source_id, doc_type, title, source_url, retrieved_at, sha256_checksum)
     VALUES ($1, 'UZ', $1, 'act', $2, 'https://lex.uz/ru/docs/test', now(), $1)
     ON CONFLICT (id) DO NOTHING`,
    [docId, title],
  );
  const unitId = `${docId}_st-${articleNumber}`;
  await db.query(
    `INSERT INTO legal_units (id, document_id, unit_type, number, breadcrumb, text, language, source_url, retrieved_at, sha256_checksum, valid_from, valid_to)
     VALUES ($1, $2, 'section', $3, $4, 'тестовый текст статьи', 'ru', 'https://lex.uz/ru/docs/test', now(), $1, '1994-01-01', NULL)
     ON CONFLICT (id) DO NOTHING`,
    [unitId, docId, articleNumber, `UZ / ${title} / ст.${articleNumber}`],
  );
  return unitId;
}

describe('resolveCitationText — детерминизм на многоактовом корпусе', () => {
  let specificUnit: string;

  before(async () => {
    // Две коллизии по алиасу «%О залоге%» + одинаковый номер статьи 5:
    //  - специфичный акт с коротким точным названием «О залоге»,
    //  - «шумный» акт, где «залоге» лишь встречается в длинном названии.
    specificUnit = await seedAct('ld_uz_test_zalog', 'О залоге', '5');
    await seedAct('ld_uz_test_noise', 'О залоге движимого имущества и иных предметах обеспечения обязательств', '5');
  });

  it('коллизия: выбирается специфичный (самый короткий) акт, а не произвольный', async () => {
    const id = await resolveCitationText(db, 'ст. 5 Закона о залоге', 'UZ');
    assert.equal(id, specificUnit, `ожидали ${specificUnit}, получили ${id}`);
  });

  it('детерминизм: 5 одинаковых запросов дают один и тот же результат', async () => {
    const runs = await Promise.all(
      Array.from({ length: 5 }, () => resolveCitationText(db, 'ст. 5 Закона о залоге', 'UZ')),
    );
    assert.deepEqual(new Set(runs), new Set([specificUnit]), `нестабильный выбор: ${JSON.stringify(runs)}`);
  });

  it('одноактовое совпадение по-прежнему резолвится (нет регресса)', async () => {
    const arendaUnit = await seedAct('ld_uz_test_arenda', 'Об аренде', '12');
    const id = await resolveCitationText(db, 'ст. 12 Закона об аренде', 'UZ');
    assert.equal(id, arendaUnit);
  });

  it('несуществующая статья → null (fail-closed)', async () => {
    const id = await resolveCitationText(db, 'ст. 999 Закона о залоге', 'UZ');
    assert.equal(id, null);
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
