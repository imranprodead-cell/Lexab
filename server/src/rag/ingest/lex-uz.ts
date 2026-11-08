/**
 * lex.uz (Национальная база данных законодательства РУз) — official source
 * for Uzbekistan. Fetches the CURRENT redaction of a document (Russian
 * version, /ru/docs/<id>) and parses the ACT_TEXT paragraph stream into
 * legal units: РАЗДЕЛ → ГЛАВА → Статья.
 *
 * Page structure (verified live 2026-07-10): the body is a flat sequence of
 * <div class="ACT_TEXT lx_elem"> blocks, each wrapping <div name="ID" id="ID">
 * with one paragraph. Articles start with «Статья N.», chapters with
 * «ГЛАВА N», parts with «РАЗДЕЛ N». Everything else is body text of the
 * current article.
 */
import { createHash } from 'node:crypto';
import type { LegalUnit } from '../types.ts';
import type { ParsedDocument } from './upsert.ts';
import { normalizePlenumNumber, normalizeUzDocNumber, plenumDocNumber, type PlenumCourt } from '../uz-doc-number.ts';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function fetchLexUzHtml(docId: string): Promise<{ html: string; url: string }> {
  const url = `https://lex.uz/ru/docs/${docId}`;
  let lastErr: Error | null = null;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { 'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Lexab-corpus-ingest/1.0' },
      });
      if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`);
      if (!res.ok) throw new Error(`HTTP ${res.status} (permanent)`);
      const html = await res.text();
      if (!html.includes('ACT_TEXT')) throw new Error('page has no ACT_TEXT blocks');
      return { html, url };
    } catch (err) {
      lastErr = err as Error;
      if (String(lastErr.message).includes('permanent')) break;
      await sleep(1500 * attempt * attempt);
    }
  }
  throw new Error(`fetch ${url} failed: ${lastErr?.message}`);
}

const decodeEntities = (s: string): string =>
  s
    .replace(/&nbsp;/g, ' ')
    .replace(/&laquo;/g, '«')
    .replace(/&raquo;/g, '»')
    .replace(/&mdash;/g, '—')
    .replace(/&ndash;/g, '–')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));

const strip = (html: string): string => decodeEntities(html.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();

/** Надстрочный номер вставной статьи/пункта: «383<sup>1</sup>» → «383-1».
 *  atStart — только в начале абзаца (номер пункта), не в тексте («м<sup>2</sup>»). */
export function supToDash(html: string, atStart = false): string {
  // Точка бывает и внутри <sup> («27<sup>1.</sup>») — выносим её наружу.
  const re = atStart
    ? /^(\s*(?:<[^>]+>\s*)*\d{1,4})\s*<sup>\s*(\d{1,2})(\.?)\s*<\/sup>/i
    : /(\d)\s*<sup>\s*(\d{1,2})(\.?)\s*<\/sup>/gi;
  return html.replace(re, '$1-$2$3');
}

/** Short display title: «Гражданский кодекс Республики Узбекистан (часть первая)». */
function titleOf(html: string): { title: string; adopted: string | null } {
  const m = html.match(/<title>(.*?)<\/title>/s);
  const raw = strip(m?.[1] ?? '');
  const date = raw.match(/(\d{2}\.\d{2}\.\d{4})/)?.[1] ?? null;
  const title = raw.replace(/^[\s.]*\d{2}\.\d{2}\.\d{4}[\s.]*/, '').trim() || raw;
  const adopted = date ? `${date.slice(6, 10)}-${date.slice(3, 5)}-${date.slice(0, 2)}` : null;
  return { title, adopted };
}

/** «РАЗДЕЛ ПЕРВЫЙ» → 1 (Конституция нумерует разделы словами). */
const ORDINAL_WORDS = ['ПЕРВЫЙ', 'ВТОРОЙ', 'ТРЕТИЙ', 'ЧЕТВЕРТЫЙ', 'ПЯТЫЙ', 'ШЕСТОЙ', 'СЕДЬМОЙ', 'ВОСЬМОЙ', 'ДЕВЯТЫЙ', 'ДЕСЯТЫЙ'];
const ordinalToInt = (word: string): number | null => {
  const i = ORDINAL_WORDS.indexOf(word.toUpperCase().replace(/Ё/g, 'Е'));
  return i < 0 ? null : i + 1;
};

/** «Глава ХIV» → 14. На lex.uz римские цифры местами набраны кириллицей
 *  (Х и І вместо X и I) — приводим к латинице перед разбором. */
export function romanToInt(raw: string): number | null {
  const s = raw.toUpperCase().replace(/Х/g, 'X').replace(/І/g, 'I').replace(/С/g, 'C').replace(/М/g, 'M');
  if (!/^[IVXLCDM]+$/.test(s)) return null;
  const val: Record<string, number> = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };
  let total = 0;
  for (let i = 0; i < s.length; i++) {
    const cur = val[s[i]];
    const next = val[s[i + 1]] ?? 0;
    total += cur < next ? -cur : cur;
  }
  return total > 0 ? total : null;
}

export interface LexUzLawOptions {
  /** Разделы словами («РАЗДЕЛ ПЕРВЫЙ») и главы римскими цифрами («Глава ХIV»),
   *  как в Конституции. Включается ТОЛЬКО для отмеченных документов — разбор
   *  остальных законов не меняется ни на символ. */
  romanHeadings?: boolean;
  /** Название вместо <title> страницы. Нужно для законов «в новой редакции»:
   *  действующий текст лежит на странице закона-изменения («О внесении
   *  изменений… в Закон «О банках…»»), а юрист и ИИ должны видеть имя
   *  самого закона. */
  title?: string;
}

export function parseLexUzHtml(docId: string, html: string, url: string, opts: LexUzLawOptions = {}): ParsedDocument {
  const page = titleOf(html);
  const title = opts.title ?? page.title;
  const { adopted } = page;
  const retrievedAt = new Date().toISOString();
  const sha256 = createHash('sha256').update(html).digest('hex');

  // Ordered block stream. Verified classes (2026-07-10):
  //   CLAUSE_DEFAULT      — заголовок статьи («Статья 1. …»)
  //   TEXT_HEADER_DEFAULT — РАЗДЕЛ / ПОДРАЗДЕЛ / ГЛАВА / «Часть …»
  //   ACT_TEXT            — абзац текста статьи
  //   BY_DEFAULT          — прочие абзацы (обычно пустые/служебные)
  //   COMMENTLEXUZ        — редакционные сноски (НЕ текст закона — пропускаем)
  const paras: { anchor: string; cls: string; text: string }[] = [];
  const re = /<div class="(CLAUSE_DEFAULT|TEXT_HEADER_DEFAULT|ACT_TEXT|BY_DEFAULT)(?: lx_elem)?"[\s\S]*?<div name="(\d+)" id="\2">([\s\S]*?)<\/div><\/div>/g;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    // «Статья 1<sup>1</sup>» (вставная статья 1¹) → «Статья 1-1». Без этого
    // strip склеивал номер в «11», и статья 1¹ затирала настоящую статью 11.
    const text = strip(m[1] === 'CLAUSE_DEFAULT' ? supToDash(m[3]) : m[3]);
    if (text) paras.push({ anchor: m[2], cls: m[1], text });
  }
  if (!paras.length) throw new Error(`parsed 0 paragraphs for lex.uz/${docId} — refusing partial save`);

  const unitId = (suffix: string) => `lu_uz_${docId}_${suffix}`;
  const base = { language: 'ru', validFrom: adopted, validTo: null as string | null, sourceUrl: url, retrievedAt };
  const units: Omit<LegalUnit, 'documentId'>[] = [];
  let ord = 0;
  const push = (u: Omit<LegalUnit, 'documentId' | 'ord' | 'sha256Checksum' | 'retrievedAt' | 'sourceUrl' | 'language' | 'validTo' | 'validFrom'>) => {
    units.push({
      ...u,
      ...base,
      ord: ord++,
      sha256Checksum: createHash('sha256').update(`${u.breadcrumb}|${u.heading ?? ''}|${u.text}`).digest('hex'),
    });
  };

  const crumbRoot = `UZ / ${title}`;
  let part: { id: string; label: string; num: string } | null = null;
  // Повтор номера раздела/главы = началось приложение со своей нумерацией
  // (ЗРУ-682: после гл. 1–8 закона идут гл. 1–8 приложения). Без этого его
  // главы затирали главы самого закона.
  const seenStruct = new Set<string>();
  const repeatStartsAnnex = (id: string): boolean => {
    if (!seenStruct.has(id)) {
      seenStruct.add(id);
      return false;
    }
    flushArticle();
    inAnnex = true;
    return true;
  };
  let subpart: { id: string; label: string } | null = null;
  let chapter: { id: string; label: string } | null = null;
  let article: { id: string; num: string; heading: string; anchor: string; body: string[] } | null = null;
  let sections = 0;
  // Приложения (утверждённые положения/перечни) — НЕ текст статей самого акта.
  // До этой правки их абзацы приклеивались к последней статье; теперь после
  // «ПРИЛОЖЕНИЕ…» контент игнорируется до следующего РАЗДЕЛ/ГЛАВА основного
  // текста. Консервативно: «Статья N» внутри приложения — это статья
  // приложения, не акта (id столкнулись бы с st-N), поэтому тоже пропускается.
  let inAnnex = false;

  const crumb = () => [crumbRoot, part?.label, subpart?.label, chapter?.label].filter(Boolean).join(' / ');
  const flushArticle = () => {
    if (!article) return;
    push({
      id: article.id,
      parentId: chapter?.id ?? part?.id ?? null,
      unitType: 'section',
      number: article.num,
      heading: article.heading || null,
      breadcrumb: `${crumb()} / ст.${article.num}`,
      text: article.body.join('\n'),
      officialUnitUri: `${url}#${article.anchor}`,
    });
    sections++;
    article = null;
  };

  for (const p of paras) {
    // Начало приложения (любой класс блока) → всё дальнейшее не текст акта.
    if (/^ПРИЛОЖЕНИЕ(\s|№|$)/iu.test(p.text)) {
      flushArticle();
      inAnnex = true;
      continue;
    }
    if (p.cls === 'TEXT_HEADER_DEFAULT') {
      let razdel = p.text.match(/^РАЗДЕЛ\s+([IVXLC\d]+)\.?\s*(.*)/i);
      const podrazdel = p.text.match(/^ПОДРАЗДЕЛ\s+([IVXLC\d]+)\.?\s*(.*)/i);
      let glava = p.text.match(/^ГЛАВА\s+(\d+(?:-\d+)?)\.?\s*(.*)/i);
      if (opts.romanHeadings) {
        // Номер приводится к арабскому: id и breadcrumb в той же форме, что у
        // остальных законов («Раздел 1», «Глава 14»).
        const withNumber = (m: RegExpMatchArray, n: number) => [m[0], String(n), m[2]] as unknown as RegExpMatchArray;
        const w = razdel ? null : p.text.match(/^РАЗДЕЛ\s+([А-ЯЁ]+)\.?\s*(.*)/iu);
        const wn = w ? ordinalToInt(w[1]) : null;
        if (w && wn) razdel = withNumber(w, wn);
        const r = glava ? null : p.text.match(/^ГЛАВА\s+([IVXLCХІ]+)\.?\s*(.*)/iu);
        const rn = r ? romanToInt(r[1]) : null;
        if (r && rn) glava = withNumber(r, rn);
      }
      // Структурная шапка ОСНОВНОГО текста завершает режим приложения.
      if (razdel || podrazdel || glava) inAnnex = false;
      if (razdel) {
        flushArticle();
        const label = `Раздел ${razdel[1]}`;
        const id = unitId(`razdel-${razdel[1]}`);
        if (repeatStartsAnnex(id)) continue;
        part = { id, label, num: razdel[1] };
        subpart = null;
        chapter = null;
        push({ id, parentId: null, unitType: 'part', number: razdel[1], heading: razdel[2]?.trim() || null, breadcrumb: `${crumbRoot} / ${label}`, text: '', officialUnitUri: `${url}#${p.anchor}` });
      } else if (podrazdel) {
        flushArticle();
        const label = `Подраздел ${podrazdel[1]}`;
        // Номер раздела, а не цифры из подписи: у разделов с римскими номерами
        // («Раздел I») цифр нет, и подразделы разных разделов совпадали.
        const id = unitId(`podrazdel-${part?.num ?? 'x'}-${podrazdel[1]}`);
        if (repeatStartsAnnex(id)) continue;
        subpart = { id, label };
        chapter = null;
        push({ id, parentId: part?.id ?? null, unitType: 'part', number: podrazdel[1], heading: podrazdel[2]?.trim() || null, breadcrumb: `${crumbRoot}${part ? ` / ${part.label}` : ''} / ${label}`, text: '', officialUnitUri: `${url}#${p.anchor}` });
      } else if (glava) {
        flushArticle();
        const label = `Глава ${glava[1]}`;
        const id = unitId(`glava-${glava[1]}`);
        if (repeatStartsAnnex(id)) continue;
        chapter = { id, label };
        push({ id, parentId: subpart?.id ?? part?.id ?? null, unitType: 'chapter', number: glava[1], heading: glava[2]?.trim() || null, breadcrumb: [crumbRoot, part?.label, subpart?.label].filter(Boolean).join(' / ') + ` / ${label}`, text: '', officialUnitUri: `${url}#${p.anchor}` });
      }
      // «Часть первая», параграфы «§ 1. …» и прочие шапки не создают юнитов.
      continue;
    }
    if (p.cls === 'CLAUSE_DEFAULT') {
      if (inAnnex) continue; // «Статья N» приложения — не статья акта
      const statya = p.text.match(/^Статья\s+(\d+(?:[.-]\d+)*)\.?\s*(.*)/);
      if (statya) {
        flushArticle();
        article = { id: unitId(`st-${statya[1]}`), num: statya[1], heading: statya[2]?.trim() ?? '', anchor: p.anchor, body: [] };
      }
      continue;
    }
    // ACT_TEXT / BY_DEFAULT — тело текущей статьи (преамбула до первой статьи
    // и содержимое приложений пропускаются).
    if (article && !inAnnex) article.body.push(p.text);
  }
  flushArticle();
  if (sections === 0) throw new Error(`parsed 0 articles for lex.uz/${docId} — refusing partial save`);

  return {
    docId: `ld_uz_${docId}`,
    jurisdiction: 'UZ',
    officialSourceId: docId,
    docType: /кодекс/i.test(title) ? 'code' : 'act',
    title,
    sourceUrl: url,
    retrievedAt,
    sha256,
    modifiedOnSource: null,
    units,
  };
}

/* ── Указы (УП) и Постановления (ПП) Президента ──────────────────────────────
 * Отдельный режим (kind:'decree' в UZ_DOCS): такие акты состоят из нумерованных
 * ПУНКТОВ («1.», «2.» в блоках ACT_TEXT), не статей, поэтому parseLexUzHtml
 * выше для них неприменим — и НЕ меняется ни на символ (47 живых законов).
 *
 * Конвенции (разметка сверена вживую на УП-6079/ПП-3724/УП-184, 2026-07-28):
 *  - пункт → unit_type='section' (конвенция индексируемого листа конвейера,
 *    как art. N в legisquebec-ca.ts), родная форма в number и breadcrumb «п. N»;
 *  - id: lu_uz_<docid>_p-N, вставные пункты p-4-1; пункты приложений в своём
 *    неймспейсе prilK-p-N (иначе «п. 5» акта и «п. 5» положения столкнулись бы);
 *  - пункты-заглушки «(утратил силу)» юнитов не создают: нет юнита → цитата
 *    на него честно демотируется (fail-closed);
 *  - вложенные перечни «1., 2.» ВНУТРИ пункта не создают ложных пунктов —
 *    новый пункт принимается только при монотонном росте номера;
 *  - номер акта из шапки id="lx_lact_num_top" («от 05.10.2020 г. № УП-6079»)
 *    канонизируется normalizeUzDocNumber и уходит в legal_documents.doc_number.
 */
const DECREE_BLOCK_RE =
  /<div class="(CLAUSE_DEFAULT|TEXT_HEADER_DEFAULT|ACT_TEXT|BY_DEFAULT|ACT_TITLE_APPL|APPL_BANNER_LANDSCAPE_TITLE)((?:\s+[\w-]+)*)"[\s\S]*?<div name="(\d+)" id="\3">([\s\S]*?)<\/div><\/div>/g;

/** Заглушка целиком утратившего силу пункта (не содержательный текст). */
const REPEALED_STUB_RE = /^\(?\s*(?:пункт\s+[\d\s-]*)?утратил[аи]?\s+силу/iu;

export function parseLexUzDecreeHtml(docId: string, html: string, url: string): ParsedDocument {
  const { title, adopted: titleAdopted } = titleOf(html);
  const retrievedAt = new Date().toISOString();
  const sha256 = createHash('sha256').update(html).digest('hex');

  // Шапка: дата и номер акта. Fallback на ACT_ESSENTIAL_ELEMENTS_NUM (стиль ПП).
  const headText = strip(html.match(/id="lx_lact_num_top"[^>]*>([\s\S]{0,400}?)<\/div>/)?.[1] ?? '');
  const numText =
    headText || strip(html.match(/class="ACT_ESSENTIAL_ELEMENTS_NUM[^"]*"[^>]*>([\s\S]{0,200}?)<\/div>/)?.[1] ?? '');
  const headDate = headText.match(/(\d{2})\.(\d{2})\.(\d{4})/);
  const adopted = headDate ? `${headDate[3]}-${headDate[2]}-${headDate[1]}` : titleAdopted;
  const docNumber = normalizeUzDocNumber(numText.match(/№?\s*([А-ЯЁҚA-Z]{2,3}\s*[-–—−]\s*\d{1,5})/iu)?.[1] ?? null);

  const paras: { anchor: string; cls: string; text: string }[] = [];
  for (let m = DECREE_BLOCK_RE.exec(html); m; m = DECREE_BLOCK_RE.exec(html)) {
    // Вставной пункт «4<sup>1</sup>.» → «4-1.», а не «41.» (иначе монотонный
    // гейт принял бы его за пункт 41 и проглотил следующие пункты).
    const text = strip(supToDash(m[4], true));
    if (text) paras.push({ anchor: m[3], cls: m[1], text });
  }
  DECREE_BLOCK_RE.lastIndex = 0;
  if (!paras.length) throw new Error(`parsed 0 paragraphs for lex.uz/${docId} — refusing partial save`);

  const unitId = (suffix: string) => `lu_uz_${docId}_${suffix}`;
  const base = { language: 'ru', validFrom: adopted, validTo: null as string | null, sourceUrl: url, retrievedAt };
  const units: Omit<LegalUnit, 'documentId'>[] = [];
  const seenIds = new Set<string>();
  let ord = 0;
  const push = (u: Omit<LegalUnit, 'documentId' | 'ord' | 'sha256Checksum' | 'retrievedAt' | 'sourceUrl' | 'language' | 'validTo' | 'validFrom'>) => {
    // Инвариант: id внутри документа уникальны — иначе upsert молча перезаписал
    // бы один пункт другим (ON CONFLICT (id) DO UPDATE).
    if (seenIds.has(u.id)) throw new Error(`duplicate unit id ${u.id} for lex.uz/${docId} — refusing partial save`);
    seenIds.add(u.id);
    units.push({
      ...u,
      ...base,
      ord: ord++,
      sha256Checksum: createHash('sha256').update(`${u.breadcrumb}|${u.heading ?? ''}|${u.text}`).digest('hex'),
    });
  };

  const crumbRoot = `UZ / ${title}`;
  // Приложение материализуется лениво — контейнер создаётся при первом пункте,
  // когда его заголовок уже собран из подряд идущих шапочных блоков.
  let annex: { k: number; id: string; label: string; titleParts: string[]; materialized: boolean; anchor: string } | null = null;
  let annexCount = 0;
  let point: { id: string; num: string; anchor: string; body: string[] } | null = null;
  let lastBase = 0;
  let points = 0;

  const annexLabel = (a: NonNullable<typeof annex>): string => {
    const t = a.titleParts.join(' ').replace(/\s+/g, ' ').trim();
    return `прил. ${a.k}${t ? ` «${t.slice(0, 90)}»` : ''}`;
  };
  const flushPoint = () => {
    if (!point) return;
    const text = point.body.join('\n');
    if (text && !REPEALED_STUB_RE.test(text)) {
      push({
        id: point.id,
        parentId: annex?.materialized ? annex.id : null,
        unitType: 'section',
        number: point.num,
        heading: null,
        breadcrumb: `${annex ? `${crumbRoot} / ${annex.label}` : crumbRoot} / п. ${point.num}`,
        text,
        officialUnitUri: `${url}#${point.anchor}`,
      });
      points++;
    }
    point = null;
  };

  const isAnnexHeader = (p: { cls: string; text: string }): boolean =>
    p.cls === 'ACT_TITLE_APPL' ||
    p.cls === 'APPL_BANNER_LANDSCAPE_TITLE' ||
    /^ПРИЛОЖЕНИЕ(\s|№|$)/iu.test(p.text) ||
    (/^УТВЕРЖДЕН[АОЫ]?\b/iu.test(p.text) && /(указ|постановлен)/iu.test(p.text));

  for (const p of paras) {
    if (isAnnexHeader(p)) {
      flushPoint();
      lastBase = 0;
      if (annex && !annex.materialized) {
        // Несколько шапочных блоков подряд («УТВЕРЖДЕНА Указом…» + название) —
        // это заголовок ОДНОГО приложения, не новые приложения.
        annex.titleParts.push(p.text);
        annex.label = annexLabel(annex);
      } else {
        annexCount++;
        annex = { k: annexCount, id: unitId(`pril-${annexCount}`), label: '', titleParts: [p.text], materialized: false, anchor: p.anchor };
        annex.label = annexLabel(annex);
      }
      continue;
    }
    if (p.cls === 'TEXT_HEADER_DEFAULT') continue; // главы/разделы положений — не тело пунктов

    const cand = p.text.match(/^(\d{1,3}(?:[.-]\d{1,2})?)\.\s+([\s\S]*)/);
    if (cand) {
      const num = cand[1];
      const b = Number(num.split(/[.-]/)[0]);
      const suffixed = /[.-]/.test(num);
      // Монотонный гейт: принимаем только рост номера (разрывы от утративших
      // силу пунктов проходят, но не дальше +20 — защита от «2021. год…»),
      // либо вставной пункт «4-1» при том же базовом номере.
      const accept = (b > lastBase && b - lastBase <= 20) || (suffixed && b === lastBase);
      if (accept) {
        flushPoint();
        if (annex && !annex.materialized) {
          push({ id: annex.id, parentId: null, unitType: 'part', number: String(annex.k), heading: null, breadcrumb: `${crumbRoot} / ${annex.label}`, text: '', officialUnitUri: `${url}#${annex.anchor}` });
          annex.materialized = true;
        }
        point = {
          id: annex ? unitId(`pril${annex.k}-p-${num}`) : unitId(`p-${num}`),
          num,
          anchor: p.anchor,
          body: cand[2].trim() ? [cand[2].trim()] : [],
        };
        lastBase = b;
        continue;
      }
    }
    // Преамбула (до первого пункта) отбрасывается, как у законов; всё прочее —
    // тело текущего пункта (подпункты «а)», абзацы, вложенные перечни).
    if (point) point.body.push(p.text);
  }
  flushPoint();
  if (points === 0) throw new Error(`parsed 0 points for lex.uz/${docId} (kind=decree) — refusing partial save`);

  return {
    docId: `ld_uz_${docId}`,
    jurisdiction: 'UZ',
    officialSourceId: docId,
    docType: docNumber?.startsWith('ПП-') ? 'resolution' : 'decree',
    docNumber,
    title,
    sourceUrl: url,
    retrievedAt,
    sha256,
    modifiedOnSource: null,
    units,
  };
}

/* ── Постановления Пленума Верховного суда и бывшего Высшего хозяйственного суда ─
 * Устроены как указы: преамбула «…Пленум ПОСТАНОВЛЯЕТ:» и нумерованные пункты,
 * поэтому пункты разбирает parseLexUzDecreeHtml (сам он не меняется). Здесь
 * поверх него:
 *  - номер и дата из шапки сверяются с ожидаемыми из UZ_DOCS, суд — с блоком
 *    ACCEPTING_BODY: опечатка в lex.uz-ID падает громко, чужой акт не пишется;
 *  - название получает вид акта, суд и номер — и ИИ, и юрист видят, что это
 *    разъяснение Пленума, а не закон;
 *  - doc_number канонический («ПВХС-163-2007») — по нему резолвятся цитаты
 *    «п. 6 постановления Пленума ВХС № 163».
 */
const PLENUM_TITLE: Record<PlenumCourt, string> = {
  ВС: 'Постановление Пленума Верховного суда (ВС)',
  ВХС: 'Постановление Пленума Высшего хозяйственного суда (ВХС)',
  'ВС+ВХС': 'Совместное постановление Пленумов Верховного суда и Высшего хозяйственного суда (ВС и ВХС)',
};

export interface PlenumExpect {
  court: PlenumCourt;
  /** Номер как на lex.uz: «163», «17», «13/150». */
  number: string;
  /** ДД.ММ.ГГГГ */
  date: string;
}

export function parseLexUzPlenumHtml(docId: string, html: string, url: string, expect: PlenumExpect): ParsedDocument {
  const base = parseLexUzDecreeHtml(docId, html, url);

  const head = strip(html.match(/id="lx_lact_num_top"[^>]*>([\s\S]{0,400}?)<\/div>/)?.[1] ?? '');
  const date = head.match(/(\d{2}\.\d{2}\.\d{4})/)?.[1] ?? null;
  const number = normalizePlenumNumber(head.match(/№\s*(\d[\d\s/]*[а-яА-Я]?)/u)?.[1]?.trim());
  if (!date || date !== expect.date || !number || number !== normalizePlenumNumber(expect.number)) {
    throw new Error(`шапка lex.uz/${docId} «${head}»: ожидали № ${expect.number} от ${expect.date} — не та страница? refusing`);
  }

  // Текст блока — во внутреннем <div name id>, как у абзацев (до него идёт
  // панель «Предложения по документу…»); суды разделены <br />.
  const bodyHtml = html.match(/<div class="ACCEPTING_BODY[^"]*"[\s\S]*?<div name="(\d+)" id="\1">([\s\S]*?)<\/div><\/div>/)?.[2] ?? '';
  const body = strip(bodyHtml.replace(/<br\s*\/?>/gi, ' ')).toUpperCase();
  const hasVs = /ВЕРХОВН/u.test(body);
  const hasVhs = /ВЫСШ\S*\s+ХОЗЯЙСТВЕНН/u.test(body);
  const court: PlenumCourt | null = hasVs && hasVhs ? 'ВС+ВХС' : hasVhs ? 'ВХС' : hasVs ? 'ВС' : null;
  if (court !== expect.court) {
    throw new Error(`суд lex.uz/${docId}: в шапке «${body}», ожидали ${expect.court} — refusing`);
  }

  const docNumber = plenumDocNumber(court, number, date.slice(6));
  const subject = base.title.replace(/^\S+-сон\s+\d{2}\.\d{2}\.\d{4}\.?\s*/u, '').trim();
  const title = `${PLENUM_TITLE[court]} № ${number} от ${date} «${subject}»`;

  // Пункты уже собраны с корнем breadcrumb из сырого названия — меняем корень
  // и пересчитываем контрольную сумму юнита (она включает breadcrumb).
  const oldRoot = `UZ / ${base.title}`;
  const newRoot = `UZ / ${title}`;
  const units = base.units.map((u) => {
    const breadcrumb = u.breadcrumb.startsWith(oldRoot) ? newRoot + u.breadcrumb.slice(oldRoot.length) : u.breadcrumb;
    return { ...u, breadcrumb, sha256Checksum: createHash('sha256').update(`${breadcrumb}|${u.heading ?? ''}|${u.text}`).digest('hex') };
  });

  return { ...base, docType: 'plenum', docNumber, title, units };
}
