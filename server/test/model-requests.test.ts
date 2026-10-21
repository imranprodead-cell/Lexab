/**
 * Что продукт РЕАЛЬНО шлёт моделям Claude — без единого платного вызова.
 *
 * Локальный подставной сервер Anthropic (ANTHROPIC_BASE_URL) отклоняет запрос
 * ровно так, как его отклонил бы настоящий API у моделей 5.5 (правила — из
 * документации миграции и из бесплатного GET /v1/models: какие режимы
 * размышлений есть у модели, что temperature у Haiku 5.5 только по умолчанию,
 * что у Haiku нет серверной страховки и т.д.). Через него прогоняется код
 * продукта: анализ, чат, сравнение, шаблон, черновик, сводка, «улучшить
 * запрос», переписчик поиска, судья цитат, OCR — по каждому тарифу.
 *
 * Зачем: при переходе 2026-10-21 простая замена id сломала бы судью цитат
 * (temperature: 0 → 400 → все цитаты «не подтверждены») и переписчик поиска —
 * молча, без ошибки для пользователя. Этот тест падает, а не напоминает.
 */
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import test, { after } from 'node:test';

/** Тело запроса к API — произвольный JSON; поля читаем по документации. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;

interface Seen {
  body: Json;
  beta: string;
  /** Текст отказа, если подставной API отклонил запрос (400). */
  rejected: string | null;
}
const seen: Seen[] = [];

const MAX_OUTPUT = 128_000; // GET /v1/models → max_tokens у всех трёх моделей
const THINKING: Record<string, string[]> = {
  // GET /v1/models → capabilities.thinking.types (2026-10-21)
  'claude-opus-5-5': ['adaptive'],
  'claude-sonnet-5-5': ['adaptive', 'between_tools'],
  'claude-haiku-5-5': ['adaptive', 'disabled'],
};

/** Правила новых моделей. null — запрос принят. */
function reject(body: Json, beta: string): string | null {
  const model = String(body.model);
  const allowed = THINKING[model];
  if (!allowed) return `unknown model ${model} (старые id должны быть убраны)`;
  const haiku = model === 'claude-haiku-5-5';
  if (haiku) {
    if (body.temperature !== undefined && body.temperature !== 1) return 'haiku-5-5: temperature must be the default (1)';
  } else if (body.temperature !== undefined) return `${model}: sampling parameters are not supported`;
  if (body.top_p !== undefined || body.top_k !== undefined) return 'top_p/top_k are not supported';
  const thinkingType = body.thinking?.type ?? 'adaptive';
  if (!allowed.includes(thinkingType)) return `"thinking.type.${thinkingType}" is not supported for this model`;
  const effort = body.output_config?.effort;
  if ((thinkingType === 'disabled' || thinkingType === 'between_tools') && (effort === 'xhigh' || effort === 'max')) {
    return `effort '${effort}' is not supported when thinking is disabled`;
  }
  if (['any', 'tool'].includes(body.tool_choice?.type) && !haiku) return 'tool_choice any/tool is not supported';
  const last = body.messages?.[body.messages.length - 1];
  if (last?.role === 'assistant') return 'assistant prefill is not supported';
  if (typeof body.max_tokens !== 'number' || body.max_tokens > MAX_OUTPUT) return `max_tokens ${body.max_tokens} out of range`;
  if (body.fallbacks !== undefined) {
    if (haiku && Array.isArray(body.fallbacks)) return 'haiku-5-5: fallback models are not supported';
    if (body.fallbacks === 'default' && !beta.includes('server-side-fallback-2026-07-01')) return 'fallbacks:"default" needs server-side-fallback-2026-07-01';
    if (Array.isArray(body.fallbacks) && model === 'claude-sonnet-5-5') return 'sonnet-5-5 accepts only fallbacks:"default"';
  }
  return null;
}

/** Ответ под задачу: по схеме структурированного вывода, иначе текст. */
function answerFor(body: Json): string {
  const props = body.output_config?.format?.schema?.properties ?? {};
  if ('queries' in props) return JSON.stringify({ queries: ['implied term satisfactory quality', 'Consumer Rights Act 2015 s.9'] });
  if ('supported' in props) return JSON.stringify({ supported: true });
  if ('riskScore' in props) {
    return JSON.stringify({
      summary: 'Сводка.', riskScore: 70, riskLevel: 'High', clausesReviewed: 3,
      findings: [{ severity: 'High', title: 'Неустойка без предела', citation: 'ст. 260 ГК', unitId: '', redlineId: 'r1', playbookDeviation: false }],
      redlines: [{ id: 'r1', delText: '1% в день', insText: '0,1% в день', severity: 'High' }],
      document: [{ type: 'heading', text: '1. Предмет' }, { type: 'paragraph', segments: ['Поставщик поставляет товар.'] }],
      counterparty: null, terms: null,
    });
  }
  if ('changes' in props) {
    return JSON.stringify({ summary: 'Одна правка.', changes: [{ heading: '5', before: '1%', after: '0,1%', comment: 'смягчено', kind: 'modified', severity: 'Medium' }] });
  }
  if ('title' in props && 'document' in props) {
    return JSON.stringify({ title: 'Договор', summary: 'Черновик.', document: [{ type: 'heading', text: '1. Предмет' }, { type: 'paragraph', segments: ['Текст.'] }] });
  }
  return 'Ответ модели: договор содержит рискованные пункты 5.1 и 6.2.';
}

function sse(res: http.ServerResponse, model: string, text: string): void {
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  const ev = (type: string, data: unknown) => res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
  ev('message_start', {
    type: 'message_start',
    message: { id: 'msg_test', type: 'message', role: 'assistant', model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 0 } },
  });
  ev('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } });
  // Двумя кусками — проверяем и потоковую выдачу в чате.
  const half = Math.ceil(text.length / 2);
  ev('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: text.slice(0, half) } });
  ev('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: text.slice(half) } });
  ev('content_block_stop', { type: 'content_block_stop', index: 0 });
  ev('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 20 } });
  ev('message_stop', { type: 'message_stop' });
  res.end();
}

const server = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    const body = JSON.parse(raw || '{}') as Json;
    const beta = String(req.headers['anthropic-beta'] ?? '');
    const rejected = reject(body, beta);
    seen.push({ body, beta, rejected });
    if (rejected) {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: rejected } }));
      return;
    }
    const text = answerFor(body);
    if (body.stream) return sse(res, body.model, text);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      id: 'msg_test', type: 'message', role: 'assistant', model: body.model,
      content: [{ type: 'text', text }], stop_reason: 'end_turn', stop_sequence: null,
      usage: { input_tokens: 10, output_tokens: 20 },
    }));
  });
});
await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
const port = (server.address() as AddressInfo).port;
server.unref();
after(() => server.close());

// Окружение — ДО импорта кода продукта (config читается при загрузке модуля).
process.env.ANTHROPIC_API_KEY = 'test-key';
process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${port}`;
process.env.DEEPSEEK_API_KEY = ''; // Free → Haiku, «улучшить запрос» → Anthropic
process.env.RAG_VALIDATE_MODEL = ''; // судья цитат — модель по умолчанию
for (const k of ['ANTHROPIC_MODEL', 'ANTHROPIC_MODEL_FREE', 'ANTHROPIC_MODEL_STANDARD', 'ANTHROPIC_MODEL_PRO', 'ANTHROPIC_MODEL_BUSINESS', 'ANTHROPIC_MODEL_ENTERPRISE', 'MODEL_FREE', 'OCR_MODEL']) {
  delete process.env[k];
}
const llm = await import('../src/llm.ts');
const { rewriteQuery } = await import('../src/rag/retrieve.ts');
const { validateFindings } = await import('../src/rag/validate-citations.ts');
const { buildSimplePdf } = await import('../src/lib/pdf.ts');

/** Запросы, ушедшие за время fn; падает, если подставной API хоть что-то отклонил. */
async function capture(fn: () => Promise<unknown>): Promise<Seen[]> {
  const from = seen.length;
  await fn();
  const got = seen.slice(from);
  const bad = got.filter((s) => s.rejected);
  assert.deepEqual(bad.map((s) => `${s.body.model}: ${s.rejected}`), [], 'запрос отклонён бы настоящим API');
  assert.ok(got.length > 0, 'ни одного запроса к модели');
  return got;
}

const CONTRACT = 'ДОГОВОР ПОСТАВКИ. 5.1. Пеня 1% в день без ограничения. 6.2. Поставщик вправе расторгнуть договор без причин.';

/** Большая модель тарифа: размышления adaptive, effort явно, страховка от ложного отказа. */
function assertBigModel(s: Seen, model: string, effort: string, maxTokens?: number): void {
  assert.equal(s.body.model, model);
  assert.equal(s.body.thinking?.type, 'adaptive');
  assert.equal(s.body.output_config?.effort, effort);
  assert.equal(s.body.fallbacks, 'default');
  assert.match(s.beta, /server-side-fallback-2026-07-01/);
  if (maxTokens) assert.equal(s.body.max_tokens, maxTokens);
}
/** Haiku: размышления выключены (как у Haiku 4.5), без temperature, без страховки. */
function assertHaiku(s: Seen, maxTokens?: number): void {
  assert.equal(s.body.model, 'claude-haiku-5-5');
  assert.equal(s.body.thinking?.type, 'disabled');
  assert.equal(s.body.temperature, undefined);
  assert.equal(s.body.fallbacks, undefined);
  if (maxTokens) assert.equal(s.body.max_tokens, maxTokens);
}

test('тарифы → модели: Free/Standard/Pro/Business/Enterprise', () => {
  assert.equal(llm.modelForPlan('Free'), 'claude-haiku-5-5'); // без DeepSeek-ключа
  assert.equal(llm.modelForPlan('Standard'), 'claude-sonnet-5-5');
  assert.equal(llm.modelForPlan('Pro'), 'claude-sonnet-5-5');
  assert.equal(llm.modelForPlan('Business'), 'claude-opus-5-5');
  assert.equal(llm.modelForPlan('Enterprise'), 'claude-opus-5-5');
  assert.equal(llm.modelForPlan(null), 'claude-opus-5-5');
});

test('анализ договора по каждому тарифу', async () => {
  for (const [plan, model] of [['Business', 'claude-opus-5-5'], ['Enterprise', 'claude-opus-5-5'], ['Standard', 'claude-sonnet-5-5'], ['Pro', 'claude-sonnet-5-5']] as const) {
    let result: Awaited<ReturnType<typeof llm.generateAnalysis>> | undefined;
    const [s] = await capture(async () => {
      result = await llm.generateAnalysis({ fileName: 'd.txt', text: CONTRACT, jurisdiction: 'Uzbekistan', plan });
    });
    assertBigModel(s, model, 'high', 32_000);
    assert.equal(result?.findings.length, 1);
  }
  const [free] = await capture(() => llm.generateAnalysis({ fileName: 'd.txt', text: CONTRACT, plan: 'Free' }));
  assertHaiku(free, 32_000);
  assert.equal(free.body.output_config?.effort, undefined);
});

test('чат по тарифам: потоковая выдача, effort medium', async () => {
  for (const [plan, model] of [['Pro', 'claude-sonnet-5-5'], ['Business', 'claude-opus-5-5'], ['Free', 'claude-haiku-5-5']] as const) {
    let streamed = '';
    let reply = '';
    const [s] = await capture(async () => {
      reply = await llm.generateChatReply([], 'Что опасно?', (d: string) => (streamed += d), CONTRACT, 'Uzbekistan', plan, null, null);
    });
    if (model === 'claude-haiku-5-5') assertHaiku(s, 4096);
    else assertBigModel(s, model, 'medium', 4096);
    assert.ok(reply.length > 0);
    assert.equal(streamed, reply);
  }
});

test('сравнение, шаблон, черновик: потолок 32 000 (Opus 5.5 упирался в 16 000)', async () => {
  const [c] = await capture(() => llm.generateCompare(CONTRACT, CONTRACT.replace('1%', '0,1%'), 'a', 'b', 'Business'));
  assertBigModel(c, 'claude-opus-5-5', 'high', 32_000);
  const [t] = await capture(() => llm.generateTemplateDraft('NDA', 'Mutual NDA', { partyA: 'A', partyB: 'B', jurisdiction: 'UK', term: '2y', details: '-' }, 'Business'));
  assertBigModel(t, 'claude-opus-5-5', 'high', 32_000);
  const [d] = await capture(() => llm.generateContractDraft('Договор уборки офиса', 'Uzbekistan', 'Standard'));
  assertBigModel(d, 'claude-sonnet-5-5', 'high', 32_000);
});

test('служебные вызовы на Haiku 5.5: сводка, «улучшить запрос», OCR', async () => {
  let summary: string | null = null;
  const [s] = await capture(async () => {
    summary = await llm.generateHistorySummary(null, [{ role: 'user', text: 'Пеня 1% в день — много?' }], 'Pro');
  });
  assertHaiku(s, 800);
  assert.ok(summary);
  const [p] = await capture(() => llm.improvePrompt('проверь договор там пеня большая'));
  assertHaiku(p, 2600);
  const pdf = await buildSimplePdf('Скан', [{ heading: '1', text: 'Аренда 12 500 000 сумов' }]);
  const [o] = await capture(() => llm.transcribeScan(pdf));
  assertHaiku(o, 16_000);
});

test('переписчик поиска: Haiku 5.5 без temperature — иначе поиск молча шёл бы без него', async () => {
  let queries: string[] = [];
  const [s] = await capture(async () => {
    queries = await rewriteQuery('can I return faulty goods', 'UK');
  });
  assertHaiku(s, 400);
  assert.deepEqual(queries, ['implied term satisfactory quality', 'Consumer Rights Act 2015 s.9']); // не «сырой» вопрос
});

test('судья цитат: Haiku 5.5 без temperature — иначе ВСЕ цитаты «не подтверждены»', async () => {
  const fakeDb = { query: async () => ({ rows: [{ text: 'Seller must deliver goods of satisfactory quality.', breadcrumb: 'SGA 1979 > s.14' }] }) };
  let out: Awaited<ReturnType<typeof validateFindings>> = [];
  const [s] = await capture(async () => {
    out = await validateFindings(fakeDb as never, [{ severity: 'High', title: 'Quality term', citation: 's.14', unitId: 'uk-sga-14' }], '2026-10-21', 'UK');
  });
  assertHaiku(s, 100);
  assert.equal(out[0].unverified, false);
  assert.equal(out[0].severity, 'High');
});

test('в продукте не осталось ни одного вызова старых моделей', () => {
  const models = new Set(seen.map((s) => s.body.model));
  assert.deepEqual([...models].sort(), ['claude-haiku-5-5', 'claude-opus-5-5', 'claude-sonnet-5-5']);
});
