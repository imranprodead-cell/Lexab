/**
 * Из какого лимита что списывается (решение владельца 2026-08-06).
 *
 * Правило: лимит ИИ-запросов — ТОЛЬКО переписка в чате. Вся работа с
 * договорами идёт из лимита документов и стоит по-разному: разбор 1,
 * создание договора 2, сравнение версий 5.
 *
 * Тест сторожит ровно это разделение. Ошибиться тут легко и незаметно: новый
 * маршрут привычно возьмёт withAiRequest — и чат внезапно начнёт кончаться от
 * загрузки договоров, а лимит документов перестанет что-либо ограничивать.
 */
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATABASE_URL = '';
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lexab-doccost-test-'));
process.env.JWT_SECRET = 'test-secret-that-is-definitely-long-enough-32+';
process.env.DATA_ENCRYPTION_KEY = 'doccost-test-master-key-0123456789abcdef';
process.env.SEED_DEMO_DATA = 'false';

const { getDb, migrate } = await import('../src/db.ts');
const { DOC_COST, PLAN_LIMITS, monthlyUsage, reserveDocument, releaseDocumentUnits, withDocumentUnits, assertDocumentAllowance } =
  await import('../src/lib/limits.ts');

const db = await getDb();
await migrate(db);

let n = 0;
async function makeUser(plan = 'Free'): Promise<string> {
  const id = `u-dc-${++n}`;
  await db.query('INSERT INTO users (id, name, email, password_hash, initials) VALUES ($1, $2, $3, $4, $5)', [
    id,
    `U${id}`,
    `${id}@example.com`,
    'x',
    'DC',
  ]);
  if (plan !== 'Free') {
    await db.query("INSERT INTO subscriptions (user_id, plan, status) VALUES ($1, $2, 'active')", [id, plan]);
  }
  return id;
}

const docsUsed = async (id: string) => (await monthlyUsage(db, id)).docsCreated;
const aiUsed = async (id: string) => (await monthlyUsage(db, id)).aiRequests;

after(async () => {
  await db.close();
  try {
    fs.rmSync(process.env.DATA_DIR as string, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

describe('стоимости операций', () => {
  it('заданы владельцем: разбор 1, создание договора 2, сравнение 5', () => {
    assert.equal(DOC_COST.analysis, 1);
    assert.equal(DOC_COST.draft, 2);
    assert.equal(DOC_COST.compare, 5);
  });

  it('списывается ровно столько единиц, сколько стоит операция', async () => {
    const u = await makeUser('Business');
    await db.withTx((tx) => reserveDocument(tx, u, DOC_COST.analysis));
    assert.equal(await docsUsed(u), 1);
    await db.withTx((tx) => reserveDocument(tx, u, DOC_COST.draft));
    assert.equal(await docsUsed(u), 3);
    await db.withTx((tx) => reserveDocument(tx, u, DOC_COST.compare));
    assert.equal(await docsUsed(u), 8);
    assert.equal(await aiUsed(u), 0, 'лимит чата не тронут ни одной из операций');
  });

  it('провал работы возвращает ВСЕ списанные единицы, а не одну', async () => {
    const u = await makeUser('Business');
    await assert.rejects(
      withDocumentUnits(db, u, DOC_COST.compare, async () => {
        throw new Error('модель недоступна');
      }),
    );
    assert.equal(await docsUsed(u), 0, 'все 5 единиц вернулись');
  });

  it('успешная работа оставляет списание', async () => {
    const u = await makeUser('Business');
    const out = await withDocumentUnits(db, u, DOC_COST.compare, async (plan) => `ok:${plan}`);
    assert.equal(out, 'ok:Business');
    assert.equal(await docsUsed(u), 5);
  });
});

describe('дорогая операция не проскакивает мимо лимита', () => {
  it('сравнение (5) НЕ проходит на Free с лимитом 3 — даже на пустом счётчике', async () => {
    // Ветка INSERT создаёт строку счётчика без сверки с потолком: без явной
    // проверки «операция дороже всего лимита» первое же сравнение на новом
    // месяце прошло бы бесплатно и увело счётчик за потолок.
    const u = await makeUser('Free');
    assert.equal(PLAN_LIMITS.Free.docs, 3);
    await assert.rejects(() => db.withTx((tx) => reserveDocument(tx, u, DOC_COST.compare)), /Лимит документов/);
    assert.equal(await docsUsed(u), 0, 'ничего не списано');
  });

  it('не пролезает и впритык: остаток 4 при цене 5', async () => {
    const u = await makeUser('Pro'); // 80 документов
    await db.query(
      `INSERT INTO usage_counters (user_id, month, ai_requests, docs_created)
       VALUES ($1, date_trunc('month', now())::date, 0, 76)`,
      [u],
    );
    await assert.rejects(() => db.withTx((tx) => reserveDocument(tx, u, DOC_COST.compare)), /Лимит документов/);
    assert.equal(await docsUsed(u), 76, 'счётчик не сдвинулся');
    // Ровно впритык (остаток 5) — проходит.
    await db.query("UPDATE usage_counters SET docs_created = 75 WHERE user_id = $1 AND month = date_trunc('month', now())::date", [u]);
    await db.withTx((tx) => reserveDocument(tx, u, DOC_COST.compare));
    assert.equal(await docsUsed(u), 80);
  });

  it('предпроверка перед моделью считает стоимость, а не единицу', async () => {
    const u = await makeUser('Pro');
    await db.query(
      `INSERT INTO usage_counters (user_id, month, ai_requests, docs_created)
       VALUES ($1, date_trunc('month', now())::date, 0, 78)`,
      [u],
    );
    // Одна единица ещё влезает…
    await assertDocumentAllowance(db, u, DOC_COST.analysis);
    // …а сравнение за 5 — уже нет, и узнать это надо ДО обращения к модели.
    await assert.rejects(() => assertDocumentAllowance(db, u, DOC_COST.compare), /Лимит документов/);
  });

  it('безлимитный тариф считает расход, но не отказывает', async () => {
    const u = await makeUser('Enterprise'); // docs: null
    await db.withTx((tx) => reserveDocument(tx, u, DOC_COST.compare));
    assert.equal(await docsUsed(u), 5, 'расход виден даже без потолка');
  });

  it('возврат не уводит счётчик в минус', async () => {
    const u = await makeUser('Business');
    await releaseDocumentUnits(db, u, 99);
    assert.equal(await docsUsed(u), 0);
  });
});
