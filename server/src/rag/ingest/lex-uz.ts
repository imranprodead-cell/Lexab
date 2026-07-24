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

/** Short display title: «Гражданский кодекс Республики Узбекистан (часть первая)». */
function titleOf(html: string): { title: string; adopted: string | null } {
  const m = html.match(/<title>(.*?)<\/title>/s);
  const raw = strip(m?.[1] ?? '');
  const date = raw.match(/(\d{2}\.\d{2}\.\d{4})/)?.[1] ?? null;
  const title = raw.replace(/^[\s.]*\d{2}\.\d{2}\.\d{4}[\s.]*/, '').trim() || raw;
  const adopted = date ? `${date.slice(6, 10)}-${date.slice(3, 5)}-${date.slice(0, 2)}` : null;
  return { title, adopted };
}

export function parseLexUzHtml(docId: string, html: string, url: string): ParsedDocument {
  const { title, adopted } = titleOf(html);
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
    const text = strip(m[3]);
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
  let part: { id: string; label: string } | null = null;
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
      const razdel = p.text.match(/^РАЗДЕЛ\s+([IVXLC\d]+)\.?\s*(.*)/i);
      const podrazdel = p.text.match(/^ПОДРАЗДЕЛ\s+([IVXLC\d]+)\.?\s*(.*)/i);
      const glava = p.text.match(/^ГЛАВА\s+(\d+(?:-\d+)?)\.?\s*(.*)/i);
      // Структурная шапка ОСНОВНОГО текста завершает режим приложения.
      if (razdel || podrazdel || glava) inAnnex = false;
      if (razdel) {
        flushArticle();
        const label = `Раздел ${razdel[1]}`;
        const id = unitId(`razdel-${razdel[1]}`);
        part = { id, label };
        subpart = null;
        chapter = null;
        push({ id, parentId: null, unitType: 'part', number: razdel[1], heading: razdel[2]?.trim() || null, breadcrumb: `${crumbRoot} / ${label}`, text: '', officialUnitUri: `${url}#${p.anchor}` });
      } else if (podrazdel) {
        flushArticle();
        const label = `Подраздел ${podrazdel[1]}`;
        const id = unitId(`podrazdel-${part?.label.replace(/\D+/g, '') ?? 'x'}-${podrazdel[1]}`);
        subpart = { id, label };
        chapter = null;
        push({ id, parentId: part?.id ?? null, unitType: 'part', number: podrazdel[1], heading: podrazdel[2]?.trim() || null, breadcrumb: `${crumbRoot}${part ? ` / ${part.label}` : ''} / ${label}`, text: '', officialUnitUri: `${url}#${p.anchor}` });
      } else if (glava) {
        flushArticle();
        const label = `Глава ${glava[1]}`;
        const id = unitId(`glava-${glava[1]}`);
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
