/**
 * Карта связей на настоящей схеме (PGlite): сборка из текстов, запись с
 * provenance, повторная пересборка не плодит дубли, связь на отсутствующую
 * статью не появляется.
 */
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATABASE_URL = '';
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lexab-links-test-'));
process.env.ANTHROPIC_API_KEY = '';
process.env.DEEPSEEK_API_KEY = '';
process.env.VOYAGE_API_KEY = '';
process.env.JWT_SECRET = 'test-secret-that-is-definitely-long-enough-32+';
process.env.SEED_DEMO_DATA = 'false';

const { getDb, migrate } = await import('../src/db.ts');
const { buildLinks, writeLinks } = await import('../src/rag/build-links.ts');

const db = await getDb();
await migrate(db);

const PROV = `'https://lex.uz/x', now(), 'sha'`;
async function doc(id: string, title: string, type: string): Promise<void> {
  await db.query(
    `INSERT INTO legal_documents (id, jurisdiction, official_source_id, doc_type, title, source_url, retrieved_at, sha256_checksum)
     VALUES ($1, 'UZ', $1, $2, $3, 'https://lex.uz/x', now(), 'sha')`,
    [id, type, title],
  );
}
async function unit(id: string, docId: string, number: string, text: string, ord: number): Promise<void> {
  await db.query(
    `INSERT INTO legal_units (id, document_id, unit_type, number, breadcrumb, text, language, ord, source_url, retrieved_at, sha256_checksum)
     VALUES ($1, $2, 'section', $3, $1, $4, 'ru', $5, ${PROV})`,
    [id, docId, number, text, ord],
  );
}

describe('legal_links on the real schema', () => {
  it('builds refers / interprets / cocited with provenance and rebuilds idempotently', async () => {
    await doc('ld_gk1', 'Гражданский кодекс Республики Узбекистан (часть первая)', 'code');
    await doc('ld_gk2', 'Гражданский кодекс Республики Узбекистан (часть вторая)', 'code');
    await doc('ld_pl', 'Постановление Пленума ВХС № 163', 'plenum');
    await unit('u_gk1_327', 'ld_gk1', '327', 'Проценты за пользование чужими денежными средствами.', 1);
    await unit('u_gk1_326', 'ld_gk1', '326', 'Суд вправе уменьшить неустойку.', 2);
    await unit('u_gk2_736', 'ld_gk2', '736', 'проценты в размере, предусмотренном статьей 327 настоящего Кодекса, и по статье 999 настоящего Кодекса', 1);
    await unit('u_pl_4', 'ld_pl', '4', 'В соответствии со статьей 326 ГК суд вправе уменьшить неустойку, но не ниже процентов по статье 327 ГК.', 1);

    for (let i = 0; i < 2; i++) {
      const built = await buildLinks(db, 'UZ');
      await writeLinks(db, 'UZ', built.links, built.unitsById);
    }
    const rows = (
      await db.query<{ from_unit_id: string; to_unit_id: string; kind: string; via_unit_id: string | null; source_url: string; quote: string }>(
        `SELECT from_unit_id, to_unit_id, kind, via_unit_id, source_url, quote FROM legal_links ORDER BY kind, from_unit_id, to_unit_id`,
      )
    ).rows;
    assert.deepEqual(
      rows.map((r) => [r.from_unit_id, r.to_unit_id, r.kind, r.via_unit_id]),
      [
        ['u_gk1_326', 'u_gk1_327', 'cocited', 'u_pl_4'],
        ['u_gk1_327', 'u_gk1_326', 'cocited', 'u_pl_4'],
        ['u_pl_4', 'u_gk1_326', 'interprets', null],
        ['u_pl_4', 'u_gk1_327', 'interprets', null],
        ['u_gk2_736', 'u_gk1_327', 'refers', null],
      ],
      'статьи 999 нет в базе — связи на неё нет; пересборка не задвоила строки',
    );
    assert.ok(rows.every((r) => r.source_url && r.quote));
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
