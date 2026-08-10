/**
 * Общий котёл лимитов на команду (решение владельца 2026-08-06).
 *
 * Место в команде — то, за что владелец заплатил, поэтому 500 документов
 * Business общие на ВСЮ команду, а не по 500 на человека. Проверяем именно
 * поведение счётчиков, а не наличие функций: тут легко получить обратную
 * ошибку — либо участники тратят по своему котлу (владелец платит впятеро
 * больше обещанного), либо участник Free-владельца внезапно упирается в 20
 * запросов вместо своего личного тарифа.
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATABASE_URL = '';
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lexab-teamquota-test-'));
process.env.JWT_SECRET = 'test-secret-that-is-definitely-long-enough-32+';
process.env.DATA_ENCRYPTION_KEY = 'teamquota-test-master-key-0123456789abcd';
process.env.SEED_DEMO_DATA = 'false';

const { getDb, migrate } = await import('../src/db.ts');
const {
  PLAN_LIMITS,
  quotaOwnerFor,
  storagePoolFor,
  monthlyUsage,
  reserveAiRequest,
  releaseAiRequest,
  reserveDocument,
  assertDocumentAllowance,
  assertStorageAllowance,
  storageUsedBytes,
} = await import('../src/lib/limits.ts');

const db = await getDb();
await migrate(db);

let n = 0;
async function makeUser(plan: string): Promise<string> {
  const id = `u-tq-${++n}`;
  await db.query('INSERT INTO users (id, name, email, password_hash, initials) VALUES ($1, $2, $3, $4, $5)', [
    id,
    `User ${id}`,
    `${id}@example.com`,
    'x',
    'UT',
  ]);
  if (plan !== 'Free') {
    await db.query("INSERT INTO subscriptions (user_id, plan, status) VALUES ($1, $2, 'active')", [id, plan]);
  }
  return id;
}

async function joinTeam(ownerId: string, memberId: string): Promise<void> {
  await db.query(
    `INSERT INTO team_members (id, owner_user_id, member_user_id, name, email, role, status)
     VALUES ($1, $2, $3, $4, $5, 'editor', 'active')`,
    [`tm-${ownerId}-${memberId}`, ownerId, memberId, `Member ${memberId}`, `${memberId}@example.com`],
  );
}

after(async () => {
  await db.close();
  try {
    fs.rmSync(process.env.DATA_DIR as string, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

describe('общий котёл лимитов команды', () => {
  let owner = '';
  let member = '';

  before(async () => {
    owner = await makeUser('Business');
    member = await makeUser('Free');
    await joinTeam(owner, member);
  });

  it('запрос участника считается по тарифу и счётчику ВЛАДЕЛЬЦА', async () => {
    const scope = await quotaOwnerFor(db, member);
    assert.equal(scope.ownerId, owner);
    assert.equal(scope.plan, 'Business');
  });

  it('ИИ-запросы участника и владельца тратят ОДИН счётчик', async () => {
    const before = (await monthlyUsage(db, owner)).aiRequests;
    await reserveAiRequest(db, member);
    await reserveAiRequest(db, owner);
    assert.equal((await monthlyUsage(db, owner)).aiRequests, before + 2);
    // Участник видит тот же общий расход, а не личный ноль.
    assert.equal((await monthlyUsage(db, member)).aiRequests, before + 2);
  });

  it('возврат единицы участника снимает её с котла команды, а не с него лично', async () => {
    const before = (await monthlyUsage(db, owner)).aiRequests;
    const r = await reserveAiRequest(db, member);
    assert.equal(r.quotaUserId, owner);
    await releaseAiRequest(db, member, r.quotaUserId);
    assert.equal((await monthlyUsage(db, owner)).aiRequests, before);
  });

  it('документы участника списываются из 500 документов Business', async () => {
    const before = (await monthlyUsage(db, owner)).docsCreated;
    await db.withTx((tx) => reserveDocument(tx, member));
    assert.equal((await monthlyUsage(db, owner)).docsCreated, before + 1);
  });

  it('лимит документов Business — 500 и он общий: у участника тот же остаток', async () => {
    assert.equal(PLAN_LIMITS.Business.docs, 500);
    const used = (await monthlyUsage(db, owner)).docsCreated;
    await db.query(
      `INSERT INTO usage_counters (user_id, month, ai_requests, docs_created)
       VALUES ($1, date_trunc('month', now())::date, 0, $2)
       ON CONFLICT (user_id, month) DO UPDATE SET docs_created = $2`,
      [owner, 500 - used + used],
    );
    await assert.rejects(() => assertDocumentAllowance(db, member), /Лимит документов тарифа Business/);
    await assert.rejects(() => assertDocumentAllowance(db, owner), /Лимит документов тарифа Business/);
    await db.query("UPDATE usage_counters SET docs_created = 0 WHERE user_id = $1 AND month = date_trunc('month', now())::date", [owner]);
  });

  it('хранилище общее: файл участника занимает место у команды', async () => {
    const pool = await storagePoolFor(db, member);
    assert.equal(pool.ownerId, owner);
    assert.deepEqual([...pool.poolIds].sort(), [owner, member].sort());

    await db.query(
      `INSERT INTO uploads (id, user_id, file_name, size_bytes, storage, storage_key)
       VALUES ($1, $2, 'a.pdf', $3, 'local', 'k1')`,
      ['up-tq-1', member, 40 * 1024 * 1024],
    );
    // Владелец видит занятое участником место.
    assert.equal(await storageUsedBytes(db, owner), 40 * 1024 * 1024);
    assert.equal(await storageUsedBytes(db, member), 40 * 1024 * 1024);
  });

  it('лимит хранилища Business — 1 ГБ, и он на всю команду', async () => {
    assert.equal(PLAN_LIMITS.Business.storageMb, 1024);
    // 40 МБ уже занято участником — ещё 1000 МБ не влезут.
    await assert.rejects(
      () => assertStorageAllowance(db, owner, 1000 * 1024 * 1024),
      /Хранилище тарифа Business заполнено/,
    );
  });
});

describe('котёл НЕ включается, когда тариф владельца не даёт команд', () => {
  it('участник Free-владельца считается по СВОЕМУ тарифу', async () => {
    // Владелец слетел на Free (не продлил Business) — участники не должны
    // разом провалиться в лимит 20 запросов, потеряв и свой личный тариф.
    const poorOwner = await makeUser('Free');
    const proMember = await makeUser('Pro');
    await joinTeam(poorOwner, proMember);

    const scope = await quotaOwnerFor(db, proMember);
    assert.equal(scope.ownerId, proMember, 'котёл должен остаться личным');
    assert.equal(scope.plan, 'Pro');

    const pool = await storagePoolFor(db, proMember);
    assert.deepEqual(pool.poolIds, [proMember]);
  });
});

describe('лимиты тарифов после правки 2026-08-06', () => {
  it('хранилище: Free 50, Standard 250, Pro 500, Business 1024 МБ', () => {
    assert.equal(PLAN_LIMITS.Free.storageMb, 50);
    assert.equal(PLAN_LIMITS.Standard.storageMb, 250);
    assert.equal(PLAN_LIMITS.Pro.storageMb, 500);
    assert.equal(PLAN_LIMITS.Business.storageMb, 1024);
    assert.equal(PLAN_LIMITS.Enterprise.storageMb, null);
  });

  it('модель Pro совпадает с моделью Standard', async () => {
    const { config } = await import('../src/config.ts');
    assert.equal(config.planModels.Pro, config.planModels.Standard);
  });

  it('месячный потолок публичного API — 100', async () => {
    const { config } = await import('../src/config.ts');
    assert.equal(config.apiMonthlyLimit, 100);
  });
});
