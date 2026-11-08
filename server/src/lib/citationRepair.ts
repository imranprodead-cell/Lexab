/**
 * Агент чинит ссылки в разборе договора (решение владельца 2026-10-31).
 *
 * Было: находка, чью ссылку на закон проверка не подтвердила, понижалась до
 * Low и помечалась unverified (правило №4). Вживую 30.10 так «низкими» стали
 * 3 из 5 рисков договора поставки, включая одностороннее изменение цены, —
 * часто не потому, что риска нет, а потому, что модель сослалась не на ту
 * статью.
 *
 * Стало: после проверки неподтверждённые находки получает агент с
 * инструментами базы законов (search_law, get_provision, verify_citation) и
 * ищет норму, которая регулирует вопрос. Его ответ — только предложение:
 * норму снова проверяет КОД тем же судьёй, что и при разборе. Подтвердилась —
 * находке возвращаются исходная серьёзность и проверенная ссылка; нет нормы
 * или не подтвердилась — находка остаётся пониженной (правило №4 в силе).
 * Любой сбой агента = ничего не меняем (fail closed).
 */
import type { Db } from '../db.ts';
import { extractJsonObject, runTaskAgent } from '../llm.ts';
import type { JurisdictionCode } from '../rag/types.ts';
import { judgeProvision } from '../rag/validate-citations.ts';
import type { Finding, Severity } from '../types.ts';
import { CHAT_TOOLS, createChatToolRunner, loadUnit, UNIT_ID_RE } from './chatTools.ts';

type F = Omit<Finding, 'id'> & { id?: string };

/** Больше за один разбор не чиним: остальное остаётся пониженным, как раньше. */
const MAX_REPAIR = 6;
/** Разбор не должен ждать агента дольше этого — потом находки отдаются как есть. */
const REPAIR_TIMEOUT_MS = 120_000;

const TOOL_NAMES = new Set(['search_law', 'get_provision', 'verify_citation']);
const REPAIR_TOOLS = CHAT_TOOLS.filter((t) => TOOL_NAMES.has(t.name));

const JURISDICTION_NAME: Record<JurisdictionCode, string> = {
  UK: 'the United Kingdom',
  UZ: 'Uzbekistan',
  KZ: 'Kazakhstan',
  DE: 'Germany',
  US: 'the United States (federal law)',
  CA: 'Québec (Canada)',
  AE: 'the United Arab Emirates',
};

function repairSystem(jurisdiction: JurisdictionCode): string {
  return `You fix legal citations in a contract review under the law of ${JURISDICTION_NAME[jurisdiction]}. Each finding below flags a risk in a contract clause, but its citation could not be confirmed against Lexab's verified statute database.

For each finding, find the provision in the database that governs the issue the finding raises. A finding usually cites the rule that the contract clause contradicts or departs from (for example, a clause with an unlimited penalty → the provision that caps or governs penalties); that rule is the correct citation even though the clause conflicts with it.

How to work:
- Plan first, then call tools. Run the searches for all findings together in ONE step (search_law, one focused query per finding, in the database language — Russian for UZ/KZ), then open or verify the candidates together in one step.
- The database holds statutes and codes and, for Uzbekistan, the Constitution, presidential decrees and resolutions, and Supreme Court Plenum resolutions — no individual court decisions or commentary. A Plenum point explains how courts apply a statute; prefer the statute article when it alone governs the issue.
- Prefer the most specific provision (a special law over the general Civil Code rule when both apply).
- If no provision in the database governs a finding — for example, a purely commercial point — return null for it. Never force a citation that does not govern the issue.

Answer with ONLY one JSON object, no other text:
{"fixes":[{"index":<finding number>,"unit_id":"<provision id from square brackets>" or null,"citation":"<short citation as a lawyer writes it, e.g. ст. 32 Закона о договорно-правовой базе>" or null}]}`;
}

function findingLine(i: number, f: F, clause?: { delText: string; insText: string }): string {
  const parts = [`#${i} — ${f.title}`, `  current citation (not confirmed): ${f.citation || '—'}`];
  if (clause?.delText) parts.push(`  contract clause: «${clause.delText.slice(0, 500)}»`);
  if (clause?.insText) parts.push(`  proposed wording: «${clause.insText.slice(0, 300)}»`);
  return parts.join('\n');
}

/** «UZ / Гражданский кодекс … / Статья 356» → «Статья 356 · Гражданский кодекс …». */
function citationFromBreadcrumb(breadcrumb: string): string {
  const parts = breadcrumb.split(' / ').map((p) => p.trim()).filter(Boolean);
  const last = parts[parts.length - 1] ?? breadcrumb;
  const doc = parts.length > 2 ? parts[1] : '';
  return doc ? `${last} ${doc}` : last;
}

export async function repairFindingCitations<T extends F>(
  db: Db,
  opts: {
    findings: T[];
    /** Серьёзность каждой находки ДО проверки (в том же порядке). */
    originalSeverity: Severity[];
    jurisdiction: JurisdictionCode;
    plan?: string | null;
    /** Явная модель (замер eval); иначе — модель тарифа. */
    model?: string;
    /** Текст пункта и предложенная правка — по id правки (redlineId находки). */
    clauses?: Map<string, { delText: string; insText: string }>;
    log?: (msg: string) => void;
    /** Подмена агента и судьи — только для тестов. */
    deps?: { runAgent?: typeof runTaskAgent; judge?: typeof judgeProvision };
  },
): Promise<{ findings: T[]; repaired: number; attempted: number }> {
  const log = opts.log ?? (() => undefined);
  const runAgent = opts.deps?.runAgent ?? runTaskAgent;
  const judge = opts.deps?.judge ?? judgeProvision;
  const broken = opts.findings
    .map((f, i) => ({ f, i }))
    .filter(({ f }) => f.unverified)
    .slice(0, MAX_REPAIR);
  if (!broken.length) return { findings: opts.findings, repaired: 0, attempted: 0 };

  const runner = createChatToolRunner({
    db,
    jurisdiction: opts.jurisdiction,
    documents: [],
    toRefs: async (units) => units.map((u) => ({ label: u.breadcrumb.split(' / ').pop() ?? '', doc: '' })),
  });
  const user = [
    `Findings whose citations could not be confirmed (${broken.length}):`,
    ...broken.map(({ f, i }) => findingLine(i, f, f.redlineId ? opts.clauses?.get(f.redlineId) : undefined)),
  ].join('\n\n');

  let text: string;
  try {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`timed out after ${REPAIR_TIMEOUT_MS / 1000}s`)), REPAIR_TIMEOUT_MS);
    });
    try {
      text = await Promise.race([
        runAgent({
          op: 'analysis-repair',
          plan: opts.plan,
          model: opts.model,
          system: repairSystem(opts.jurisdiction),
          user,
          agent: { tools: REPAIR_TOOLS, instructions: '', run: runner.run },
        }),
        timeout,
      ]);
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    log(`citation repair skipped: ${(err as Error).message}`);
    return { findings: opts.findings, repaired: 0, attempted: broken.length };
  }

  let fixes: { index?: unknown; unit_id?: unknown; citation?: unknown }[] = [];
  try {
    const parsed = extractJsonObject(text) as { fixes?: unknown };
    if (Array.isArray(parsed.fixes)) fixes = parsed.fixes as typeof fixes;
  } catch {
    log('citation repair: the agent did not return JSON — findings left as they were');
    return { findings: opts.findings, repaired: 0, attempted: broken.length };
  }

  const wanted = new Set(broken.map(({ i }) => i));
  const out = [...opts.findings];
  let repaired = 0;
  const done = new Set<number>();
  // Каждое предложение агента проверяет код: норма есть, действует сегодня, той
  // же юрисдикции, и судья подтверждает, что она регулирует вопрос находки.
  await Promise.all(
    fixes.map(async (fix) => {
      const i = typeof fix.index === 'number' ? fix.index : Number(fix.index);
      if (!Number.isInteger(i) || !wanted.has(i) || done.has(i)) return;
      if (typeof fix.unit_id !== 'string' || !UNIT_ID_RE.test(fix.unit_id)) return;
      done.add(i);
      const unit = await loadUnit(db, fix.unit_id).catch(() => null);
      if (!unit || unit.jurisdiction !== opts.jurisdiction) return;
      const f = out[i];
      const citation =
        typeof fix.citation === 'string' && fix.citation.trim() && fix.citation.trim().length <= 200
          ? fix.citation.trim()
          : citationFromBreadcrumb(unit.breadcrumb);
      const ok = await judge(unit.text, unit.breadcrumb, { title: f.title, citation }).catch(() => false);
      if (ok !== true) return;
      out[i] = { ...f, unitId: unit.id, citation, unverified: false, severity: opts.originalSeverity[i] ?? f.severity };
      repaired++;
    }),
  );
  log(`citation repair: ${repaired} of ${broken.length} findings confirmed`);
  return { findings: out, repaired, attempted: broken.length };
}
