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
import { fetchLexUzHtml, parseLexUzHtml, parseLexUzDecreeHtml, parseLexUzPlenumHtml, type PlenumExpect } from './lex-uz.ts';
import { upsertParsedDocument } from './upsert.ts';
import { pathToFileURL } from 'node:url';

interface UzDoc {
  id: string;
  note: string;
  /** Parse-coverage floor: fail loud when the parser finds fewer articles —
   *  markup drift on lex.uz must never silently truncate a code.
   *  Для kind='decree' это порог по ПУНКТАМ. */
  minArticles: number;
  /** 'decree' → parseLexUzDecreeHtml (УП/ПП из пунктов). Default 'law' —
   *  существующие записи не меняются. */
  kind?: 'law' | 'decree' | 'plenum';
  /** Ожидаемый канонический номер акта («УП-6079») — ОБЯЗАТЕЛЕН для decree.
   *  Несовпадение с номером из шапки страницы = не тот акт → отказ. */
  docNumber?: string;
  /** Для kind='plenum' ОБЯЗАТЕЛЬНО: суд, номер и дата из списка lex.uz —
   *  сверяются с шапкой страницы, несовпадение = отказ. */
  plenum?: PlenumExpect;
  /** Разделы словами и главы римскими цифрами (Конституция). */
  romanHeadings?: boolean;
  /** Название вместо <title> страницы — для законов «в новой редакции»,
   *  чей действующий текст лежит на странице закона-изменения. */
  title?: string;
  /** lex.uz-ID УСТАРЕВШЕЙ редакции того же закона, загруженной раньше: на её
   *  странице lex.uz пишет «Акт изложен в новой редакции». Удаляется из базы
   *  только после успешной загрузки этой записи. */
  supersedes?: string;
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
  { id: '59847', note: 'О залоге — действующая редакция (614-I, 01.05.1998)', minArticles: 40, title: '614-I-сон 01.05.1998. О залоге (в новой редакции)', supersedes: '59750' },
  { id: '1063361', note: 'Об ипотеке (ЗРУ-58, 04.10.2006)', minArticles: 30 },
  { id: '8152146', note: 'Об обществах с ограниченной ответственностью (ЗРУ-1137, 21.04.2026; сменяет 310-II с 22.07.2026)', minArticles: 50 },
  { id: '2382411', note: 'Об акционерных обществах и защите прав акционеров — действующая редакция (ЗРУ-370, 06.05.2014)', minArticles: 105, title: 'ЗРУ-370-сон 06.05.2014. Об акционерных обществах и защите прав акционеров (в новой редакции)', supersedes: '14667' },
  { id: '3523895', note: 'Экономический процессуальный кодекс РУз (ЗРУ-461, 24.01.2018)', minArticles: 280 },
  { id: '112910', note: 'Об аренде (427-XII, 19.11.1991)', minArticles: 20 },
  // ── Волна 2 (ID проверены по заголовкам страниц lex.uz 2026-07-19) ─────────
  { id: '4674893', note: 'Налоговый кодекс РУз (ЗРУ-599, 30.12.2019)', minArticles: 380 },
  { id: '149947', note: 'Земельный кодекс РУз (30.04.1998)', minArticles: 70 },
  { id: '4562846', note: 'О валютном регулировании — действующая редакция (ЗРУ-573, 22.10.2019)', minArticles: 26, title: 'ЗРУ-573-сон 22.10.2019. О валютном регулировании (в новой редакции)', supersedes: '81459' },
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
  { id: '77168', note: 'Об изобретениях, полезных моделях и промышленных образцах — действующая редакция (397-II, 29.08.2002)', minArticles: 42, title: '397-II-сон 29.08.2002. Об изобретениях, полезных моделях и промышленных образцах (в новой редакции)', supersedes: '75902' },
  { id: '6936', note: 'О товарных знаках, знаках обслуживания и наименованиях мест происхождения товаров (267-II, 30.08.2001)', minArticles: 36 },
  { id: '4396428', note: 'О персональных данных (ЗРУ-547, 02.07.2019)', minArticles: 33 },
  { id: '6213428', note: 'Об электронной коммерции (ЗРУ-792, 29.09.2022)', minArticles: 28 },
  // ── Волна 4 (ID проверены --dry-run по заголовкам страниц lex.uz 2026-07-28) ─
  { id: '13896', note: 'Об исполнении судебных актов и актов иных органов (258-II, 29.08.2001)', minArticles: 105 },
  { id: '57043', note: 'О нотариате (343-I, 26.12.1996)', minArticles: 100 },
  { id: '5307955', note: 'Градостроительный кодекс РУз (ЗРУ-676, 22.02.2021)', minArticles: 78 },
  { id: '4575788', note: 'О платежах и платёжных системах (ЗРУ-578, 01.11.2019)', minArticles: 58 },
  { id: '2662541', note: 'О рынке ценных бумаг — действующая редакция (ЗРУ-387, 03.06.2015)', minArticles: 58, title: 'ЗРУ-387-сон 03.06.2015. О рынке ценных бумаг (в новой редакции)', supersedes: '1374867' },
  { id: '1072094', note: 'О третейских судах (ЗРУ-64, 16.10.2006)', minArticles: 54 },
  { id: '5294087', note: 'О международном коммерческом арбитраже (ЗРУ-674, 16.02.2021)', minArticles: 50 },
  { id: '4581971', note: 'О банках и банковской деятельности — действующая редакция (ЗРУ-580, 05.11.2019)', minArticles: 79, title: 'ЗРУ-580-сон 05.11.2019. О банках и банковской деятельности (в новой редакции)', supersedes: '12011' },
  { id: '4329272', note: 'О государственно-частном партнёрстве (ЗРУ-537, 10.05.2019)', minArticles: 40 },
  { id: '2931251', note: 'О бухгалтерском учёте — действующая редакция (ЗРУ-404, 13.04.2016)', minArticles: 28, title: 'ЗРУ-404-сон 13.04.2016. О бухгалтерском учете (в новой редакции)', supersedes: '90764' },
  // ── Волна 5 (ID проверены --dry-run по заголовкам страниц lex.uz 2026-07-28) ─
  { id: '106134', note: 'Жилищный кодекс РУз (24.12.1998)', minArticles: 130 },
  { id: '7051594', note: 'Об электроэнергетике (ЗРУ-939, 07.08.2024)', minArticles: 60 },
  { id: '5307899', note: 'Об аудиторской деятельности (ЗРУ-677, 25.02.2021)', minArticles: 50 },
  { id: '2006777', note: 'О гарантиях свободы предпринимательской деятельности — действующая редакция (ЗРУ-328, 02.05.2012)', minArticles: 48, title: 'ЗРУ-328-сон 02.05.2012. О гарантиях свободы предпринимательской деятельности (в новой редакции)', supersedes: '4177' },
  { id: '5972413', note: 'О небанковских кредитных организациях и микрофинансовой деятельности (ЗРУ-765, 20.04.2022)', minArticles: 40 },
  { id: '85248', note: 'О лизинге (756-I, 14.04.1999)', minArticles: 22 },
  { id: '67238', note: 'О внешнеэкономической деятельности — действующая редакция (77-II, 26.05.2000)', minArticles: 28, title: '77-II-сон 26.05.2000. О внешнеэкономической деятельности (в новой редакции)', supersedes: '67128' },
  // ── Волна 6 законов (ID проверены разведкой по страницам lex.uz 2026-07-29) ─
  { id: '3517334', note: 'Гражданский процессуальный кодекс РУз (ЗРУ-460, 22.01.2018)', minArticles: 350 },
  { id: '2460799', note: 'О коммерческой тайне (ЗРУ-374, 11.09.2014)', minArticles: 18 },
  { id: '165074', note: 'Об электронном документообороте (611-II, 29.04.2004)', minArticles: 16 },
  { id: '24701', note: 'Об оценочной деятельности (811-I, 19.08.1999, ред. до 2026)', minArticles: 18 },
  { id: '2462670', note: 'О биржах и биржевой деятельности — действующая редакция (ЗРУ-375, 12.09.2014)', minArticles: 20, title: 'ЗРУ-375-сон 12.09.2014. О биржах и биржевой деятельности (в новой редакции)', supersedes: '24493' },
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
  // ── Вершина иерархии (ст. 6 ЗРУ-682), 2026-10-31. 6445145 — узбекский
  //    текст Конституции, русский — 6445147 (переключатель «Рус» на lex.uz). ─
  { id: '6445147', note: 'Конституция Республики Узбекистан (референдум 30.04.2023)', minArticles: 150, romanHeadings: true },
  { id: '5378968', note: 'О нормативно-правовых актах (ЗРУ-682, 20.04.2021) — виды актов и их иерархия', minArticles: 58 },
  // ── Постановления Пленума ВС / бывшего ВХС, волна 1 (2026-10-31): действующие
  //    по поиску lex.uz (статус «действует»), гражданские и экономические дела.
  //    Номер, дата и суд сверяются с шапкой страницы. ─────────────────────
  // ВХС — экономические (хозяйственные) споры
  { id: '1636812', note: 'Пленум ВХС № 163: имущественная ответственность за неисполнение обязательств (неустойка, убытки)', minArticles: 18, kind: 'plenum', plenum: { court: 'ВХС', number: '163', date: '15.06.2007' } },
  { id: '2535146', note: 'Пленум ВХС № 269: недействительность сделок', minArticles: 41, kind: 'plenum', plenum: { court: 'ВХС', number: '269', date: '28.11.2014' } },
  { id: '2026136', note: 'Пленум ВХС № 203: заключение, изменение и расторжение хозяйственных договоров', minArticles: 23, kind: 'plenum', plenum: { court: 'ВХС', number: '203', date: '18.12.2009' } },
  { id: '1643250', note: 'Пленум ВХС № 103: применение Закона «О договорно-правовой базе…»', minArticles: 14, kind: 'plenum', plenum: { court: 'ВХС', number: '103', date: '04.03.2002' } },
  { id: '1643540', note: 'Пленум ВХС № 174: поставка товаров ненадлежащего качества', minArticles: 18, kind: 'plenum', plenum: { court: 'ВХС', number: '174', date: '28.12.2007' } },
  { id: '1643530', note: 'Пленум ВХС № 175: невыборка товаров', minArticles: 9, kind: 'plenum', plenum: { court: 'ВХС', number: '175', date: '28.12.2007' } },
  { id: '2004727', note: 'Пленум ВХС № 234: имущественный наём (аренда)', minArticles: 29, kind: 'plenum', plenum: { court: 'ВХС', number: '234', date: '01.12.2011' } },
  { id: '3106546', note: 'Пленум ВХС № 306: договор строительного подряда', minArticles: 34, kind: 'plenum', plenum: { court: 'ВХС', number: '306', date: '23.12.2016' } },
  { id: '2851023', note: 'Пленум ВХС № 289: лизинг', minArticles: 22, kind: 'plenum', plenum: { court: 'ВХС', number: '289', date: '27.11.2015' } },
  { id: '1636322', note: 'Пленум ВХС № 110: уступка права требования', minArticles: 10, kind: 'plenum', plenum: { court: 'ВХС', number: '110', date: '28.02.2003' } },
  { id: '2712570', note: 'Пленум ВХС № 282: исковая давность', minArticles: 33, kind: 'plenum', plenum: { court: 'ВХС', number: '282', date: '19.06.2015' } },
  { id: '1947976', note: 'Пленум ВХС № 220: признание права собственности', minArticles: 20, kind: 'plenum', plenum: { court: 'ВХС', number: '220', date: '19.11.2010' } },
  { id: '2453502', note: 'Пленум ВХС № 262: корпоративные споры', minArticles: 29, kind: 'plenum', plenum: { court: 'ВХС', number: '262', date: '20.06.2014' } },
  { id: '6920024', note: 'Пленум ВХС № 290: недействительность сделок хозяйственных обществ при нарушении раскрытия информации', minArticles: 18, kind: 'plenum', plenum: { court: 'ВХС', number: '290', date: '27.11.2015' } },
  { id: '2483048', note: 'Пленум ВХС № 238: третейское разбирательство', minArticles: 31, kind: 'plenum', plenum: { court: 'ВХС', number: '238', date: '15.06.2012' } },
  { id: '2026265', note: 'Пленум ВХС № 204: мировое соглашение', minArticles: 20, kind: 'plenum', plenum: { court: 'ВХС', number: '204', date: '18.12.2009' } },
  // Совместные ВС и ВХС
  { id: '1480288', note: 'Пленумы ВС и ВХС № 13/150: обеспечение обязательств по кредитным договорам (залог, поручительство, гарантия)', minArticles: 39, kind: 'plenum', plenum: { court: 'ВС+ВХС', number: '13/150', date: '22.12.2006' } },
  { id: '2075846', note: 'Пленумы ВС и ВХС № 12/239: законодательство о субъектах предпринимательства', minArticles: 11, kind: 'plenum', plenum: { court: 'ВС+ВХС', number: '12/239', date: '14.09.2012' } },
  { id: '1617966', note: 'Пленумы ВС и ВХС № 06/196: исполнение судебных актов', minArticles: 19, kind: 'plenum', plenum: { court: 'ВС+ВХС', number: '06/196', date: '10.04.2009' } },
  // ВС — гражданские дела и (после 2017) экономические
  { id: '1590546', note: 'Пленум ВС № 17 (2006): сделки', minArticles: 22, kind: 'plenum', plenum: { court: 'ВС', number: '17', date: '22.12.2006' } },
  { id: '1448771', note: 'Пленум ВС № 16 (1999): применение Гражданского кодекса', minArticles: 18, kind: 'plenum', plenum: { court: 'ВС', number: '16', date: '24.09.1999' } },
  { id: '3515219', note: 'Пленум ВС № 45 (2017): договор страхования', minArticles: 35, kind: 'plenum', plenum: { court: 'ВС', number: '45', date: '29.11.2017' } },
  { id: '2307200', note: 'Пленум ВС № 20 (2013): дела о предпринимательской деятельности', minArticles: 13, kind: 'plenum', plenum: { court: 'ВС', number: '20', date: '11.12.2013' } },
  { id: '6686276', note: 'Пленум ВС № 27 (2023): экономические дела с участием иностранных лиц', minArticles: 65, kind: 'plenum', plenum: { court: 'ВС', number: '27', date: '20.11.2023' } },
  { id: '6522625', note: 'Пленум ВС № 19 (2023): интеллектуальная собственность', minArticles: 49, kind: 'plenum', plenum: { court: 'ВС', number: '19', date: '23.06.2023' } },
  { id: '1449507', note: 'Пленум ВС № 7 (2000): компенсация морального вреда', minArticles: 14, kind: 'plenum', plenum: { court: 'ВС', number: '7', date: '28.04.2000' } },
  { id: '7901166', note: 'Пленум ВС № 21 (2025): защита личных неимущественных прав (честь, деловая репутация)', minArticles: 37, kind: 'plenum', plenum: { court: 'ВС', number: '21', date: '24.11.2025' } },
  { id: '6684617', note: 'Пленум ВС № 26 (2023): прекращение трудового договора', minArticles: 66, kind: 'plenum', plenum: { court: 'ВС', number: '26', date: '20.11.2023' } },
  { id: '1454005', note: 'Пленум ВС № 18 (2003): возмещение вреда жизни и здоровью работника', minArticles: 18, kind: 'plenum', plenum: { court: 'ВС', number: '18', date: '19.12.2003' } },
  { id: '6402539', note: 'Пленум ВС № 4 (2023): налоговое законодательство', minArticles: 36, kind: 'plenum', plenum: { court: 'ВС', number: '4', date: '20.02.2023' } },
  { id: '6687431', note: 'Пленум ВС № 28 (2023): земельные споры', minArticles: 36, kind: 'plenum', plenum: { court: 'ВС', number: '28', date: '20.11.2023' } },
  { id: '1452369', note: 'Пленум ВС № 22 (2001): жилищные споры', minArticles: 23, kind: 'plenum', plenum: { court: 'ВС', number: '22', date: '14.09.2001' } },
  { id: '6524157', note: 'Пленум ВС № 16 (2023): прямое применение норм Конституции', minArticles: 15, kind: 'plenum', plenum: { court: 'ВС', number: '16', date: '23.06.2023' } },
  { id: '8346846', note: 'Пленум ВС № 19 (2026): меры по обеспечению иска', minArticles: 27, kind: 'plenum', plenum: { court: 'ВС', number: '19', date: '03.07.2026' } },
  { id: '5194333', note: 'Пленум ВС № 36 (2020): судебные расходы по экономическим делам', minArticles: 30, kind: 'plenum', plenum: { court: 'ВС', number: '36', date: '19.12.2020' } },
  { id: '4395744', note: 'Пленум ВС № 13 (2019): экономический процесс в первой инстанции', minArticles: 42, kind: 'plenum', plenum: { court: 'ВС', number: '13', date: '24.05.2019' } },
  // ── Волна 7 (2026-10-31): кодексы и законы для бизнеса. ID — русские версии
  //    (узбекские 104720/3527353 — НЕ брать), найдены поиском lex.uz, у всех
  //    страниц нет пометки «изложен в новой редакции» / «утратил силу». ─────
  { id: '97661', note: 'Кодекс об административной ответственности (22.09.1994)', minArticles: 600 },
  { id: '104723', note: 'Семейный кодекс (30.04.1998)', minArticles: 198 },
  { id: '3527365', note: 'Кодекс об административном судопроизводстве (25.01.2018)', minArticles: 278 },
  { id: '4590456', note: 'О Центральном банке — действующая редакция (ЗРУ-582, 11.11.2019; 72252 — старый текст 154-I)', minArticles: 70, title: 'ЗРУ-582-сон 11.11.2019. О Центральном банке Республики Узбекистан (в новой редакции)' },
  { id: '284542', note: 'О противодействии легализации доходов… (660-II, 26.08.2004)', minArticles: 23 },
  { id: '3088013', note: 'О противодействии коррупции (ЗРУ-419, 03.01.2017)', minArticles: 37 },
  { id: '6952745', note: 'О конфликте интересов (ЗРУ-931, 05.06.2024)', minArticles: 30 },
  { id: '82956', note: 'Об информатизации (560-II, 11.12.2003)', minArticles: 22 },
  { id: '3031429', note: 'Об охране труда — действующая редакция (ЗРУ-410, 22.09.2016; 97258 — старый текст 839-XII)', minArticles: 32, title: 'ЗРУ-410-сон 22.09.2016. Об охране труда (в новой редакции)' },
  { id: '5055696', note: 'О занятости населения (ЗРУ-642, 20.10.2020)', minArticles: 110 },
  { id: '2258570', note: 'О залоговом реестре (ЗРУ-356, 23.10.2013)', minArticles: 16 },
  { id: '1878085', note: 'Об обмене кредитной информацией (ЗРУ-301, 04.10.2011)', minArticles: 27 },
  { id: '1342476', note: 'Об обязательном страховании гражданской ответственности владельцев транспортных средств (ЗРУ-155, 21.04.2008)', minArticles: 40 },
  { id: '6800650', note: 'О приватизации государственного имущества (ЗРУ-907, 14.02.2024; сменил «О разгосударствлении и приватизации»)', minArticles: 40 },
  { id: '2004954', note: 'О семейном предпринимательстве (ЗРУ-327, 26.04.2012)', minArticles: 30 },
  { id: '275191', note: 'О фермерском хозяйстве — действующая редакция (662-II, 26.08.2004; 5826 — старый текст 602-I)', minArticles: 30, title: '662-II-сон 26.08.2004. О фермерском хозяйстве (в новой редакции)' },
  { id: '4428101', note: 'О туризме (ЗРУ-549, 18.07.2019)', minArticles: 40 },
  { id: '7283074', note: 'О телекоммуникациях (ЗРУ-1015, 27.12.2024; сменил 822-I)', minArticles: 33 },
  { id: '8385395', note: 'О риэлторской деятельности (ЗРУ-1163, 07.08.2026)', minArticles: 38 },
  { id: '4680955', note: 'О государственной пошлине (ЗРУ-600, 06.01.2020; ставки — в приложении, оно не разбирается)', minArticles: 30 },
  { id: '8358428', note: 'О возмещении вреда, причинённого незаконным решением, действием либо бездействием госоргана (ЗРУ-1161, 27.07.2026)', minArticles: 20 },
  { id: '3336171', note: 'Об обращениях физических и юридических лиц — действующая редакция (ЗРУ-445, 11.09.2017; 2509998 — старый текст ЗРУ-378)', minArticles: 35, title: 'ЗРУ-445-сон 11.09.2017. Об обращениях физических и юридических лиц (в новой редакции)' },
  { id: '5534928', note: 'О судах (ЗРУ-703, 28.07.2021)', minArticles: 91 },
  { id: '58372', note: 'Об адвокатуре (349-I, 27.12.1996)', minArticles: 27 },
  // ── Постановления Пленума, волна 2 (2026-10-31): гражданский и экономический
  //    процесс, семья и наследство, жильё. Критерии те же, что у волны 1. ──
  { id: '4902531', note: 'Пленум ВС № 11 (2020): О судебной защите прав и законных интересов физических и юридических лиц', minArticles: 1, kind: 'plenum', plenum: { court: 'ВС', number: '11', date: '03.07.2020' } },
  { id: '8345471', note: 'Пленум ВС № 18 (2026): О практике рассмотрения судами дел о признании гражданина ограниченно дееспособным или недееспособным', minArticles: 1, kind: 'plenum', plenum: { court: 'ВС', number: '18', date: '03.07.2026' } },
  { id: '2414105', note: 'Пленум ВС № 05 (2010): О применении судами норм гражданского процессуального законодательства о представительстве', minArticles: 1, kind: 'plenum', plenum: { court: 'ВС', number: '05', date: '14.05.2010' } },
  { id: '1440210', note: 'Пленум ВС № 13 (1993): О применении законодательства при рассмотрении судами дел об освобождении имущества от ареста (исключении из о', minArticles: 1, kind: 'plenum', plenum: { court: 'ВС', number: '13', date: '16.04.1993' } },
  { id: '7305237', note: 'Пленум ВС № 37 (2024): О практике взыскания судебных расходов по гражданским делам', minArticles: 1, kind: 'plenum', plenum: { court: 'ВС', number: '37', date: '16.12.2024' } },
  { id: '3761329', note: 'Пленум ВС № 14 (2018): О некоторых вопросах применения судом первой инстанции норм гражданского процессуального законодательства', minArticles: 1, kind: 'plenum', plenum: { court: 'ВС', number: '14', date: '19.05.2018' } },
  { id: '3761220', note: 'Пленум ВС № 15 (2018): О некоторых вопросах применения судом первой инстанции норм процессуального законодательства при рассмотрении ', minArticles: 1, kind: 'plenum', plenum: { court: 'ВС', number: '15', date: '19.05.2018' } },
  { id: '5185746', note: 'Пленум ВС № 35 (2020): О практике применения судами норм закона о доказательствах и доказывании по гражданским делам', minArticles: 1, kind: 'plenum', plenum: { court: 'ВС', number: '35', date: '19.12.2020' } },
  { id: '2414323', note: 'Пленум ВС № 05 (2011): О применении судами законодательства о праве наследования', minArticles: 1, kind: 'plenum', plenum: { court: 'ВС', number: '05', date: '20.07.2011' } },
  { id: '2414116', note: 'Пленум ВС № 06 (2011): О практике применения судами законодательства по делам о расторжении брака', minArticles: 1, kind: 'plenum', plenum: { court: 'ВС', number: '06', date: '20.07.2011' } },
  { id: '4396488', note: 'Пленум ВС № 12 (2019): О решении суда', minArticles: 1, kind: 'plenum', plenum: { court: 'ВС', number: '12', date: '24.05.2019' } },
  { id: '3897694', note: 'Пленум ВС № 26 (2018): О подготовке гражданских дел к судебному разбирательству', minArticles: 1, kind: 'plenum', plenum: { court: 'ВС', number: '26', date: '24.08.2018' } },
  { id: '1455963', note: 'Пленум ВС № 14 (2004): О судебной практике по спорам, связанным с правом собственности на жилой дом индивидуального строительства', minArticles: 1, kind: 'plenum', plenum: { court: 'ВС', number: '14', date: '24.09.2004' } },
  { id: '4711315', note: 'Пленум ВС № 24 (2019): О судебной практике по рассмотрению дел об обжаловании решений, действий (бездействия) административных органо', minArticles: 1, kind: 'plenum', plenum: { court: 'ВС', number: '24', date: '24.12.2019' } },
  { id: '4698302', note: 'Пленум ВС № 25 (2019): О применении судами законодательства, регламентирующего пересмотр вступивших в законную силу судебных актов по', minArticles: 1, kind: 'plenum', plenum: { court: 'ВС', number: '25', date: '24.12.2019' } },
  { id: '6878576', note: 'Пленум ВС № 10 (2024): О некоторых вопросах рассмотрения судами экономических дел в апелляционном, кассационном порядке', minArticles: 1, kind: 'plenum', plenum: { court: 'ВС', number: '10', date: '25.03.2024' } },
  { id: '6877320', note: 'Пленум ВС № 11 (2024): О некоторых вопросах рассмотрения административных дел в апелляционном, кассационном порядке', minArticles: 1, kind: 'plenum', plenum: { court: 'ВС', number: '11', date: '25.03.2024' } },
  { id: '7004658', note: 'Пленум ВС № 20 (2024): О некоторых вопросах рассмотрения судами гражданских дел в ревизионном порядке', minArticles: 1, kind: 'plenum', plenum: { court: 'ВС', number: '20', date: '25.06.2024' } },
  { id: '7000818', note: 'Пленум ВС № 21 (2024): О некоторых вопросах рассмотрения судами экономических дел в ревизионном порядке', minArticles: 1, kind: 'plenum', plenum: { court: 'ВС', number: '21', date: '25.06.2024' } },
  { id: '7002342', note: 'Пленум ВС № 22 (2024): О некоторых вопросах рассмотрения судами административных дел в ревизионном порядке', minArticles: 1, kind: 'plenum', plenum: { court: 'ВС', number: '22', date: '25.06.2024' } },
  { id: '4597593', note: 'Пленум ВС № 19 (2019): Об определениях суда первой инстанции по гражданским делам', minArticles: 1, kind: 'plenum', plenum: { court: 'ВС', number: '19', date: '25.10.2019' } },
  { id: '4619321', note: 'Пленум ВС № 20 (2019): О практике взыскания судебных расходов по административным делам', minArticles: 1, kind: 'plenum', plenum: { court: 'ВС', number: '20', date: '25.10.2019' } },
  { id: '3034917', note: 'Пленум ВС № 11 (2016): О практике применения судами законодательства по делам о взыскании алиментов на содержание несовершеннолетних ', minArticles: 1, kind: 'plenum', plenum: { court: 'ВС', number: '11', date: '29.07.2016' } },
  { id: '1442998', note: 'Пленум ВС № 3 (1997): О судебной практике по делам, связанным с владением, пользованием и распоряжением приватизированными жилыми по', minArticles: 1, kind: 'plenum', plenum: { court: 'ВС', number: '3', date: '02.05.1997' } },
  { id: '1455988', note: 'Пленум ВС № 4 (2006): О некоторых вопросах, связанных с применением законодательства, регулирующего приказное производство', minArticles: 1, kind: 'plenum', plenum: { court: 'ВС', number: '4', date: '03.02.2006' } },
  { id: '6402543', note: 'Пленум ВС № 3 (2023): О практике применения судами законодательства при рассмотрении дел о разделе общего имущества супругов', minArticles: 1, kind: 'plenum', plenum: { court: 'ВС', number: '3', date: '20.02.2023' } },
  { id: '6881088', note: 'Пленум ВС № 9 (2024): О некоторых вопросах рассмотрения судами гражданских дел в апелляционном, кассационном порядке', minArticles: 1, kind: 'plenum', plenum: { court: 'ВС', number: '9', date: '25.03.2024' } },
  { id: '2712889', note: 'Пленум ВХС № 283 (2015): О некоторых вопросах применения экономическими судами норм законодательства о процессуальных сроках', minArticles: 1, kind: 'plenum', plenum: { court: 'ВХС', number: '283', date: '19.06.2015' } },
  { id: '2453493', note: 'Пленум ВХС № 261 (2014): О некоторых вопросах применения экономическими судами законодательства об экспертизе', minArticles: 1, kind: 'plenum', plenum: { court: 'ВХС', number: '261', date: '20.06.2014' } },
  { id: '2338576', note: 'Пленум ВХС № 254 (2013): О некоторых вопросах применения экономическими судами норм процессуального законодательства при рассмотрении д', minArticles: 1, kind: 'plenum', plenum: { court: 'ВХС', number: '254', date: '05.12.2013' } },
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
      if (doc.kind === 'plenum' && !doc.plenum) throw new Error(`запись ${doc.id} kind=plenum без суда/номера/даты — заполни UZ_DOCS`);
      const parsed =
        doc.kind === 'decree'
          ? parseLexUzDecreeHtml(doc.id, html, url)
          : doc.kind === 'plenum'
            ? parseLexUzPlenumHtml(doc.id, html, url, doc.plenum!)
            : parseLexUzHtml(doc.id, html, url, { romanHeadings: doc.romanHeadings, title: doc.title });
      // Повтор id внутри документа = upsert молча затёр бы одну статью другой.
      const dupId = parsed.units.map((u) => u.id).find((id, i, all) => all.indexOf(id) !== i);
      if (dupId) throw new Error(`duplicate unit id ${dupId} for lex.uz/${doc.id} — refusing`);
      // Страница со старым текстом (lex.uz: «Акт изложен в новой редакции») в
      // корпус не попадает: действующий текст — на странице закона-изменения.
      const warning = html.match(/class="act_warning">\s*([^<]*)/)?.[1]?.trim() ?? '';
      if (/изложен в новой редакции|утратил\S*\s+силу/iu.test(warning)) {
        throw new Error(`lex.uz/${doc.id}: «${warning}» — это не действующий текст, возьми действующую редакцию — refusing`);
      }
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
      const leaf = doc.kind === 'decree' || doc.kind === 'plenum' ? 'пунктов' : 'статей';
      // Parse-coverage floor BEFORE any write.
      if (secs.length < doc.minArticles) {
        throw new Error(
          `parsed only ${secs.length} ${leaf} for «${parsed.title}» (expected ≥ ${doc.minArticles}) — markup drift? refusing`,
        );
      }
      if (dryRun) {
        detail[doc.id] = { title: parsed.title, units: parsed.units.length, articles: secs.length };
        console.log(`[dry-run] ${doc.id} «${parsed.title}»${parsed.docNumber ? ` [${parsed.docNumber}]` : ''}${doc.supersedes ? ` (заменит устаревшую lex.uz/${doc.supersedes})` : ''}`);
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
        if (doc.supersedes) {
          // Каскад: статьи и чанки устаревшей редакции уходят вместе с документом.
          const gone = await db!.query(`DELETE FROM legal_documents WHERE id = $1 AND jurisdiction = 'UZ' RETURNING id`, [`ld_uz_${doc.supersedes}`]);
          if (gone.rows.length) console.log(`            устаревшая редакция lex.uz/${doc.supersedes} удалена из корпуса`);
        }
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

// Запуск только напрямую (npm run rag:ingest…): импорт списка документов из
// другого скрипта не должен сам писать в базу.
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) void main();
