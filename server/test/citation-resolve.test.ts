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

/** Insert a UZ presidential decree/resolution with doc_number + one unit. */
async function seedDecree(docId: string, title: string, docNumber: string): Promise<void> {
  await db.query(
    `INSERT INTO legal_documents (id, jurisdiction, official_source_id, doc_type, doc_number, title, source_url, retrieved_at, sha256_checksum)
     VALUES ($1, 'UZ', $1, $2, $3, $4, 'https://lex.uz/ru/docs/test', now(), $1)
     ON CONFLICT (id) DO NOTHING`,
    [docId, docNumber.startsWith('ПП-') ? 'resolution' : 'decree', docNumber, title],
  );
}
async function seedPoint(
  docId: string,
  suffix: string,
  number: string,
  ord: number,
  parentId: string | null,
): Promise<string> {
  const unitId = `${docId}_${suffix}`;
  await db.query(
    `INSERT INTO legal_units (id, document_id, parent_id, unit_type, number, breadcrumb, text, language, ord, source_url, retrieved_at, sha256_checksum, valid_from, valid_to)
     VALUES ($1, $2, $3, 'section', $4, $5, 'тестовый текст пункта', 'ru', $6, 'https://lex.uz/ru/docs/test', now(), $1, '2020-10-05', NULL)
     ON CONFLICT (id) DO NOTHING`,
    [unitId, docId, parentId, number, `UZ / ${title(docId)} / п.${number}`, ord],
  );
  return unitId;
}
const title = (docId: string) => docId.replace(/^ld_uz_/, 'акт ');

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

describe('resolveCitationText — указы/постановления по doc_number', () => {
  let mainP5: string;
  let lawSt5: string;

  before(async () => {
    // Указ с п.5 в основном тексте И п.5 в приложении (annex: parent_id = контейнер).
    await seedDecree('ld_uz_test_up9901', 'О мерах по тестовой цифровизации', 'УП-9901');
    mainP5 = await seedPoint('ld_uz_test_up9901', 'p-5', '5', 4, null);
    await db.query(
      `INSERT INTO legal_units (id, document_id, unit_type, number, breadcrumb, text, language, ord, source_url, retrieved_at, sha256_checksum, valid_from)
       VALUES ('ld_uz_test_up9901_pril-1', 'ld_uz_test_up9901', 'part', '1', 'UZ / акт / прил. 1', '', 'ru', 30, 'https://lex.uz/ru/docs/test', now(), 'x', '2020-10-05')
       ON CONFLICT (id) DO NOTHING`,
    );
    await seedPoint('ld_uz_test_up9901', 'pril1-p-5', '5', 40, 'ld_uz_test_up9901_pril-1');

    // Пара «закон + одноимённый указ»: указ содержит имя закона как подстроку.
    lawSt5 = await seedAct('ld_uz_test_persdata', 'О персональных данных', '5');
    await seedDecree('ld_uz_test_up9902', 'О мерах по реализации Закона «О персональных данных»', 'УП-9902');
    await seedPoint('ld_uz_test_up9902', 'p-5', '5', 1, null);
  });

  it('«п. 5 УП-9901» → пункт ОСНОВНОГО текста, не приложения', async () => {
    const id = await resolveCitationText(db, 'п. 5 УП-9901', 'UZ');
    assert.equal(id, mainP5);
  });

  it('детерминизм: 5 одинаковых запросов — один результат', async () => {
    const runs = await Promise.all(Array.from({ length: 5 }, () => resolveCitationText(db, 'пункт 5 Указа Президента № УП-9901', 'UZ')));
    assert.deepEqual(new Set(runs), new Set([mainP5]));
  });

  it('несуществующий пункт / несуществующий номер акта → null (fail-closed)', async () => {
    assert.equal(await resolveCitationText(db, 'п. 99 УП-9901', 'UZ'), null);
    assert.equal(await resolveCitationText(db, 'п. 5 УП-8888', 'UZ'), null);
  });

  it('кросс-захват исключён: «ст. 5 Закона…» → ЗАКОН, «п. 5 УП-…» → УКАЗ', async () => {
    // Название указа содержит «О персональных данных» — кавычный ILIKE матчит
    // оба документа; фильтр doc_type обязан отдать закон.
    assert.equal(await resolveCitationText(db, 'ст. 5 Закона «О персональных данных»', 'UZ'), lawSt5);
    assert.equal(await resolveCitationText(db, 'п. 5 УП-9902', 'UZ'), 'ld_uz_test_up9902_p-5');
  });

  it('старые статейные кейсы не задеты: «п. 2 ст. 5 Закона о залоге» → статья', async () => {
    const id = await resolveCitationText(db, 'п. 2 ст. 5 Закона о залоге', 'UZ');
    assert.equal(id, 'ld_uz_test_zalog_st-5');
  });
});

describe('resolveCitationText — постановления Пленума по doc_number', () => {
  async function seedPlenum(docId: string, docNumber: string, title: string): Promise<void> {
    await db.query(
      `INSERT INTO legal_documents (id, jurisdiction, official_source_id, doc_type, doc_number, title, source_url, retrieved_at, sha256_checksum)
       VALUES ($1, 'UZ', $1, 'plenum', $2, $3, 'https://lex.uz/ru/docs/test', now(), $1)
       ON CONFLICT (id) DO NOTHING`,
      [docId, docNumber, title],
    );
  }

  before(async () => {
    // У ВС номера повторяются по годам: № 16 есть и в 1999, и в 2023.
    await seedPlenum('ld_uz_test_pvs16_1999', 'ПВС-16-1999', 'Постановление Пленума Верховного суда (ВС) № 16 от 24.09.1999 «О применении ГК»');
    await seedPoint('ld_uz_test_pvs16_1999', 'p-3', '3', 2, null);
    await seedPlenum('ld_uz_test_pvs16_2023', 'ПВС-16-2023', 'Постановление Пленума Верховного суда (ВС) № 16 от 23.06.2023 «О прямом применении Конституции»');
    await seedPoint('ld_uz_test_pvs16_2023', 'p-3', '3', 2, null);
    await seedPlenum('ld_uz_test_pvhs163', 'ПВХС-163-2007', 'Постановление Пленума Высшего хозяйственного суда (ВХС) № 163 от 15.06.2007 «Об ответственности»');
    await seedPoint('ld_uz_test_pvhs163', 'p-6', '6', 5, null);
    // Название Пленума содержит имя закона; у закона нет статьи 40, у Пленума есть п. 40.
    await seedAct('ld_uz_test_dogbaza', 'О договорно-правовой базе деятельности хозяйствующих субъектов', '5');
    await seedPlenum('ld_uz_test_pvhs103', 'ПВХС-103-2002', 'Постановление Пленума ВХС № 103 от 04.03.2002 «О применении Закона «О договорно-правовой базе деятельности хозяйствующих субъектов»»');
    await seedPoint('ld_uz_test_pvhs103', 'p-5', '5', 4, null);
    await seedPoint('ld_uz_test_pvhs103', 'p-40', '40', 39, null);
  });

  it('с годом — точный документ', async () => {
    assert.equal(await resolveCitationText(db, 'п. 3 постановления Пленума ВС № 16 от 23.06.2023', 'UZ'), 'ld_uz_test_pvs16_2023_p-3');
    assert.equal(await resolveCitationText(db, 'пункт 3 постановления Пленума Верховного суда от 24 сентября 1999 года № 16', 'UZ'), 'ld_uz_test_pvs16_1999_p-3');
  });

  it('без года: единственный документ — резолвится, два — null', async () => {
    assert.equal(await resolveCitationText(db, 'п. 6 постановления Пленума ВХС № 163', 'UZ'), 'ld_uz_test_pvhs163_p-6');
    assert.equal(await resolveCitationText(db, 'п. 3 постановления Пленума ВС № 16', 'UZ'), null);
  });

  it('несуществующий пункт, не тот суд или год → null', async () => {
    assert.equal(await resolveCitationText(db, 'п. 99 постановления Пленума ВХС № 163', 'UZ'), null);
    assert.equal(await resolveCitationText(db, 'п. 6 постановления Пленума ВС № 163', 'UZ'), null);
    assert.equal(await resolveCitationText(db, 'п. 6 постановления Пленума ВХС № 163 от 15.06.2008', 'UZ'), null);
  });

  it('кросс-захват исключён: статья закона не уезжает в пункт Пленума', async () => {
    assert.equal(await resolveCitationText(db, 'ст. 5 Закона «О договорно-правовой базе деятельности хозяйствующих субъектов»', 'UZ'), 'ld_uz_test_dogbaza_st-5');
    // У закона нет ст. 40, у Пленума есть п. 40 — титульная ветка Пленумы не берёт.
    assert.equal(await resolveCitationText(db, 'ст. 40 Закона о договорно-правовой базе', 'UZ'), null);
    assert.equal(await resolveCitationText(db, 'п. 40 постановления Пленума ВХС № 103', 'UZ'), 'ld_uz_test_pvhs103_p-40');
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
