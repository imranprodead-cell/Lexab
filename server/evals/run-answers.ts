/**
 * Проверка ОТВЕТОВ агента чата (этап 3, 2026-11-09). Поиск меряет run-eval.ts;
 * здесь — то, что получает пользователь: вопрос проходит тот же путь, что в
 * чате (поиск 8 норм → formatLegalContext → агент с инструментами базы законов
 * → generateChatReply), а ответ проверяет КОД, без ИИ-судьи:
 *   must_cite     — группы норм: ответ ссылается хотя бы на одну норму КАЖДОЙ
 *                   группы (номер + тот же акт рядом, chatTools.citesProvision);
 *   must_not_cite — нормы, ссылка на которые — ошибка (ГК вместо ТК и т.п.);
 *                   засчитывается только явная ссылка с названным актом;
 *   facts         — регулярные выражения: цифры, сроки, проценты из закона.
 *
 *   npm run eval:answers -- --plan=Free [--golden=uz-answers.jsonl] [--limit N]
 *                           [--rewrites-cache=FILE]
 *   npm run eval:answers -- --regrade=evals/reports/answers-….json
 *     — перепроверить СОХРАНЁННЫЕ ответы по текущему набору (без вызовов
 *       моделей, $0): когда правится сама проверка, а не агент.
 * Free — агент на DeepSeek; Pro/Business — на Claude (платно, только с разрешения).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getDb, migrate } from "../src/db.ts";
import { generateChatReply, usesChatAgent } from "../src/llm.ts";
import {
  CHAT_AGENT_INSTRUCTIONS,
  citesProvision,
  createChatToolRunner,
} from "../src/lib/chatTools.ts";
import { formatLegalContext } from "../src/rag/context.ts";
import { retrieveLegalContext } from "../src/rag/retrieve.ts";

interface AnswerRow {
  question: string;
  must_cite: string[][];
  must_not_cite: string[];
  facts: string[];
  notes?: string;
}

const HERE = path.dirname(fileURLToPath(import.meta.url));
const arg = (name: string) =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);

async function main(): Promise<void> {
  const goldenFile = arg("golden") ?? "uz-answers.jsonl";
  const plan = arg("plan") ?? "Free";
  const limit = Number(arg("limit") ?? Infinity);
  const cachePath = arg("rewrites-cache") ?? null;
  const regradeFrom = arg("regrade") ?? null;
  const saved = new Map<string, string>(
    regradeFrom
      ? (
          JSON.parse(readFileSync(regradeFrom, "utf8")).results as {
            question: string;
            reply: string;
          }[]
        ).map((r) => [r.question, r.reply])
      : [],
  );
  const cache: Record<string, string[]> =
    cachePath && existsSync(cachePath)
      ? JSON.parse(readFileSync(cachePath, "utf8"))
      : {};
  const rows = readFileSync(path.join(HERE, "golden", goldenFile), "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as AnswerRow)
    .slice(0, limit);
  if (!regradeFrom && !usesChatAgent(plan))
    throw new Error(
      `агент чата для тарифа ${plan} выключен или нет ключа модели`,
    );

  const db = await getDb();
  await migrate(db);

  // Номер и название акта каждой нормы из набора — для проверки ссылок в ответе.
  const ids = [
    ...new Set(
      rows.flatMap((r) => [...r.must_cite.flat(), ...r.must_not_cite]),
    ),
  ];
  const meta = new Map(
    (
      await db.query<{ id: string; number: string; title: string }>(
        `SELECT u.id, u.number, d.title FROM legal_units u JOIN legal_documents d ON d.id = u.document_id WHERE u.id = ANY($1::text[])`,
        [ids],
      )
    ).rows.map((r) => [r.id, r]),
  );
  const missing = ids.filter((id) => !meta.has(id));
  if (missing.length)
    throw new Error(`нормы из набора не найдены в базе: ${missing.join(", ")}`);
  const cites = (text: string, id: string) => {
    const m = meta.get(id)!;
    return citesProvision(text, m.number, m.title, "UZ");
  };
  // Явная ссылка: с настоящим актом — да, с выдуманным — нет (значит, акт назван).
  const citesExplicitly = (text: string, id: string) =>
    cites(text, id) &&
    !citesProvision(text, meta.get(id)!.number, "§ нет такого акта §", "UZ");

  const results: Record<string, unknown>[] = [];
  let passed = 0,
    groupsOk = 0,
    groupsAll = 0,
    factsOk = 0,
    factsAll = 0,
    wrong = 0,
    failed = 0;
  for (const [i, row] of rows.entries()) {
    const t0 = Date.now();
    let reply = "";
    let error: string | undefined;
    try {
      if (regradeFrom) {
        if (!saved.has(row.question))
          throw new Error("нет ответа в сохранённом отчёте");
        reply = saved.get(row.question) as string;
      } else {
        const hits = await retrieveLegalContext(db, {
          query: row.question,
          jurisdiction: "UZ",
          topK: 8,
          rewrites: cache[row.question],
          onQueries: (qs) => {
            if (cache[row.question] || !cachePath) return;
            cache[row.question] = qs.filter((q) => q !== row.question);
            writeFileSync(cachePath, JSON.stringify(cache, null, 1));
          },
        });
        const runner = createChatToolRunner({
          db,
          plan,
          jurisdiction: "UZ",
          documents: [],
          toRefs: async (units) =>
            units.map((u) => ({ label: u.unitId, doc: u.breadcrumb })),
        });
        reply = await generateChatReply(
          [],
          row.question,
          undefined,
          undefined,
          "Uzbekistan",
          plan,
          null,
          formatLegalContext(hits, "UZ") || null,
          null,
          {
            tools: runner.tools,
            run: runner.run,
            instructions: CHAT_AGENT_INSTRUCTIONS,
          },
        );
      }
    } catch (err) {
      error = (err as Error).message;
      failed++;
    }
    const groups = row.must_cite.map((g) => g.some((id) => cites(reply, id)));
    const facts = row.facts.map((f) => new RegExp(f, "iu").test(reply));
    const wrongCites = row.must_not_cite.filter((id) =>
      citesExplicitly(reply, id),
    );
    const ok =
      !error &&
      groups.every(Boolean) &&
      facts.every(Boolean) &&
      wrongCites.length === 0;
    if (ok) passed++;
    groupsOk += groups.filter(Boolean).length;
    groupsAll += groups.length;
    factsOk += facts.filter(Boolean).length;
    factsAll += facts.length;
    wrong += wrongCites.length;
    results.push({
      question: row.question,
      ok,
      groups,
      facts,
      wrongCites,
      error,
      seconds: Math.round((Date.now() - t0) / 100) / 10,
      reply,
    });
    console.log(
      `${ok ? "✓" : "✗"} ${i + 1}. ${row.question.slice(0, 70)}${error ? ` — ОШИБКА: ${error.slice(0, 120)}` : ""}${!ok && !error ? ` — нормы ${groups.map((g) => (g ? "+" : "−")).join("")}, цифры ${facts.map((f) => (f ? "+" : "−")).join("")}${wrongCites.length ? `, лишние: ${wrongCites.join(",")}` : ""}` : ""}`,
    );
  }
  const summary = {
    plan,
    ...(regradeFrom ? { regradedFrom: path.basename(regradeFrom) } : {}),
    questions: rows.length,
    pass: +(passed / rows.length).toFixed(3),
    citedGroups: +(groupsOk / Math.max(1, groupsAll)).toFixed(3),
    facts: +(factsOk / Math.max(1, factsAll)).toFixed(3),
    wrongCitations: wrong,
    errors: failed,
  };
  console.log("\n=== ANSWERS ===", JSON.stringify(summary));
  const dir = path.join(HERE, "reports");
  mkdirSync(dir, { recursive: true });
  const file = path.join(
    dir,
    `answers-${new Date().toISOString().replace(/[:.]/g, "-")}.json`,
  );
  writeFileSync(
    file,
    JSON.stringify(
      { at: new Date().toISOString(), golden: goldenFile, ...summary, results },
      null,
      1,
    ),
  );
  console.log(`[answers] report saved: ${file}`);
  await db.close();
}

void main();
