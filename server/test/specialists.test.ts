/**
 * Памятки задач — «специалисты» агента чата (lib/specialists.ts, 2026-11-14).
 * Без сети и ключей: PGlite с парой норм из карты «Аренда». Проверяем то, что
 * держит КОД: в памятке нет правил и цифр (только «где искать»), норма,
 * которой нет в базе, в памятку не попадает, инструмент есть только в чатах
 * по праву Узбекистана и выключается SPECIALISTS=off.
 */
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATABASE_URL = '';
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lexab-specialists-test-'));
process.env.ANTHROPIC_API_KEY = '';
process.env.DEEPSEEK_API_KEY = '';
process.env.VOYAGE_API_KEY = '';
process.env.JWT_SECRET = 'test-secret-that-is-definitely-long-enough-32+';
process.env.SEED_DEMO_DATA = 'false';
delete process.env.SPECIALISTS;

const { getDb, migrate } = await import('../src/db.ts');
const { MAX_GUIDE_CHARS, SPECIALIST_ACTS, SPECIALIST_IDS, SPECIALISTS, renderGuide, shortActTitle, specialistById, specialistsOn, specialistUnitIds } = await import(
  '../src/lib/specialists.ts'
);
const { CHAT_AGENT_INSTRUCTIONS, CHAT_TOOLS, TASK_GUIDE_INSTRUCTIONS, TASK_GUIDE_TOOL, createChatToolRunner } = await import('../src/lib/chatTools.ts');
type ChatStep = import('../src/types.ts').ChatStep;

const db = await getDb();
await migrate(db);
after(async () => {
  await db.close();
  fs.rmSync(process.env.DATA_DIR as string, { recursive: true, force: true });
});

const GK2 = 'Гражданский кодекс Республики Узбекистан (часть вторая)';
const ARENDA = '427-XII-сон 19.11.1991. Об аренде';
async function seedDoc(id: string, docType: string, title: string): Promise<void> {
  await db.query(
    `INSERT INTO legal_documents (id, jurisdiction, official_source_id, doc_type, title, source_url, retrieved_at, sha256_checksum)
     VALUES ($1, 'UZ', $1, $2, $3, 'https://lex.uz/docs/1', now(), $1)`,
    [id, docType, title],
  );
}
async function seedUnit(docId: string, lexId: string, n: string, title: string, heading: string, validTo: string | null = null): Promise<void> {
  const id = `lu_uz_${lexId}_st-${n}`;
  await db.query(
    `INSERT INTO legal_units (id, document_id, unit_type, number, heading, breadcrumb, text, language, source_url, official_unit_uri, retrieved_at, sha256_checksum, valid_from, valid_to)
     VALUES ($1, $2, 'section', $3, $4, $5, $6, 'ru', 'https://lex.uz/docs/1', $7, now(), $1, '1997-03-01', $8)`,
    [id, docId, n, heading, `UZ / ${title} / ст.${n}`, `Статья ${n}. ${heading}. ТЕКСТ-НОРМЫ-${n}`, `https://lex.uz/docs/1#${n}`, validTo],
  );
}
await seedDoc('ld_sp_gk2', 'code', GK2);
await seedDoc('ld_sp_arenda', 'act', ARENDA);
await seedUnit('ld_sp_gk2', SPECIALIST_ACTS.gk2, '539', GK2, 'Форма договора имущественного найма');
await seedUnit('ld_sp_gk2', SPECIALIST_ACTS.gk2, '574', GK2, 'Форма и государственная регистрация договора аренды здания или сооружения');
await seedUnit('ld_sp_arenda', SPECIALIST_ACTS.arenda, '14', ARENDA, 'Возобновление договора аренды');
// Статья утратила силу — в памятку попасть не должна.
await seedUnit('ld_sp_gk2', SPECIALIST_ACTS.gk2, '540', GK2, 'Срок договора имущественного найма', '2020-01-01');

function runner(jurisdiction: 'UZ' | 'KZ' | null = 'UZ') {
  const steps: ChatStep[] = [];
  const refs: { label: string; kind: string }[] = [];
  const r = createChatToolRunner({
    db,
    jurisdiction,
    documents: [],
    onStep: (s) => steps.push(s),
    toRefs: async (units) => units.map((u) => ({ label: u.unitId, doc: u.breadcrumb })),
    onRefs: (x, kind) => refs.push(...x.map((y) => ({ label: y.label, kind }))),
  });
  return { ...r, steps, refs };
}

describe('specialists: the recipes themselves', () => {
  it('six specialists, unique ids, every map line points at real-looking unit ids', () => {
    assert.deepEqual(
      SPECIALISTS.map((s) => s.id),
      [...SPECIALIST_IDS],
    );
    for (const s of SPECIALISTS) {
      assert.ok(s.title && s.when && s.ask.length >= 3 && s.check.length >= 5 && s.map.length >= 8, s.id);
      const ids = specialistUnitIds(s);
      assert.equal(new Set(ids).size, ids.length, `${s.id}: норма повторяется в карте`);
      for (const id of ids) assert.match(id, /^lu_uz_\d+_st-\d+(-\d+)?$/, id);
      assert.equal(specialistById(s.id), s);
    }
    assert.equal(specialistById('tax'), undefined);
  });

  // Правило 1: памятка говорит, ГДЕ искать, а не ЧТО написано в законе. Цифра
  // вне номера статьи — признак зашитого правила («30 дней», «0,5 %», «3 года»).
  it('ask/check/topic lines hold no figures besides article numbers', () => {
    const articleRefs = /(?:ст\.|п\.)\s*\d+(?:-\d+)?(?:\s*(?:,|–|и|или)\s*\d+(?:-\d+)?)*/gu;
    for (const s of SPECIALISTS) {
      for (const line of [...s.ask, ...s.check, ...s.map.map((m) => m.topic), s.title]) {
        const rest = line.replace(articleRefs, '');
        assert.ok(!/\d/.test(rest), `${s.id}: цифра вне номера статьи — «${line}»`);
        assert.ok(!rest.includes('%'), `${s.id}: «${line}»`);
      }
    }
  });

  it('act titles are shortened mechanically from the database title', () => {
    assert.equal(shortActTitle(GK2), 'Гражданский кодекс (часть вторая)');
    assert.equal(shortActTitle(ARENDA, 'act'), 'Закон «Об аренде» (№ 427-XII от 19.11.1991)');
    assert.equal(shortActTitle('ЗРУ-1137-сон 21.04.2026. Об обществах с ограниченной ответственностью', 'act'), 'Закон «Об обществах с ограниченной ответственностью» (№ ЗРУ-1137 от 21.04.2026)');
    // Не закон (вид акта неизвестен) — слово «Закон» не приписываем.
    assert.equal(shortActTitle('УП-60-сон 28.01.2022. О стратегии', 'decree'), '«О стратегии» (№ УП-60 от 28.01.2022)');
  });

  it('only for Uzbek law, and SPECIALISTS=off turns them off', () => {
    assert.equal(specialistsOn('UZ'), true);
    assert.equal(specialistsOn('KZ'), false);
    assert.equal(specialistsOn(null), false);
    process.env.SPECIALISTS = 'off';
    try {
      assert.equal(specialistsOn('UZ'), false);
      assert.equal(runner('UZ').tools.length, CHAT_TOOLS.length);
    } finally {
      delete process.env.SPECIALISTS;
    }
  });
});

describe('specialists: the guide is built from the database', () => {
  it('headings and act names come from the DB; missing and repealed provisions are left out', async () => {
    const lease = specialistById('lease')!;
    const g = await renderGuide(db, lease);
    assert.match(g.text, /\[lu_uz_180550_st-539\] ст\. 539 — Форма договора имущественного найма/);
    assert.match(g.text, /Гражданский кодекс \(часть вторая\):/);
    assert.match(g.text, /Закон «Об аренде» \(№ 427-XII от 19\.11\.1991\):\n\s+\[lu_uz_112910_st-14\] ст\. 14 — Возобновление договора аренды/);
    assert.deepEqual(g.units.map((u) => u.unitId).sort(), ['lu_uz_112910_st-14', 'lu_uz_180550_st-539', 'lu_uz_180550_st-574']);
    // Утратившая силу ст. 540 и всё, чего нет в базе, — в missing, а не в тексте.
    assert.ok(g.missing.includes('lu_uz_180550_st-540'));
    assert.ok(!g.text.includes('st-540]'));
    assert.ok(!g.text.includes('st-551]'));
    // Темы без единой нормы в базе не печатаются пустыми заголовками.
    assert.ok(!g.text.includes('• Прокат и аренда транспорта'));
    // Текста нормы в памятке нет — только заголовок.
    assert.ok(!g.text.includes('ТЕКСТ-НОРМЫ'));
    assert.match(g.text, /It is NOT the law/);
    assert.ok(g.text.length < MAX_GUIDE_CHARS);
  });
});

describe('task_guide tool', () => {
  it('is offered only in Uzbek-law chats, with its instruction line', () => {
    const uz = runner('UZ');
    assert.equal(uz.tools.length, CHAT_TOOLS.length + 1);
    assert.equal(uz.tools.at(-1), TASK_GUIDE_TOOL);
    assert.ok(uz.instructions.startsWith(CHAT_AGENT_INSTRUCTIONS));
    assert.ok(uz.instructions.endsWith(TASK_GUIDE_INSTRUCTIONS));
    for (const j of ['KZ', null] as const) {
      const other = runner(j);
      assert.equal(other.tools, CHAT_TOOLS);
      assert.equal(other.instructions, CHAT_AGENT_INSTRUCTIONS);
    }
    // Общий список инструментов не тронут: починка ссылок разбора берёт его часть.
    assert.ok(!CHAT_TOOLS.some((t) => t.name === 'task_guide'));
    const schema = TASK_GUIDE_TOOL.input_schema as { properties: { task: { enum: string[] } } };
    assert.deepEqual(schema.properties.task.enum, [...SPECIALIST_IDS]);
    for (const s of SPECIALISTS) assert.ok(String(TASK_GUIDE_TOOL.description).includes(`• ${s.id} — `), s.id);
  });

  it('returns the guide, shows a step with the guide name, and offers its provisions as found sources', async () => {
    const r = runner('UZ');
    const out = await r.run({ id: 'a', name: 'task_guide', input: { task: 'lease' } });
    assert.equal(out.isError, undefined);
    assert.match(out.content, /^TASK GUIDE «Аренда \(имущественный наём\)»/);
    assert.match(out.content, /\[lu_uz_180550_st-574\]/);
    assert.equal(out.keys, undefined, 'не поиск: успешный вызов считается продвижением');
    assert.deepEqual(
      r.steps.map((s) => [s.id, s.status, s.data?.tool, s.data?.task, s.data?.citation]),
      [
        ['tool-1', 'active', 'task_guide', 'lease', 'Аренда (имущественный наём)'],
        ['tool-1', 'done', 'task_guide', 'lease', 'Аренда (имущественный наём)'],
      ],
    );
    assert.equal(r.steps[1].data?.found, 3);
    assert.equal(r.refs.length, 3);
    assert.ok(r.refs.every((x) => x.kind === 'found'));
  });

  it('rejects an unknown task, and does not exist outside Uzbek law', async () => {
    const r = runner('UZ');
    const bad = await r.run({ id: 'a', name: 'task_guide', input: { task: 'tax' } });
    assert.equal(bad.isError, true);
    assert.match(bad.content, /task must be one of lease, supply, employment, claim, services, llc/);
    const empty = await r.run({ id: 'b', name: 'task_guide', input: {} });
    assert.equal(empty.isError, true);
    assert.match(empty.content, /task is required/);
    assert.equal(r.steps.length, 0, 'ошибочный вызов шага не показывает');

    const kz = runner('KZ');
    const none = await kz.run({ id: 'c', name: 'task_guide', input: { task: 'lease' } });
    assert.equal(none.isError, true);
    assert.match(none.content, /Unknown tool «task_guide»/);
    assert.ok(!none.content.includes('task_guide,') && !/Available:.*task_guide/.test(none.content));
  });

  it('the instruction line keeps the rule: a map, not law', () => {
    assert.match(TASK_GUIDE_INSTRUCTIONS, /call task_guide FIRST/);
    assert.match(TASK_GUIDE_INSTRUCTIONS, /a map, not law/);
    assert.ok(!/\d/.test(TASK_GUIDE_INSTRUCTIONS), 'цифр в инструкции нет');
  });
});
