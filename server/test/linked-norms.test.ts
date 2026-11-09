/**
 * Связанные нормы в поиске (карта legal_links, этап 2): к найденной статье
 * добавляются пункт Пленума, который её разъясняет, и соседняя статья главы;
 * RAG_LINKS=off выключает добавку. Без ИИ-ключей: переписчика, векторов и
 * реранкера нет — порядок RRF, добавки идут ПОСЛЕ основного списка.
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATABASE_URL = '';
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lexab-linked-test-'));
process.env.ANTHROPIC_API_KEY = '';
process.env.DEEPSEEK_API_KEY = '';
process.env.VOYAGE_API_KEY = '';
process.env.JWT_SECRET = 'test-secret-that-is-definitely-long-enough-32+';
process.env.SEED_DEMO_DATA = 'false';

const { getDb, migrate } = await import('../src/db.ts');
const { retrieveLegalContext } = await import('../src/rag/retrieve.ts');

const db = await getDb();
await migrate(db);

async function doc(id: string, title: string, type: string): Promise<void> {
  await db.query(
    `INSERT INTO legal_documents (id, jurisdiction, official_source_id, doc_type, title, source_url, retrieved_at, sha256_checksum)
     VALUES ($1, 'UZ', $1, $2, $3, 'https://lex.uz/x', now(), 'sha')`,
    [id, type, title],
  );
}
async function unit(id: string, docId: string, parent: string | null, type: string, number: string, text: string, ord: number): Promise<void> {
  await db.query(
    `INSERT INTO legal_units (id, document_id, parent_id, unit_type, number, breadcrumb, text, language, ord, source_url, retrieved_at, sha256_checksum)
     VALUES ($1, $2, $3, $4, $5, $1, $6, 'ru', $7, 'https://lex.uz/x', now(), 'sha')`,
    [id, docId, parent, type, number, text, ord],
  );
  if (type === 'section') {
    await db.query(
      `INSERT INTO chunks (id, unit_id, document_id, jurisdiction, language, breadcrumb, body, source_url, retrieved_at, sha256_checksum)
       VALUES ($1, $2, $3, 'UZ', 'ru', $2, $4, 'https://lex.uz/x', now(), 'sha')`,
      [`ch_${id}`, id, docId, text],
    );
  }
}

const ids = async (query: string): Promise<string[]> =>
  (await retrieveLegalContext(db, { query, jurisdiction: 'UZ', topK: 10 })).map((c) => c.unitId);

describe('связанные нормы в поиске', () => {
  before(async () => {
    await doc('ld_gk', 'Гражданский кодекс Республики Узбекистан (часть первая)', 'code');
    await doc('ld_pl', 'Постановление Пленума ВХС № 163', 'plenum');
    await unit('gk_gl12', 'ld_gk', null, 'chapter', '12', '', 1);
    await unit('gk_150', 'ld_gk', 'gk_gl12', 'section', '150', 'Общий срок исковой давности — три года.', 2);
    await unit('gk_154', 'ld_gk', 'gk_gl12', 'section', '154', 'Течение срока исковой давности начинается со дня, когда лицо узнало о нарушении права.', 3);
    await unit('gk_327', 'ld_gk', null, 'section', '327', 'За пользование чужими денежными средствами подлежат уплате проценты.', 4);
    await unit('pl_11', 'ld_pl', null, 'section', '11', 'Суд вправе уменьшить ставку, применительно к норме о неустойке, если она явно несоразмерна.', 1);
    await db.query(
      `INSERT INTO legal_links (from_unit_id, to_unit_id, kind, jurisdiction, quote, source_url, sha256_checksum, retrieved_at)
       VALUES ('pl_11', 'gk_327', 'interprets', 'UZ', 'статьей 327 ГК', 'https://lex.uz/x', 'sha', now())`,
    );
  });

  it('к найденной статье приходит разъясняющий её пункт Пленума (обратная связь)', async () => {
    const found = await ids('проценты за пользование чужими денежными средствами');
    assert.equal(found[0], 'gk_327');
    assert.ok(found.includes('pl_11'), `нет пункта Пленума: ${found.join(',')}`);
  });

  // Ни одного слова из ст.150 в запросе — найти её может только связь «та же глава».
  const Q_START = 'течение начинается со дня, когда лицо узнало о нарушении';

  it('к найденной статье приходит соседняя статья той же главы', async () => {
    const found = await ids(Q_START);
    assert.equal(found[0], 'gk_154');
    assert.ok(found.includes('gk_150'), `нет соседней статьи: ${found.join(',')}`);
  });

  it('RAG_LINKS=off — поиск как раньше, без добавок', async () => {
    process.env.RAG_LINKS = 'off';
    try {
      assert.ok(!(await ids('проценты за пользование чужими денежными средствами')).includes('pl_11'));
      assert.ok(!(await ids(Q_START)).includes('gk_150'));
    } finally {
      delete process.env.RAG_LINKS;
    }
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
