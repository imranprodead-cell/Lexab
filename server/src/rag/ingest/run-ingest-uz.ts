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
import { fetchLexUzHtml, parseLexUzHtml, parseLexUzDecreeHtml } from './lex-uz.ts';
import { upsertParsedDocument } from './upsert.ts';

interface UzDoc {
  id: string;
  note: string;
  /** Parse-coverage floor: fail loud when the parser finds fewer articles —
   *  markup drift on lex.uz must never silently truncate a code.
   *  Для kind='decree' это порог по ПУНКТАМ. */
  minArticles: number;
  /** 'decree' → parseLexUzDecreeHtml (УП/ПП из пунктов). Default 'law' —
   *  существующие записи не меняются. */
  kind?: 'law' | 'decree';
  /** Ожидаемый канонический номер акта («УП-6079») — ОБЯЗАТЕЛЕН для decree.
   *  Несовпадение с номером из шапки страницы = не тот акт → отказ. */
  docNumber?: string;
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
  // ── Волна 5 (ID проверены --dry-run по заголовкам страниц lex.uz 2026-07-28) ─
  { id: '106134', note: 'Жилищный кодекс РУз (24.12.1998)', minArticles: 130 },
  { id: '7051594', note: 'Об электроэнергетике (ЗРУ-939, 07.08.2024)', minArticles: 60 },
  { id: '5307899', note: 'Об аудиторской деятельности (ЗРУ-677, 25.02.2021)', minArticles: 50 },
  { id: '4177', note: 'О гарантиях свободы предпринимательской деятельности (69-II, ред. ЗРУ-328 2012)', minArticles: 46 },
  { id: '5972413', note: 'О небанковских кредитных организациях и микрофинансовой деятельности (ЗРУ-765, 20.04.2022)', minArticles: 40 },
  { id: '85248', note: 'О лизинге (756-I, 14.04.1999)', minArticles: 22 },
  { id: '67128', note: 'О внешнеэкономической деятельности (285-XII, ред. 77-II 2000)', minArticles: 17 },
  // ── Волна 6 законов (ID проверены разведкой по страницам lex.uz 2026-07-29) ─
  { id: '3517334', note: 'Гражданский процессуальный кодекс РУз (ЗРУ-460, 22.01.2018)', minArticles: 350 },
  { id: '2460799', note: 'О коммерческой тайне (ЗРУ-374, 11.09.2014)', minArticles: 18 },
  { id: '165074', note: 'Об электронном документообороте (611-II, 29.04.2004)', minArticles: 16 },
  { id: '24701', note: 'Об оценочной деятельности (811-I, 19.08.1999, ред. до 2026)', minArticles: 18 },
  { id: '24493', note: 'О биржах и биржевой деятельности (625-XII, нов. ред. 260-II 2001)', minArticles: 28 },
  { id: '4737514', note: 'О специальных экономических зонах (ЗРУ-604, 17.02.2020)', minArticles: 42 },
  { id: '262947', note: 'Об экспортном контроле (658-II, 26.08.2004)', minArticles: 14 },
  { id: '2055683', note: 'О защите частной собственности и гарантиях прав собственников (ЗРУ-336, 24.09.2012)', minArticles: 26 },
  { id: '3492203', note: 'Об административных процедурах (ЗРУ-457, 08.01.2018)', minArticles: 80 },
  { id: '3805229', note: 'О медиации (ЗРУ-482, 03.07.2018)', minArticles: 30 },
  // ── Указы/постановления Президента — пилот (ID проверены по страницам lex.uz 2026-07-28) ─
  { id: '7231783', note: 'УП-184 О мерах по надёжной защите прав и законных интересов предпринимателей (14.11.2024)', minArticles: 85, kind: 'decree', docNumber: 'УП-184' },
  { id: '3744601', note: 'ПП-3724 О мерах по ускоренному развитию электронной коммерции (14.05.2018)', minArticles: 11, kind: 'decree', docNumber: 'ПП-3724' },
  { id: '5031048', note: 'УП-6079 Об утверждении стратегии «Цифровой Узбекистан-2030» (05.10.2020)', minArticles: 18, kind: 'decree', docNumber: 'УП-6079' },
  // ── Указы/постановления — волна 1 (ID сверены разведкой по страницам lex.uz 2026-07-28) ─
  { id: '6171346', note: 'УП-198 О защите неприкосновенности права собственности (24.08.2022)', minArticles: 11, kind: 'decree', docNumber: 'УП-198' },
  { id: '4966445', note: 'УП-6044 О кардинальном совершенствовании лицензионных и разрешительных процедур (24.08.2020)', minArticles: 16, kind: 'decree', docNumber: 'УП-6044' },
  { id: '3326423', note: 'УП-5177 О первоочередных мерах по либерализации валютной политики (02.09.2017)', minArticles: 9, kind: 'decree', docNumber: 'УП-5177' },
  { id: '3845276', note: 'УП-5495 О кардинальном улучшении инвестиционного климата (01.08.2018)', minArticles: 4, kind: 'decree', docNumber: 'УП-5495' },
  { id: '5947782', note: 'УП-101 Об очередных реформах предпринимательской среды и развитии частного сектора (08.04.2022)', minArticles: 100, kind: 'decree', docNumber: 'УП-101' },
  { id: '5339625', note: 'УП-6191 О благоприятных условиях при пользовании госуслугами, сокращении бюрократии (23.03.2021)', minArticles: 37, kind: 'decree', docNumber: 'УП-6191' },
  { id: '3039313', note: 'УП-4848 Об ускоренном развитии предпринимательства, защите частной собственности (05.10.2016)', minArticles: 11, kind: 'decree', docNumber: 'УП-4848' },
  { id: '4473205', note: 'УП-5780 Об усилении защиты частной собственности и гарантий прав собственников (13.08.2019)', minArticles: 30, kind: 'decree', docNumber: 'УП-5780' },
  { id: '4529989', note: 'УП-5837 О совершенствовании налоговой политики (26.09.2019)', minArticles: 13, kind: 'decree', docNumber: 'УП-5837' },
  { id: '5617900', note: 'УП-6306 О дополнительных мерах по стимулированию предприятий-экспортёров (07.09.2021)', minArticles: 9, kind: 'decree', docNumber: 'УП-6306' },
  { id: '3723266', note: 'ПП-3697 О развитии активного предпринимательства и инновационной деятельности (05.05.2018)', minArticles: 7, kind: 'decree', docNumber: 'ПП-3697' },
  // ── Указы/постановления — волна 2 (ID сверены разведкой по страницам lex.uz 2026-07-29) ─
  { id: '7353752', note: 'УП-11 Долевое строительство, эскроу-счета', minArticles: 16, kind: 'decree', docNumber: 'УП-11' },
  { id: '7327679', note: 'УП-7 Хлопок: биржевая торговля, фьючерсные контракты', minArticles: 52, kind: 'decree', docNumber: 'УП-7' },
  { id: '4757015', note: 'ПП-4634 Рыночные принципы закупки зерна', minArticles: 16, kind: 'decree', docNumber: 'ПП-4634' },
  { id: '5450181', note: 'УП-6243 Земля как рыночный актив, аукционы', minArticles: 58, kind: 'decree', docNumber: 'УП-6243' },
  { id: '6505929', note: 'УП-99 Приватизация несельскохозяйственных земельных участков', minArticles: 20, kind: 'decree', docNumber: 'УП-99' },
  { id: '7410371', note: 'УП-35 Развитие конкуренции, эксклюзивные права', minArticles: 30, kind: 'decree', docNumber: 'УП-35' },
  { id: '7452010', note: 'УП-57 Упрощение таможенных процедур', minArticles: 42, kind: 'decree', docNumber: 'УП-57' },
  { id: '4435441', note: 'ПП-4400 Повышение доступности микрофинансовых услуг', minArticles: 11, kind: 'decree', docNumber: 'ПП-4400' },
  { id: '3806048', note: 'ПП-3832 Развитие цифровой экономики и оборота крипто-активов (03.07.2018)', minArticles: 7, kind: 'decree', docNumber: 'ПП-3832' },
  { id: '3460647', note: 'УП-5286 Стимулирование экспорта (15.12.2017)', minArticles: 27, kind: 'decree', docNumber: 'УП-5286' },
  { id: '4474549', note: 'УП-5781 Ускоренное развитие туристской отрасли', minArticles: 46, kind: 'decree', docNumber: 'УП-5781' },
  { id: '4415358', note: 'ПП-4389 Совершенствование налогового администрирования (10.07.2019)', minArticles: 21, kind: 'decree', docNumber: 'ПП-4389' },
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
      const parsed = doc.kind === 'decree' ? parseLexUzDecreeHtml(doc.id, html, url) : parseLexUzHtml(doc.id, html, url);
      if (doc.kind === 'decree') {
        // Сверка ожидания: опечатка в lex.uz-ID должна падать громко, а не
        // тихо ингестить чужой акт.
        if (!doc.docNumber) throw new Error(`запись ${doc.id} kind=decree без ожидаемого docNumber — заполни UZ_DOCS`);
        if (parsed.docNumber !== doc.docNumber) {
          throw new Error(
            `номер акта не совпал для lex.uz/${doc.id}: ожидали ${doc.docNumber}, распарсили ${parsed.docNumber ?? 'null'} («${parsed.title}») — не та страница? refusing`,
          );
        }
      }
      const secs = parsed.units.filter((u) => u.unitType === 'section');
      const leaf = doc.kind === 'decree' ? 'пунктов' : 'статей';
      // Parse-coverage floor BEFORE any write.
      if (secs.length < doc.minArticles) {
        throw new Error(
          `parsed only ${secs.length} ${leaf} for «${parsed.title}» (expected ≥ ${doc.minArticles}) — markup drift? refusing`,
        );
      }
      if (dryRun) {
        detail[doc.id] = { title: parsed.title, units: parsed.units.length, articles: secs.length };
        console.log(`[dry-run] ${doc.id} «${parsed.title}»${parsed.docNumber ? ` [${parsed.docNumber}]` : ''}`);
        console.log(`          units=${parsed.units.length} ${leaf}=${secs.length}  (${gapReport(secs.map((s) => s.number ?? ''))})`);
        if (secs.length) {
          console.log(`          first:  ${secs[0].breadcrumb}`);
          console.log(`          middle: ${secs[Math.floor(secs.length / 2)].breadcrumb}`);
          console.log(`          last:   ${secs[secs.length - 1].breadcrumb}`);
        }
      } else {
        const res = await upsertParsedDocument(db!, parsed, force);
        if (res.changed) changed++; else unchanged++;
        detail[doc.id] = { title: parsed.title, units: parsed.units.length, articles: secs.length, changed: res.changed };
        console.log(`[ingest:uz] ${parsed.title}: ${res.changed ? `${parsed.units.length} units (${secs.length} ${leaf}, ${gapReport(secs.map((s) => s.number ?? ''))})` : 'unchanged — skipped'}`);
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
