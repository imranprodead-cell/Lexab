/**
 * Uzbekistan ingestion runner: официальные тексты с lex.uz (русская версия).
 *
 *   npm run rag:ingest:uz                        # весь список UZ_DOCS
 *   npm run rag:ingest:uz -- 111181              # конкретные документы
 *   npm run rag:ingest:uz -- --force             # перепарсить без изменений источника
 *   npm run rag:ingest:uz -- --dry-run 6257291   # парсинг БЕЗ записи в БД (проба разметки)
 *
 * Правило корпуса: ID документов берутся ТОЛЬКО с lex.uz (проверяются вручную
 * по названию в выводе ингеста) — никаких «предположительных» ID.
 */
import { getDb, migrate } from '../../db.ts';
import { newId } from '../../lib/ids.ts';
import { fetchLexUzHtml, parseLexUzHtml } from './lex-uz.ts';
import { upsertParsedDocument } from './upsert.ts';

interface UzDoc {
  id: string;
  note: string;
  /** Parse-coverage floor: fail loud when the parser finds fewer articles —
   *  markup drift on lex.uz must never silently truncate a code. */
  minArticles: number;
}

/** Корпус договорного права РУз (волна 1 = пилот + 5 приоритетных актов). */
export const UZ_DOCS: UzDoc[] = [
  // ── Пилот (LIVE с этапа «Узбекистан») ──────────────────────────────────────
  { id: '111181', note: 'Гражданский кодекс РУз, часть первая (1995)', minArticles: 380 },
  { id: '180550', note: 'Гражданский кодекс РУз, часть вторая (1996)', minArticles: 800 },
  { id: '10872', note: 'О договорно-правовой базе деятельности хозяйствующих субъектов (1998)', minArticles: 30 },
  { id: '6234906', note: 'Об электронной цифровой подписи (ЗРУ-793, 2022)', minArticles: 30 },
  { id: '14643', note: 'О защите прав потребителей (1996)', minArticles: 30 },
  // ── Волна 1 (ID проверены по заголовкам страниц lex.uz 2026-07-18) ─────────
  { id: '6257291', note: 'Трудовой кодекс РУз (ЗРУ-798, 28.10.2022)', minArticles: 450 },
  { id: '59750', note: 'О залоге (736-XII, 09.12.1992, ред. 1998)', minArticles: 40 },
  { id: '1063361', note: 'Об ипотеке (ЗРУ-58, 04.10.2006)', minArticles: 30 },
  { id: '8152146', note: 'Об обществах с ограниченной ответственностью (ЗРУ-1137, 21.04.2026; сменяет 310-II с 22.07.2026)', minArticles: 50 },
  { id: '14667', note: 'Об акционерных обществах и защите прав акционеров (223-I, 1996, ред. ЗРУ-370 2014)', minArticles: 70 },
  { id: '3523895', note: 'Экономический процессуальный кодекс РУз (ЗРУ-461, 24.01.2018)', minArticles: 280 },
  { id: '112910', note: 'Об аренде (427-XII, 19.11.1991)', minArticles: 20 },
  // ── Волна 2 (ID проверены по заголовкам страниц lex.uz 2026-07-19) ─────────
  { id: '4674893', note: 'Налоговый кодекс РУз (ЗРУ-599, 30.12.2019)', minArticles: 380 },
  { id: '149947', note: 'Земельный кодекс РУз (30.04.1998)', minArticles: 70 },
  { id: '81459', note: 'О валютном регулировании (841-XII, 1993, ред. ЗРУ-573 2019)', minArticles: 20 },
  { id: '6518383', note: 'О конкуренции (ЗРУ-850, 03.07.2023; в законе 49 статей)', minArticles: 45 },
  { id: '5511900', note: 'О лицензировании, разрешительных и уведомительных процедурах (ЗРУ-701, 2021)', minArticles: 40 },
  { id: '5957616', note: 'О неплатежеспособности (ЗРУ-763, 12.04.2022; сменил «О банкротстве»)', minArticles: 150 },
  { id: '5382983', note: 'О государственных закупках (ЗРУ-684, 22.04.2021)', minArticles: 50 },
  { id: '4664144', note: 'Об инвестициях и инвестиционной деятельности (ЗРУ-598, 25.12.2019)', minArticles: 40 },
  // ── Волна 3 (ID проверены --dry-run по заголовкам страниц lex.uz 2026-07-28) ─
  { id: '2876352', note: 'Таможенный кодекс РУз (ЗРУ-400, 20.01.2016)', minArticles: 400 },
  { id: '5739120', note: 'О страховой деятельности (ЗРУ-730, 23.11.2021)', minArticles: 65 },
  { id: '1023494', note: 'Об авторском праве и смежных правах (ЗРУ-42, 20.07.2006)', minArticles: 65 },
  { id: '6052633', note: 'О рекламе (ЗРУ-776, 07.06.2022)', minArticles: 48 },
  { id: '6392314', note: 'О техническом регулировании (ЗРУ-819, 27.02.2023)', minArticles: 48 },
  { id: '5563048', note: 'О транспорте (ЗРУ-706, 09.08.2021)', minArticles: 42 },
  { id: '75902', note: 'Об изобретениях, полезных моделях и промышленных образцах (1062-XII, 06.05.1994)', minArticles: 38 },
  { id: '6936', note: 'О товарных знаках, знаках обслуживания и наименованиях мест происхождения товаров (267-II, 30.08.2001)', minArticles: 36 },
  { id: '4396428', note: 'О персональных данных (ЗРУ-547, 02.07.2019)', minArticles: 33 },
  { id: '6213428', note: 'Об электронной коммерции (ЗРУ-792, 29.09.2022)', minArticles: 28 },
  // ── Волна 4 (ID проверены --dry-run по заголовкам страниц lex.uz 2026-07-28) ─
  { id: '13896', note: 'Об исполнении судебных актов и актов иных органов (258-II, 29.08.2001)', minArticles: 105 },
  { id: '57043', note: 'О нотариате (343-I, 26.12.1996)', minArticles: 100 },
  { id: '5307955', note: 'Градостроительный кодекс РУз (ЗРУ-676, 22.02.2021)', minArticles: 78 },
  { id: '4575788', note: 'О платежах и платёжных системах (ЗРУ-578, 01.11.2019)', minArticles: 58 },
  { id: '1374867', note: 'О рынке ценных бумаг (ЗРУ-163, 22.07.2008, ред. ЗРУ-387 2015)', minArticles: 56 },
  { id: '1072094', note: 'О третейских судах (ЗРУ-64, 16.10.2006)', minArticles: 54 },
  { id: '5294087', note: 'О международном коммерческом арбитраже (ЗРУ-674, 16.02.2021)', minArticles: 50 },
  { id: '12011', note: 'О банках и банковской деятельности (216-I, 25.04.1996, действ. ред.)', minArticles: 40 },
  { id: '4329272', note: 'О государственно-частном партнёрстве (ЗРУ-537, 10.05.2019)', minArticles: 40 },
  { id: '90764', note: 'О бухгалтерском учёте (279-I, 30.08.1996, ред. ЗРУ-404 2016)', minArticles: 20 },
];

/** Обратная совместимость: прежнее имя экспорта (список голых id). */
export const PILOT_UZ_DOCS = UZ_DOCS.map((d) => d.id);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Article-number continuity report. Base numbers should cover 1..N almost
 *  contiguously; missing low numbers mean the parser lost a stretch. Superscript
 *  articles («358¹» → strips to a big outlier) are ignored via the 1..count
 *  window, so the check doesn't cry wolf on codes that use them. */
function gapReport(articleNums: string[]): string {
  const bases = articleNums.map((n) => Number(n.split(/[.-]/)[0])).filter((n) => Number.isFinite(n));
  if (!bases.length) return 'no numeric articles';
  const set = new Set(bases);
  const count = set.size;
  // Window bound = the largest base number that is ≤ count. Superscript articles
  // («183¹» → 1831) are far above any real numbering and would otherwise inflate
  // the window (ЭПК: 39 superscripts → 39 phantom "gaps"). A lost tail is still
  // caught by the minArticles floor.
  let bound = 0;
  for (const b of set) if (b <= count && b > bound) bound = b;
  let missing = 0;
  for (let i = 1; i <= bound; i++) if (!set.has(i)) missing++;
  const outliers = count - [...set].filter((b) => b <= bound).length;
  return (
    `distinct base numbers ${count}` +
    (outliers > 0 ? ` (${outliers} superscript/outlier)` : '') +
    (missing > 10 ? `  ⚠ ${missing} gaps in 1..${bound}` : '')
  );
}

async function main(): Promise<void> {
  const requested = process.argv.slice(2).filter((a) => !a.startsWith('-'));
  const force = process.argv.includes('--force');
  const dryRun = process.argv.includes('--dry-run');
  const byId = new Map(UZ_DOCS.map((d) => [d.id, d]));
  const docs: UzDoc[] = requested.length
    ? requested.map((id) => byId.get(id) ?? { id, note: '(не в списке UZ_DOCS)', minArticles: 1 })
    : UZ_DOCS;

  const db = dryRun ? null : await getDb();
  if (db) await migrate(db);
  const runId = newId('ir');
  if (db) await db.query(`INSERT INTO ingestion_runs (id, source) VALUES ($1, 'lex.uz')`, [runId]);
  let fetched = 0, changed = 0, unchanged = 0, errors = 0;
  const detail: Record<string, unknown> = {};

  for (const doc of docs) {
    try {
      const { html, url } = await fetchLexUzHtml(doc.id);
      fetched++;
      const parsed = parseLexUzHtml(doc.id, html, url);
      const secs = parsed.units.filter((u) => u.unitType === 'section');
      // Parse-coverage floor BEFORE any write.
      if (secs.length < doc.minArticles) {
        throw new Error(
          `parsed only ${secs.length} articles for «${parsed.title}» (expected ≥ ${doc.minArticles}) — markup drift? refusing`,
        );
      }
      if (dryRun) {
        detail[doc.id] = { title: parsed.title, units: parsed.units.length, articles: secs.length };
        console.log(`[dry-run] ${doc.id} «${parsed.title}»`);
        console.log(`          units=${parsed.units.length} articles=${secs.length}  (${gapReport(secs.map((s) => s.number ?? ''))})`);
        if (secs.length) {
          console.log(`          first:  ${secs[0].breadcrumb}`);
          console.log(`          middle: ${secs[Math.floor(secs.length / 2)].breadcrumb}`);
          console.log(`          last:   ${secs[secs.length - 1].breadcrumb}`);
        }
      } else {
        const res = await upsertParsedDocument(db!, parsed, force);
        if (res.changed) changed++; else unchanged++;
        detail[doc.id] = { title: parsed.title, units: parsed.units.length, articles: secs.length, changed: res.changed };
        console.log(`[ingest:uz] ${parsed.title}: ${res.changed ? `${parsed.units.length} units (${secs.length} статей, ${gapReport(secs.map((s) => s.number ?? ''))})` : 'unchanged — skipped'}`);
        if (res.changed && secs.length) console.log(`            e.g. ${secs[Math.floor(secs.length / 2)].breadcrumb}`);
      }
    } catch (err) {
      errors++;
      detail[doc.id] = { error: (err as Error).message };
      console.error(`[ingest:uz] ${doc.id} FAILED: ${(err as Error).message}`);
    }
    await sleep(1200); // вежливость к официальному сайту
  }

  if (db) {
    await db.query(
      `UPDATE ingestion_runs SET finished_at = now(), docs_fetched = $2, docs_changed = $3, docs_unchanged = $4, errors = $5, detail = $6 WHERE id = $1`,
      [runId, fetched, changed, unchanged, errors, JSON.stringify(detail)],
    );
    const totals = await db.query<{ docs: string; units: string; sections: string }>(
      `SELECT count(*) AS docs,
              (SELECT count(*) FROM legal_units u JOIN legal_documents d ON d.id = u.document_id WHERE d.jurisdiction = 'UZ') AS units,
              (SELECT count(*) FROM legal_units u JOIN legal_documents d ON d.id = u.document_id WHERE d.jurisdiction = 'UZ' AND u.unit_type = 'section') AS sections
       FROM legal_documents WHERE jurisdiction = 'UZ'`,
    );
    console.log(`\n[ingest:uz] run ${runId}: fetched ${fetched}, changed ${changed}, unchanged ${unchanged}, errors ${errors}`);
    console.log(`[ingest:uz] корпус UZ: ${totals.rows[0].docs} документов, ${totals.rows[0].units} юнитов (${totals.rows[0].sections} статей)`);
    await db.close();
  } else {
    console.log(`\n[dry-run] fetched ${fetched}, errors ${errors} — БД не тронута`);
  }
  if (errors > 0) process.exitCode = 1;
}

void main();
