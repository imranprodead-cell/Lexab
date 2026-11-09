/**
 * Агент чата (2026-10-30): инструменты (lib/chatTools.ts) и цикл runAgentLoop.
 * Без сети и без ключей: инструменты работают на PGlite с парой норм, цикл —
 * на подставной «модели», которая отвечает заранее заготовленными шагами.
 */
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATABASE_URL = '';
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lexab-agent-test-'));
process.env.ANTHROPIC_API_KEY = '';
process.env.DEEPSEEK_API_KEY = '';
process.env.VOYAGE_API_KEY = '';
process.env.RAG_VALIDATE_MODEL = '';
process.env.JWT_SECRET = 'test-secret-that-is-definitely-long-enough-32+';
process.env.SEED_DEMO_DATA = 'false';

const { getDb, migrate } = await import('../src/db.ts');
const { addPeriod, citedProvisionNumbers, citesProvision, createChatToolRunner, evaluateExpression, parseDate, refNumber, CHAT_TOOLS, CHAT_AGENT_INSTRUCTIONS, UI_LABELS } = await import('../src/lib/chatTools.ts');
const { runAgentLoop, runDeepseekAgentLoop, TRUNCATED_NOTE } = await import('../src/llm.ts');
const { repairFindingCitations } = await import('../src/lib/citationRepair.ts');
const { encText, encJsonForJsonb, decJsonFromJsonb } = await import('../src/lib/docCrypto.ts');
const { addEditToAnalysis, addReminderToDocument, appendEditBlocks, appendReminderBlocks, loadEditTarget } = await import('../src/lib/chatActions.ts');
const { diffClauses, clausesOf } = await import('../src/lib/textDiff.ts');
const { checkContractDeadlines } = await import('../src/routes/contracts.routes.ts');
const { applyAcceptedRedlines } = await import('../src/lib/fullText.ts');
type DsChunk = import('../src/llm.ts').DsChunk;
type DsMessage = import('../src/llm.ts').DsMessage;
type ChatStep = import('../src/types.ts').ChatStep;
type BetaMessage = import('@anthropic-ai/sdk').default.Beta.BetaMessage;
type BetaMessageParam = import('@anthropic-ai/sdk').default.Beta.BetaMessageParam;

const db = await getDb();
await migrate(db);
after(async () => {
  await db.close();
  fs.rmSync(process.env.DATA_DIR as string, { recursive: true, force: true });
});

const TITLE = 'Гражданский кодекс Республики Узбекистан (часть первая)';
await db.query(
  `INSERT INTO legal_documents (id, jurisdiction, official_source_id, doc_type, title, source_url, retrieved_at, sha256_checksum)
   VALUES ('ld_agent_gk', 'UZ', 'ld_agent_gk', 'code', $1, 'https://lex.uz/docs/111181', now(), 'ld_agent_gk')`,
  [TITLE],
);
await db.query(
  `INSERT INTO legal_units (id, document_id, unit_type, number, breadcrumb, text, language, source_url, official_unit_uri, retrieved_at, sha256_checksum, valid_from)
   VALUES ('lu_uz_agent_st-356', 'ld_agent_gk', 'section', '356', $1, 'Статья 356. Цена. Исполнение договора оплачивается по цене, установленной соглашением сторон.', 'ru',
           'https://lex.uz/docs/111181', 'https://lex.uz/docs/111181#2002', now(), 'lu_uz_agent_st-356', '1997-03-01')`,
  [`UZ / ${TITLE} / Статья 356`],
);

function runner(documents: { name: string; text: string }[] = []) {
  const steps: ChatStep[] = [];
  const refs: { label: string; doc: string; kind: string }[] = [];
  const r = createChatToolRunner({
    db,
    jurisdiction: 'UZ',
    documents,
    onStep: (s) => steps.push(s),
    toRefs: async (units) => units.map((u) => ({ label: u.breadcrumb.split(' / ').pop() ?? '', doc: TITLE })),
    onRefs: (x, kind) => refs.push(...x.map((r) => ({ ...r, kind }))),
  });
  return { ...r, steps, refs };
}

describe('calculate', () => {
  it('arithmetic with precedence, parentheses and functions — no eval', () => {
    assert.equal(evaluateExpression('240000000 * 0.5/100 * 30'), 36_000_000);
    assert.equal(evaluateExpression('2 + 3 * 4'), 14);
    assert.equal(evaluateExpression('(2 + 3) * 4'), 20);
    assert.equal(evaluateExpression('2 ^ 3 ^ 2'), 512, '^ — справа налево');
    assert.equal(evaluateExpression('-5 + 2'), -3);
    assert.equal(evaluateExpression('min(240000000*50/100, 5/100*240000000*30)'), 120_000_000);
    assert.equal(evaluateExpression('round(10/3, 2)'), 3.33);
    assert.throws(() => evaluateExpression('1/0'), /division by zero/);
    assert.throws(() => evaluateExpression('process.exit()'), /unknown function|unexpected/);
    assert.throws(() => evaluateExpression('2 + ; 3'), /unexpected/);
    assert.throws(() => evaluateExpression('(1 + 2'), /expected/);
  });

  it('dates: both formats, real dates only, month end is clamped', () => {
    assert.equal(parseDate('2026-10-30').toISOString().slice(0, 10), '2026-10-30');
    assert.equal(parseDate('30.10.2026').toISOString().slice(0, 10), '2026-10-30');
    assert.throws(() => parseDate('31.02.2026'), /not a valid date/);
    assert.equal(addPeriod(parseDate('2026-01-31'), 0, 1, 0).toISOString().slice(0, 10), '2026-02-28');
    assert.equal(addPeriod(parseDate('2028-01-31'), 0, 1, 0).toISOString().slice(0, 10), '2028-02-29');
    assert.equal(addPeriod(parseDate('2026-10-30'), 0, 0, -30).toISOString().slice(0, 10), '2026-09-30');
    assert.equal(addPeriod(parseDate('2026-03-15'), 3, 0, 0).toISOString().slice(0, 10), '2029-03-15');
  });

  it('runs through the tool runner and shows the step', async () => {
    const r = runner();
    const out = await r.run({ id: 't1', name: 'calculate', input: { operation: 'days_between', from_date: '01.10.2026', to_date: '2026-10-30' } });
    assert.match(out.content, /29 calendar days/);
    assert.equal(r.steps.at(-1)?.data?.tool, 'calculate');
    const bad = await r.run({ id: 't2', name: 'calculate', input: { operation: 'evaluate', expression: 'rm -rf' } });
    assert.equal(bad.isError, true);
  });
});

describe('law tools', () => {
  it('get_provision: by citation and by unit id, with the official link; NOT_FOUND for a wrong number', async () => {
    const r = runner();
    const byCite = await r.run({ id: 'a', name: 'get_provision', input: { citation: 'ст. 356 ГК' } });
    assert.match(byCite.content, /\[lu_uz_agent_st-356\]/);
    assert.match(byCite.content, /lex\.uz\/docs\/111181#2002/);
    assert.match(byCite.content, /по цене, установленной соглашением сторон/);
    const byId = await r.run({ id: 'b', name: 'get_provision', input: { unit_id: 'lu_uz_agent_st-356' } });
    assert.match(byId.content, /Статья 356/);
    const missing = await r.run({ id: 'c', name: 'get_provision', input: { citation: 'ст. 9999 ГК' } });
    assert.match(missing.content, /^NOT_FOUND/);
    assert.equal(r.refs.length, 2, 'открытые статьи уходят во вкладку Sources');
    assert.ok(r.refs.every((x) => x.kind === 'used'), 'открытая статья — «использована», а не просто найдена');
    const badId = await r.run({ id: 'd', name: 'get_provision', input: { unit_id: "x'; DROP TABLE legal_units; --" } });
    assert.equal(badId.isError, true);
  });

  it('verify_citation: NOT_FOUND for an invented article; found but unchecked without a judge key', async () => {
    const r = runner();
    const fake = await r.run({ id: 'a', name: 'verify_citation', input: { citation: 'ст. 9999 ГК', claim: 'цена договора' } });
    assert.match(fake.content, /^NOT_FOUND/);
    assert.equal(r.steps.at(-1)?.data?.verdict, 'not_found');
    const real = await r.run({ id: 'b', name: 'verify_citation', input: { citation: 'ст. 356 ГК', claim: 'цену определяют стороны' } });
    assert.match(real.content, /^FOUND \(not semantically checked/);
    assert.equal(r.steps.at(-1)?.data?.verdict, 'unchecked');
    assert.equal(r.refs.length, 0, 'непроверенная ссылка в Sources не идёт');
  });

  it('input checks come back as errors the model can fix', async () => {
    const r = runner();
    const noQuery = await r.run({ id: 'a', name: 'search_law', input: {} });
    assert.equal(noQuery.isError, true);
    assert.match(noQuery.content, /query is required/);
    const badJur = await r.run({ id: 'b', name: 'search_law', input: { query: 'цена', jurisdiction: 'RU' } });
    assert.equal(badJur.isError, true);
    const unknown = await r.run({ id: 'c', name: 'send_email', input: {} });
    assert.equal(unknown.isError, true);
    assert.equal(CHAT_TOOLS.length, 13); // +search_official, read_official (официальные сайты, 2026-11-09)
  });
});

describe('read_contract', () => {
  const contract = [
    '1. Предмет договора. Поставщик передаёт сахар.',
    '2. Цена товара — 240 000 000 сум.',
    'x'.repeat(2000),
    '7. За просрочку оплаты Покупатель уплачивает неустойку 5% за каждый день.',
  ].join('\n');

  it('finds a clause by meaning (word stems), reads by position, and says when nothing is attached', async () => {
    const r = runner([{ name: 'Договор поставки.pdf', text: contract }]);
    const found = await r.run({ id: 'a', name: 'read_contract', input: { query: 'неустойки за просрочку' } });
    assert.match(found.content, /уплачивает неустойку 5%/);
    const part = await r.run({ id: 'b', name: 'read_contract', input: { from_char: 0 } });
    assert.match(part.content, /Предмет договора/);
    const other = await r.run({ id: 'c', name: 'read_contract', input: { query: 'цена', document: 'аренда' } });
    assert.equal(other.isError, true);
    const none = await runner().run({ id: 'd', name: 'read_contract', input: { query: 'цена' } });
    assert.match(none.content, /^NO_DOCUMENTS/);
  });
});

/* ── цикл агента на подставной модели ─────────────────────────────────── */

function msg(content: BetaMessage['content'], stop: BetaMessage['stop_reason']): BetaMessage {
  return {
    id: 'msg',
    type: 'message',
    role: 'assistant',
    model: 'claude-sonnet-5-5',
    content,
    stop_reason: stop,
    stop_sequence: null,
    usage: { input_tokens: 1, output_tokens: 1 },
  } as unknown as BetaMessage;
}
const toolUse = (id: string, name: string, input: unknown) => ({ type: 'tool_use', id, name, input }) as unknown as BetaMessage['content'][number];
const text = (t: string) => ({ type: 'text', text: t, citations: null }) as unknown as BetaMessage['content'][number];

/** Подставная модель: на каждый шаг — следующий заготовленный ответ; текст «стримится». */
function fakeModel(script: BetaMessage[]) {
  const seen: BetaMessageParam[][] = [];
  let i = 0;
  const start = (messages: BetaMessageParam[]) => {
    seen.push(messages);
    const m = script[Math.min(i++, script.length - 1)];
    let cb: ((d: string) => void) | null = null;
    return {
      on: (_e: 'text', f: (d: string) => void) => {
        cb = f;
      },
      finalMessage: async () => {
        for (const b of m.content) if (b.type === 'text') cb?.(b.text);
        return m;
      },
    };
  };
  return { start, seen, calls: () => i };
}

describe('runAgentLoop', () => {
  it('runs the tools, sends all results in ONE user message, keeps history append-only, returns the answer', async () => {
    const model = fakeModel([
      msg([toolUse('u1', 'calculate', { operation: 'evaluate', expression: '2+2' }), toolUse('u2', 'calculate', { operation: 'evaluate', expression: '3*3' })], 'tool_use'),
      msg([text('Итого 4 и 9.')], 'end_turn'),
    ]);
    const ran: string[] = [];
    const tokens: string[] = [];
    const answer = await runAgentLoop({
      start: model.start,
      messages: [{ role: 'user', content: 'посчитай' }],
      agent: { tools: [], instructions: '', run: async (c) => (ran.push(c.id), { content: `ok ${c.id}` }) },
      onToken: (d) => tokens.push(d),
    });
    assert.equal(answer, 'Итого 4 и 9.');
    assert.deepEqual(ran.sort(), ['u1', 'u2']);
    const second = model.seen[1];
    assert.equal(second.length, 3, 'вопрос → ход модели → результаты');
    assert.equal(second[1].role, 'assistant');
    const results = second[2].content as { type: string; tool_use_id: string }[];
    assert.equal(second[2].role, 'user');
    assert.deepEqual(results.map((r) => r.tool_use_id), ['u1', 'u2'], 'оба результата — одним сообщением');
    assert.deepEqual(model.seen[0], [{ role: 'user', content: 'посчитай' }], 'первый шаг не видит чужих дописок');
    assert.equal(tokens.join(''), 'Итого 4 и 9.');
  });

  it('caps rounds: after the limit the tools get "write the answer now" and the loop ends', async () => {
    const loop = msg([text('Промежуточно.'), toolUse('u', 'search_law', { query: 'x' })], 'tool_use');
    const model = fakeModel([loop]);
    let runs = 0;
    const answer = await runAgentLoop({
      start: model.start,
      messages: [{ role: 'user', content: 'q' }],
      agent: { tools: [], instructions: '', run: async () => (runs++, { content: 'r' }) },
    });
    assert.equal(runs, 6, 'инструменты выполняются не больше 6 раундов');
    assert.ok(model.calls() <= 8, 'цикл не бесконечный');
    assert.match(answer, /Промежуточно/);
  });

  it('runs at most 4 calls at once; refusal throws', async () => {
    const many = msg([1, 2, 3, 4, 5].map((n) => toolUse(`u${n}`, 'calculate', {})), 'tool_use');
    const model = fakeModel([many, msg([text('ok')], 'end_turn')]);
    let runs = 0;
    await runAgentLoop({ start: model.start, messages: [{ role: 'user', content: 'q' }], agent: { tools: [], instructions: '', run: async () => (runs++, { content: 'r' }) } });
    assert.equal(runs, 4);
    const fifth = (model.seen[1][2].content as { tool_use_id: string; is_error?: boolean }[]).find((r) => r.tool_use_id === 'u5');
    assert.equal(fifth?.is_error, true);

    const refusing = fakeModel([msg([], 'refusal')]);
    await assert.rejects(
      runAgentLoop({ start: refusing.start, messages: [{ role: 'user', content: 'q' }], agent: { tools: [], instructions: '', run: async () => ({ content: '' }) } }),
      /refused/,
    );
  });
});

/* ── цикл агента DeepSeek на подставном потоке ────────────────────────── */

/** Подставной DeepSeek: на каждый шаг — заготовленные куски потока. */
function fakeDeepseek(steps: DsChunk[][]) {
  const seen: DsMessage[][] = [];
  let i = 0;
  const create = async (messages: DsMessage[]) => {
    seen.push(messages);
    const chunks = steps[Math.min(i++, steps.length - 1)];
    return (async function* () {
      for (const c of chunks) yield c;
    })();
  };
  return { create, seen, calls: () => i };
}
const delta = (d: NonNullable<DsChunk['choices'][number]['delta']>, finish: string | null = null): DsChunk => ({ choices: [{ delta: d, finish_reason: finish }] });

describe('runDeepseekAgentLoop', () => {
  it('assembles a tool call sent in pieces, returns the reasoning with it, one tool message per call', async () => {
    const ds = fakeDeepseek([
      [
        delta({ reasoning_content: 'Нужно посчитать ' }),
        delta({ reasoning_content: 'пеню.' }),
        delta({ tool_calls: [{ index: 0, id: 'call_a', type: 'function', function: { name: 'calculate', arguments: '{"operation":"eva' } }] }),
        delta({ tool_calls: [{ index: 0, function: { arguments: 'luate","expression":"2+2"}' } }] }),
        delta({ tool_calls: [{ index: 1, id: 'call_b', type: 'function', function: { name: 'calculate', arguments: '{"operation":"evaluate","expression":"3*3"}' } }] }),
        { choices: [{ delta: {}, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 100, completion_tokens: 20 } },
      ],
      [delta({ content: 'Итого ' }), delta({ content: '4 и 9.' }), delta({}, 'stop')],
    ]);
    const inputs: unknown[] = [];
    const usage: number[] = [];
    const tokens: string[] = [];
    const answer = await runDeepseekAgentLoop({
      create: ds.create,
      messages: [
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'посчитай' },
      ],
      agent: { tools: [], instructions: '', run: async (c) => (inputs.push(c.input), { content: `ok ${c.id}` }) },
      onToken: (d) => tokens.push(d),
      onUsage: (u) => usage.push(u.prompt_tokens ?? 0),
    });
    assert.equal(answer, 'Итого 4 и 9.');
    assert.deepEqual(inputs, [
      { operation: 'evaluate', expression: '2+2' },
      { operation: 'evaluate', expression: '3*3' },
    ]);
    const second = ds.seen[1];
    const asst = second[2] as Extract<DsMessage, { role: 'assistant' }>;
    assert.equal(asst.role, 'assistant');
    assert.equal(asst.reasoning_content, 'Нужно посчитать пеню.', 'размышления возвращаются DeepSeek — без них 400');
    assert.deepEqual(asst.tool_calls?.map((c) => c.id), ['call_a', 'call_b']);
    assert.deepEqual(second.slice(3).map((m) => (m as { tool_call_id: string }).tool_call_id), ['call_a', 'call_b']);
    assert.equal(ds.seen[0].length, 2, 'первый шаг не видит чужих дописок');
    assert.deepEqual(usage, [100]);
    assert.equal(tokens.join(''), 'Итого 4 и 9.');
  });

  it('broken JSON arguments go back as an error, not into the tool; rounds are capped', async () => {
    const broken = fakeDeepseek([
      [delta({ tool_calls: [{ index: 0, id: 'c1', type: 'function', function: { name: 'calculate', arguments: '{"operation": ' } }] }, 'tool_calls')],
      [delta({ content: 'Не получилось посчитать.' }, 'stop')],
    ]);
    let runs = 0;
    await runDeepseekAgentLoop({
      create: broken.create,
      messages: [{ role: 'user', content: 'q' }],
      agent: { tools: [], instructions: '', run: async () => (runs++, { content: 'r' }) },
    });
    assert.equal(runs, 0);
    assert.match((broken.seen[1][2] as { content: string }).content, /INVALID_JSON/);

    const forever = fakeDeepseek([[delta({ tool_calls: [{ index: 0, id: 'x', type: 'function', function: { name: 'search_law', arguments: '{"query":"x"}' } }] }, 'tool_calls')]]);
    await assert.rejects(
      runDeepseekAgentLoop({
        create: forever.create,
        messages: [{ role: 'user', content: 'q' }],
        agent: { tools: [], instructions: '', run: async () => (runs++, { content: 'r' }) },
      }),
      /did not finish within the tool limit/,
    );
    assert.equal(runs, 6, 'инструменты — не больше 6 раундов');
    assert.ok(forever.calls() <= 8);
  });
});

describe('Sources: only provisions the answer actually cites', () => {
  it('reads article numbers after a provision word, not bare amounts or days', () => {
    // Фрагмент ответа DeepSeek из живого прогона 31.10.
    const answer = `Пеня по п. 5 договора за 45 дней составляет 108 000 000 сум (1% × 45 дней × 240 000 000 сум).
Закон устанавливает 0,4% в день с пределом 50% (ст. 32 Закона «О договорно-правовой базе»), а суд вправе снизить неустойку по ст. 326 ГК РУз.
По ст. 146 ГК РУз течение срока начинается на следующий день. Неустойка определяется договором (статьи 260, 261 и 263 ГК),
ориентир — учётная ставка (ст. 327 ГК РУз). Под § 433 BGB и s.14 Sale of Goods Act; Article 125.`;
    const cited = citedProvisionNumbers(answer);
    for (const n of ['32', '326', '146', '260', '261', '263', '327', '433', '14', '125', '5']) assert.ok(cited.has(n), `нет ${n}`);
    for (const n of ['45', '108', '240', '50', '159', '332', '1']) assert.ok(!cited.has(n), `лишнее ${n}`);
    assert.ok(!citedProvisionNumbers('Это текст. 5 дней').has('5'), '«ст.» внутри слова «текст.» — не ссылка');
  });

  it('takes the number from a Sources label', () => {
    assert.equal(refNumber('ст.261'), '261');
    assert.equal(refNumber('Статья 356'), '356');
    assert.equal(refNumber('§ 312g'), '312g');
    assert.equal(refNumber('п.5'), '5');
    assert.equal(refNumber('Article 125'), '125');
    assert.equal(refNumber('Глава'), null);
  });
});

/* ── агент чинит ссылки в разборе ─────────────────────────────────────── */

describe('repairFindingCitations', () => {
  type Sev = 'High' | 'Medium' | 'Low';
  const demoted = (title: string, citation: string) => ({ severity: 'Low' as Sev, title, citation, unitId: null, unverified: true });
  const ok = { severity: 'High' as Sev, title: 'Срок оплаты', citation: 'ст. 356 ГК', unitId: 'lu_uz_agent_st-356', unverified: false };
  const agentSays = (json: unknown) => async () => JSON.stringify(json);

  it('restores the original severity and a CODE-confirmed citation; the rest stays demoted', async () => {
    const findings = [ok, demoted('Одностороннее изменение цены', 'ст. 999 ГК'), demoted('Коммерческий риск', '—')];
    let prompt = '';
    const res = await repairFindingCitations(db, {
      findings,
      originalSeverity: ['High', 'High', 'Medium'],
      jurisdiction: 'UZ',
      clauses: new Map(),
      deps: {
        runAgent: async (o) => ((prompt = o.user), JSON.stringify({ fixes: [{ index: 1, unit_id: 'lu_uz_agent_st-356', citation: 'ст. 356 ГК РУз' }, { index: 2, unit_id: null }] })),
        judge: async () => true,
      },
    });
    assert.equal(res.repaired, 1);
    assert.equal(res.attempted, 2);
    assert.match(prompt, /#1 — Одностороннее изменение цены/);
    assert.ok(!prompt.includes('#0'), 'подтверждённые находки агенту не отдаются');
    assert.deepEqual(
      { s: res.findings[1].severity, u: res.findings[1].unverified, id: res.findings[1].unitId, c: res.findings[1].citation },
      { s: 'High', u: false, id: 'lu_uz_agent_st-356', c: 'ст. 356 ГК РУз' },
    );
    assert.equal(res.findings[2].unverified, true, 'без нормы — остаётся пониженной');
    assert.equal(res.findings[2].severity, 'Low');
    assert.deepEqual(res.findings[0], ok);
  });

  it('fails closed: judge says no, unknown unit, wrong index, broken JSON, agent error — nothing changes', async () => {
    const findings = [demoted('Цена', 'ст. 999 ГК')];
    const base = { findings, originalSeverity: ['High' as Sev], jurisdiction: 'UZ' as const };
    const fix = { fixes: [{ index: 0, unit_id: 'lu_uz_agent_st-356' }] };
    const cases = [
      { runAgent: agentSays(fix), judge: async () => false },
      { runAgent: agentSays(fix), judge: async () => null },
      { runAgent: agentSays({ fixes: [{ index: 0, unit_id: 'lu_uz_nope_st-1' }] }), judge: async () => true },
      { runAgent: agentSays({ fixes: [{ index: 5, unit_id: 'lu_uz_agent_st-356' }] }), judge: async () => true },
      { runAgent: agentSays({ fixes: [{ index: 0, unit_id: "x'; DROP TABLE legal_units; --" }] }), judge: async () => true },
      { runAgent: async () => 'не JSON', judge: async () => true },
      { runAgent: async () => { throw new Error('API down'); }, judge: async () => true },
    ];
    for (const deps of cases) {
      const res = await repairFindingCitations(db, { ...base, deps: deps as never });
      assert.equal(res.repaired, 0);
      assert.equal(res.findings[0].unverified, true);
      assert.equal(res.findings[0].severity, 'Low');
    }
    // Норма другой страны не подходит, даже если судья «за».
    const kz = await repairFindingCitations(db, { ...base, jurisdiction: 'KZ', deps: { runAgent: agentSays(fix), judge: async () => true } });
    assert.equal(kz.repaired, 0);
  });

  it('does nothing (and calls no model) when every citation is already confirmed', async () => {
    let called = false;
    const res = await repairFindingCitations(db, {
      findings: [ok],
      originalSeverity: ['High'],
      jurisdiction: 'UZ',
      deps: { runAgent: async () => ((called = true), '') },
    });
    assert.equal(called, false);
    assert.equal(res.attempted, 0);
  });
});

/* ── память фирмы: поиск по документам пользователя и команды ─────────── */

describe('search_documents (firm memory)', async () => {
  // owner — владелец команды, member — активный участник, stranger — посторонний.
  for (const [id, email] of [['u_owner', 'owner@t.local'], ['u_member', 'member@t.local'], ['u_stranger', 'stranger@t.local']]) {
    await db.query(`INSERT INTO users (id, email, password_hash, name, initials) VALUES ($1, $2, 'x', $1, 'U')`, [id, email]);
  }
  await db.query(
    `INSERT INTO team_members (id, owner_user_id, member_user_id, name, email, role, status) VALUES ('tm1', 'u_owner', 'u_member', 'M', 'member@t.local', 'viewer', 'active')`,
  );
  async function contract(docId: string, owner: string, name: string, counterparty: string, text: string, shared = false) {
    await db.query(
      `INSERT INTO documents (id, user_id, name, counterparty, status, risk, jurisdiction, team_shared) VALUES ($1, $2, $3, $4, 'Reviewed', 'Low', 'UZ', $5)`,
      [docId, owner, name, counterparty, shared],
    );
    await db.query(
      `INSERT INTO uploads (id, user_id, file_name, size_bytes, storage, storage_key, url, extracted_text) VALUES ($1, $2, $3, 10, 'local', $1, NULL, $4)`,
      [`up_${docId}`, owner, name, await encText(db, owner, text)],
    );
    await db.query(
      `INSERT INTO analyses (id, user_id, document_id, file_name, file_size, summary, risk_score, risk_level, clauses_reviewed, document_blocks, upload_id)
       VALUES ($1, $2, $3, $4, '1 KB', $5, 10, 'Low', 3, $6::jsonb, $7)`,
      [`an_${docId}`, owner, docId, name, await encText(db, owner, `Разбор: ${name}`), await encJsonForJsonb(db, owner, []), `up_${docId}`],
    );
  }
  await contract('d_member', 'u_member', 'Поставка сахара 2025.docx', 'ООО «Нур Маркет»', 'п. 7. Пеня за просрочку оплаты — 0,1% в день, не более 10% суммы.');
  await contract('d_shared', 'u_owner', 'Типовой договор поставки.docx', '—', 'п. 5. Неустойка за просрочку оплаты составляет 0,2% за каждый день.', true);
  await contract('d_private', 'u_owner', 'Секретный договор с Нур Маркет.docx', 'ООО «Нур Маркет»', 'Тайные условия: неустойка 5%.');
  await contract('d_stranger', 'u_stranger', 'Чужой договор Нур Маркет.docx', 'ООО «Нур Маркет»', 'Неустойка 3%.');
  await db.query(`INSERT INTO saved_templates (id, user_id, title, content) VALUES ('st_1', 'u_member', 'Претензия Нур Маркет', $1)`, [
    await encText(db, 'u_member', 'Требуем уплатить неустойку за просрочку оплаты.'),
  ]);

  const memberRunner = () => {
    const steps: ChatStep[] = [];
    const r = createChatToolRunner({ db, userId: 'u_member', jurisdiction: 'UZ', documents: [], onStep: (x) => steps.push(x), toRefs: async () => [] });
    return { ...r, steps };
  };

  it('finds the member\'s own documents, saved documents and the team\'s shared ones — never private or foreign ones', async () => {
    const r = memberRunner();
    const res = await r.run({ id: 'a', name: 'search_documents', input: { query: 'неустойка просрочка оплаты Нур Маркет', limit: 8 } });
    assert.match(res.content, /\[d_member\]/);
    assert.match(res.content, /\[d_shared\].*shared by u_owner/);
    assert.match(res.content, /\[st_1\]/);
    assert.match(res.content, /0,1% в день/);
    assert.ok(!res.content.includes('d_private') && !res.content.includes('Тайные'), 'личный документ владельца не виден');
    assert.ok(!res.content.includes('d_stranger') && !res.content.includes('Чужой'), 'чужой документ не виден');
    const done = r.steps.at(-1);
    assert.equal(done?.data?.tool, 'search_documents');
    assert.equal(done?.data?.found, 3);
  });

  it('opens only documents from the allowed set', async () => {
    const r = memberRunner();
    const shared = await r.run({ id: 'b', name: 'search_documents', input: { document_id: 'd_shared', query: 'неустойка' } });
    assert.match(shared.content, /0,2% за каждый день/);
    const priv = await r.run({ id: 'c', name: 'search_documents', input: { document_id: 'd_private' } });
    assert.equal(priv.isError, true);
    assert.ok(!priv.content.includes('Тайные'));
    const stranger = await r.run({ id: 'd', name: 'search_documents', input: { document_id: 'd_stranger' } });
    assert.equal(stranger.isError, true);
  });

  it('the team owner does not see a member\'s private documents; no user — no tool', async () => {
    const owner = createChatToolRunner({ db, userId: 'u_owner', jurisdiction: 'UZ', documents: [], toRefs: async () => [] });
    const res = await owner.run({ id: 'e', name: 'search_documents', input: { query: 'Поставка сахара 2025' } });
    assert.ok(!res.content.includes('d_member'));
    const anon = createChatToolRunner({ db, jurisdiction: 'UZ', documents: [], toRefs: async () => [] });
    const none = await anon.run({ id: 'f', name: 'search_documents', input: { query: 'неустойка' } });
    assert.equal(none.isError, true);
  });
});

/* ── действия с документом: правка пункта по кнопке пользователя ──────── */

describe('agent document actions (propose_edit → Accept)', () => {
  // Разбор владельца команды из блока «память фирмы»: an_d_shared, текст исходного файла —
  // «п. 5. Неустойка за просрочку оплаты составляет 0,2% за каждый день.»
  const CLAUSE = 'п. 5. Неустойка за просрочку оплаты составляет 0,2% за каждый день.';
  const NEW = 'п. 5. Неустойка за просрочку оплаты составляет 0,1% за каждый день, но не более 10% суммы.';

  it('propose_edit tells the agent the real button label in every UI language, not English only', async () => {
    const target = await loadEditTarget(db, 'u_owner', 'an_d_shared');
    const r = createChatToolRunner({ db, jurisdiction: 'UZ', documents: [], toRefs: async () => [], editTarget: target ?? undefined, onProposal: () => undefined });
    const ok = await r.run({ id: 'lbl', name: 'propose_edit', input: { clause: CLAUSE, new_text: NEW, reason: 'метки' } });
    for (const l of Object.values(UI_LABELS.acceptEdit)) assert.ok(ok.content.includes(l), l);
    assert.match(ok.content, /language of your answer/);
    assert.ok(!/an Accept button/.test(ok.content));
  });

  it('propose_edit: needs an editable review, an exact clause from the contract, and never changes the document itself', async () => {
    const target = await loadEditTarget(db, 'u_owner', 'an_d_shared');
    assert.ok(target, 'владелец может править');
    assert.equal(await loadEditTarget(db, 'u_member', 'an_d_shared'), null, 'участник «только чтение» — нет');
    assert.equal(await loadEditTarget(db, 'u_stranger', 'an_d_shared'), null, 'посторонний — нет');

    const proposals: unknown[] = [];
    const r = createChatToolRunner({ db, jurisdiction: 'UZ', documents: [], editTarget: target ?? undefined, onProposal: (p) => proposals.push(p), toRefs: async () => [] });
    const ok = await r.run({ id: 'a', name: 'propose_edit', input: { clause: CLAUSE.replace(/ /g, '  '), new_text: NEW, reason: 'пеня выше законной' } });
    assert.match(ok.content, /^PROPOSED/);
    const again = await r.run({ id: 'b', name: 'propose_edit', input: { clause: CLAUSE, new_text: NEW, reason: 'повтор' } });
    assert.match(again.content, /^PROPOSED/);
    assert.equal(proposals.length, 1, 'одинаковая правка — одна карточка');
    const bad = await r.run({ id: 'c', name: 'propose_edit', input: { clause: 'п. 9. Такого пункта нет.', new_text: 'x', reason: 'y' } });
    assert.equal(bad.isError, true);
    assert.match(bad.content, /QUOTE_NOT_FOUND/);
    const none = await createChatToolRunner({ db, jurisdiction: 'UZ', documents: [], toRefs: async () => [] }).run({ id: 'd', name: 'propose_edit', input: { clause: CLAUSE, new_text: NEW, reason: 'z' } });
    assert.match(none.content, /^NOT_AVAILABLE/);
    const rl = await db.query('SELECT count(*)::int AS n FROM redlines WHERE analysis_id = $1', ['an_d_shared']);
    assert.equal(rl.rows[0].n, 0, 'предложение агента документ не меняет');
  });

  it('Accept: adds an accepted edit with a slot in the document, applies to the full text, no duplicates, rights enforced', async () => {
    const first = await addEditToAnalysis(db, 'u_owner', 'an_d_shared', { delText: CLAUSE, insText: NEW, status: 'accepted' });
    assert.equal(first.created, true);
    assert.equal(first.redline.status, 'accepted');
    const repeat = await addEditToAnalysis(db, 'u_owner', 'an_d_shared', { delText: `  ${CLAUSE} `, insText: NEW, status: 'accepted' });
    assert.equal(repeat.created, false, 'повторное нажатие — та же правка');
    assert.equal(repeat.redline.id, first.redline.id);

    const row = await db.query('SELECT document_blocks FROM analyses WHERE id = $1', ['an_d_shared']);
    const blocks = (await decJsonFromJsonb(db, 'u_owner', row.rows[0].document_blocks)) as { segments?: { redlineId?: string }[] }[];
    assert.ok(blocks.some((b) => b.segments?.some((s) => s.redlineId === first.redline.id)), 'слот правки в документе');
    const applied = applyAcceptedRedlines(`Договор.\n${CLAUSE}\nКонец.`, [first.redline]);
    assert.match(applied.text, /0,1% за каждый день, но не более 10%/);
    assert.equal(applied.unapplied.length, 0);

    await assert.rejects(addEditToAnalysis(db, 'u_member', 'an_d_shared', { delText: CLAUSE, insText: 'x', status: 'accepted' }), (e: { status?: number }) => e.status === 403);
    await assert.rejects(addEditToAnalysis(db, 'u_stranger', 'an_d_shared', { delText: CLAUSE, insText: 'x', status: 'accepted' }), (e: { status?: number }) => e.status === 404);
    await assert.rejects(
      addEditToAnalysis(db, 'u_owner', 'an_d_shared', { delText: 'Выдуманный пункт.', insText: 'x', status: 'accepted' }),
      (e: { status?: number; code?: string }) => e.status === 422 && e.code === 'clause_not_found',
    );
  });

  it('after manual edits, the clause also joins the original wording (no false «insert manually»)', async () => {
    await db.query('UPDATE analyses SET original_blocks = $2 WHERE id = $1', ['an_d_shared', await encJsonForJsonb(db, 'u_owner', ['п. 1. Предмет.'])]);
    const clause2 = 'п. 5. Неустойка за просрочку оплаты';
    await addEditToAnalysis(db, 'u_owner', 'an_d_shared', { delText: clause2, insText: 'п. 5. Пеня за просрочку оплаты', status: 'accepted' });
    const row = await db.query('SELECT original_blocks FROM analyses WHERE id = $1', ['an_d_shared']);
    const original = (await decJsonFromJsonb(db, 'u_owner', row.rows[0].original_blocks)) as string[];
    assert.deepEqual(original, ['п. 1. Предмет.', clause2]);
  });

  it('get_review_edits lists the edits; edit cards are appended safely to the reply', async () => {
    const r = createChatToolRunner({ db, jurisdiction: 'UZ', documents: [], review: { analysisId: 'an_d_shared', ownerId: 'u_owner' }, toRefs: async () => [] });
    const out = await r.run({ id: 'a', name: 'get_review_edits', input: {} });
    assert.match(out.content, /status accepted/);
    assert.match(out.content, /0,1% за каждый день/);
    const reply = appendEditBlocks('Готово.', [{ analysisId: 'an_1', delText: 'a ```b', insText: 'c', reason: '' }]);
    assert.match(reply, /^Готово\.\n\n```lexab-edit\n/);
    assert.equal((reply.match(/```/g) ?? []).length, 2, 'обратные кавычки в тексте правки не ломают блок');
  });
});

/* ── сроки с напоминанием на почту, плейбук, сравнение редакций ───────── */

const isoIn = (days: number) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

describe('compare_versions: the code finds the differences', () => {
  it('changed, added and removed clauses; a line break inside a clause is not a change', () => {
    const before = 'Договор\n1. Предмет: поставка сахара.\n2. Цена 240 000 000 сум.\n3. Пеня 0,1% в день, не более 10%.\n4. Споры — в экономическом суде г. Ташкента.';
    const after = 'Договор\n1. Предмет: поставка\nсахара.\n2. Цена 240 000 000 сум.\n3. Пеня 1% в день без ограничения.\n5. Поставщик вправе менять цену в одностороннем порядке.';
    assert.deepEqual(clausesOf('1. Предмет: поставка\nсахара.'), ['1. Предмет: поставка сахара.']);
    const { changes } = diffClauses(before, after);
    assert.deepEqual(
      changes.map((c) => c.kind),
      ['changed', 'removed', 'added'],
    );
    assert.match(JSON.stringify(changes[0]), /0,1%.*1% в день/);
    assert.deepEqual(diffClauses(before, before).changes, []);
  });
});

describe('agent tools: deadlines, playbook, compare (plan rules as in the product)', async () => {
  await db.query(`INSERT INTO subscriptions (user_id, plan) VALUES ('u_owner', 'Pro') ON CONFLICT (user_id) DO UPDATE SET plan = 'Pro'`);
  const owner = (plan: string, extra: Record<string, unknown> = {}) => {
    const reminders: unknown[] = [];
    const steps: ChatStep[] = [];
    const r = createChatToolRunner({
      db,
      userId: 'u_owner',
      plan,
      jurisdiction: 'UZ',
      documents: [],
      review: { analysisId: 'an_d_shared', ownerId: 'u_owner', documentId: 'd_shared', documentName: 'Типовой договор поставки.docx' },
      onReminder: (x) => reminders.push(x),
      onStep: (x) => steps.push(x),
      toRefs: async () => [],
      ...extra,
    });
    return { ...r, reminders, steps };
  };

  it('propose_reminder: Pro only, real future dates, the contract under review by default, never adds by itself', async () => {
    const free = await owner('Free').run({ id: 'a', name: 'propose_reminder', input: { what: 'Оплатить поставку', due_date: isoIn(20) } });
    assert.match(free.content, /^NOT_AVAILABLE/);
    const r = owner('Pro');
    const ok = await r.run({ id: 'b', name: 'propose_reminder', input: { what: 'Оплатить поставку', due_date: isoIn(20).split('-').reverse().join('.'), remind_days_before: 5 } });
    assert.match(ok.content, /^PROPOSED/);
    assert.deepEqual(r.reminders, [{ documentId: 'd_shared', documentName: 'Типовой договор поставки.docx', text: 'Оплатить поставку', dueDate: isoIn(20), remindDaysBefore: 5 }]);
    const past = await r.run({ id: 'c', name: 'propose_reminder', input: { what: 'x', due_date: '2020-01-01' } });
    assert.equal(past.isError, true);
    const n = await db.query("SELECT count(*)::int AS n FROM contract_obligations WHERE source = 'chat'");
    assert.equal(n.rows[0].n, 0, 'предложение агента ничего не добавляет');
    const viewer = createChatToolRunner({ db, userId: 'u_member', plan: 'Pro', jurisdiction: 'UZ', documents: [], review: { analysisId: 'an_d_shared', ownerId: 'u_owner', documentId: 'd_shared' }, toRefs: async () => [] });
    assert.match((await viewer.run({ id: 'd', name: 'propose_reminder', input: { what: 'x', due_date: isoIn(5) } })).content, /^NOT_ALLOWED/);
  });

  it('Add reminder: rights, dates, no duplicates; the email goes out N days before to the person who added it', async () => {
    const first = await addReminderToDocument(db, 'u_owner', 'd_private', { text: 'Оплатить поставку', dueDate: isoIn(10), remindDaysBefore: 14 });
    assert.equal(first.created, true);
    const again = await addReminderToDocument(db, 'u_owner', 'd_private', { text: '  Оплатить   поставку ', dueDate: isoIn(10), remindDaysBefore: 14 });
    assert.equal(again.created, false, 'повтор — без дубля');
    await addReminderToDocument(db, 'u_owner', 'd_private', { text: 'Направить уведомление', dueDate: isoIn(10), remindDaysBefore: 3 });
    await assert.rejects(addReminderToDocument(db, 'u_owner', 'd_private', { text: 'x', dueDate: '2020-01-01', remindDaysBefore: 3 }), (e: { status?: number }) => e.status === 400);
    await assert.rejects(addReminderToDocument(db, 'u_owner', 'd_private', { text: 'x', dueDate: '2026-02-31', remindDaysBefore: 3 }), (e: { status?: number }) => e.status === 400);
    await assert.rejects(addReminderToDocument(db, 'u_member', 'd_shared', { text: 'x', dueDate: isoIn(5), remindDaysBefore: 3 }), (e: { status?: number }) => e.status === 403);
    await assert.rejects(addReminderToDocument(db, 'u_stranger', 'd_private', { text: 'x', dueDate: isoIn(5), remindDaysBefore: 3 }), (e: { status?: number }) => e.status === 404);
    const terms = await db.query("SELECT count(*)::int AS n FROM contract_terms WHERE document_id = 'd_private'");
    assert.equal(terms.rows[0].n, 1, 'договор появился в «Сроках»');

    const logs: string[] = [];
    const orig = console.log;
    console.log = (...a: unknown[]) => void logs.push(a.join(' '));
    try {
      await checkContractDeadlines(db);
    } finally {
      console.log = orig;
    }
    const rows = await db.query<{ text_enc: string; reminded: boolean; remind_days_before: number }>(
      "SELECT text_enc, reminded, remind_days_before FROM contract_obligations WHERE document_id = 'd_private' ORDER BY ord",
    );
    assert.deepEqual(rows.rows.map((r) => [r.remind_days_before, r.reminded]), [
      [14, true],
      [3, false],
    ], 'за 14 дней — уже пора, за 3 — ещё нет');
    assert.ok(logs.some((l) => /would send to o\*\*\*@t\.local: Срок по договору/.test(l)), 'письмо на почту тому, кто добавил');
  });

  it('get_playbook and compare_versions follow the plan; playbook rules come from the team owner', async () => {
    assert.match((await owner('Standard').run({ id: 'a', name: 'get_playbook', input: {} })).content, /^NOT_AVAILABLE/);
    assert.match((await owner('Pro').run({ id: 'b', name: 'get_playbook', input: {} })).content, /^NO_PLAYBOOK/);
    await db.query(`INSERT INTO playbooks (id, owner_user_id, name, jurisdiction) VALUES ('pb1', 'u_owner', 'Позиции фирмы', 'UZ')`);
    for (const [i, t] of ['Неустойка — не более 0,1% в день и 10% суммы.', 'Ответственность ограничена ценой договора.'].entries()) {
      await db.query('INSERT INTO playbook_rules (id, playbook_id, ord, text_enc) VALUES ($1, $2, $3, $4)', [`pr${i}`, 'pb1', i, await encText(db, 'u_owner', t)]);
    }
    const all = await owner('Pro').run({ id: 'c', name: 'get_playbook', input: {} });
    assert.match(all.content, /Позиции фирмы[\s\S]*0,1% в день[\s\S]*ценой договора/);
    const topic = await owner('Pro').run({ id: 'd', name: 'get_playbook', input: { topic: 'неустойка' } });
    assert.ok(topic.content.includes('0,1%') && !topic.content.includes('ценой договора'));

    assert.match((await owner('Standard').run({ id: 'e', name: 'compare_versions', input: { old: 'old.docx' } })).content, /^NOT_AVAILABLE/);
    const docs = [
      { name: 'Договор v1.docx', text: '1. Цена 100.\n2. Пеня 0,1%.', pure: true },
      { name: 'Договор v2.docx', text: '1. Цена 100.\n2. Пеня 1%.', pure: true },
    ];
    const cmp = await owner('Pro', { documents: docs, review: undefined }).run({ id: 'f', name: 'compare_versions', input: { old: 'v1', new: 'v2' } });
    assert.match(cmp.content, /1 difference[\s\S]*CHANGED[\s\S]*0,1%[\s\S]*1%/);
  });

  it('reminder cards are appended safely to the reply', () => {
    const reply = appendReminderBlocks('Готово.', [{ documentId: 'd1', documentName: 'a`b', text: 't', dueDate: '2026-12-01', remindDaysBefore: 3 }]);
    assert.match(reply, /```lexab-reminder\n/);
    assert.equal((reply.match(/```/g) ?? []).length, 2);
  });
});

describe('long answers (bilingual contracts) are never cut silently', () => {
  it('Claude: max_tokens on the final answer adds an honest note', async () => {
    const model = fakeModel([msg([text('ДОГОВОР / SHARTNOMA … п. 7')], 'max_tokens')]);
    const tokens: string[] = [];
    const out = await runAgentLoop({ start: model.start, messages: [{ role: 'user', content: 'q' }], agent: { tools: [], instructions: '', run: async () => ({ content: '' }) }, onToken: (d) => tokens.push(d) });
    assert.ok(out.endsWith(TRUNCATED_NOTE));
    assert.ok(tokens.join('').endsWith(TRUNCATED_NOTE), 'пользователь видит приписку сразу');
  });

  it('DeepSeek: finish_reason length adds the same note', async () => {
    const ds = fakeDeepseek([[delta({ content: 'ДОГОВОР / SHARTNOMA …' }), delta({}, 'length')]]);
    const out = await runDeepseekAgentLoop({ create: ds.create, messages: [{ role: 'user', content: 'q' }], agent: { tools: [], instructions: '', run: async () => ({ content: '' }) } });
    assert.ok(out.endsWith(TRUNCATED_NOTE));
  });
});

describe('Sources: the reply must cite THIS provision — same number AND same act', () => {
  const GK = 'Гражданский кодекс Республики Узбекистан (часть первая)';
  const TK = 'Трудовой кодекс Республики Узбекистан';
  const LAW670 = '670-I-сон 29.08.1998. О договорно-правовой базе деятельности хозяйствующих субъектов';
  const CB = 'ЗРУ-582-сон 11.11.2019. О Центральном банке Республики Узбекистан (в новой редакции)';
  const PL163 = 'Постановление Пленума Высшего хозяйственного суда (ВХС) № 163 от 15.06.2007 «О некоторых вопросах ответственности»';
  const PL103 = 'Постановление Пленума Высшего хозяйственного суда (ВХС) № 103 от 04.03.2002 «О применении Закона»';
  const UP6079 = 'УП-6079-сон 05.10.2020. Об утверждении Стратегии «Цифровой Узбекистан-2030»';
  const UP60 = 'УП-60-сон 28.01.2022. О Стратегии развития';

  it('«ст. 333 ГК» is the Civil Code article, not article 333 of the Labour Code (live bug 2026-11-08)', () => {
    const text = '- **Ст. 333 ГК** — для предпринимателя ответственность наступает без вины, кроме форс-мажора.';
    assert.equal(citesProvision(text, '333', GK, 'UZ'), true);
    assert.equal(citesProvision(text, '333', TK, 'UZ'), false);
  });

  it('lists «статьи 326 и 327 ГК» cover every number; quoted law names are matched too', () => {
    assert.equal(citesProvision('см. статьи 326 и 327 ГК', '327', GK, 'UZ'), true);
    const t = 'ст. 10 Закона «О договорно-правовой базе деятельности хозяйствующих субъектов»';
    assert.equal(citesProvision(t, '10', LAW670, 'UZ'), true);
    assert.equal(citesProvision(t, '10', CB, 'UZ'), false);
  });

  it('Plenum and decree points match by court/number and decree number', () => {
    const p = 'п. 4 постановления Пленума ВХС № 163 — нижний предел снижения';
    assert.equal(citesProvision(p, '4', PL163, 'UZ'), true);
    assert.equal(citesProvision(p, '4', PL103, 'UZ'), false);
    assert.equal(citesProvision('п. 5 УП-6079 о цифровизации', '5', UP6079, 'UZ'), true);
    assert.equal(citesProvision('п. 5 УП-6079 о цифровизации', '5', UP60, 'UZ'), false, 'УП-60 ≠ УП-6079');
    // «п. 2 ст. 260 ГК» — подпункт статьи, а не пункт 2 Пленума.
    assert.equal(citesProvision('п. 2 ст. 260 ГК', '2', PL163, 'UZ'), false);
  });

  it('no act next to the number → old rule (number match keeps the source); number absent → dropped', () => {
    assert.equal(citesProvision('Пеня — по ст. 32: 0,4% в день.', '32', LAW670, 'UZ'), true);
    assert.equal(citesProvision('Пеня — по ст. 32: 0,4% в день.', '33', LAW670, 'UZ'), false);
    // Страны без таблицы алиасов — прежнее правило.
    assert.equal(citesProvision('Under s.14 the goods must be of satisfactory quality.', '14', 'Sale of Goods Act 1979', 'UK'), true);
  });

  it('agent instructions name the edit button in every UI language', () => {
    for (const l of Object.values(UI_LABELS.acceptEdit)) assert.ok(CHAT_AGENT_INSTRUCTIONS.includes(l), l);
    const reminder = CHAT_TOOLS.find((t) => t.name === 'propose_reminder');
    for (const l of Object.values(UI_LABELS.addReminder)) assert.ok(String(reminder?.description).includes(l), l);
    assert.ok(!/«Add reminder» button|an Accept button|presses Accept/.test(JSON.stringify(CHAT_TOOLS) + CHAT_AGENT_INSTRUCTIONS));
  });
});
