/**
 * adilet.zan.kz (ИПС «Әділет») — official legislation database of Kazakhstan.
 * Fetches the CURRENT redaction (Russian version, /rus/docs/<code>) and parses
 * the flat heading/paragraph stream into legal units: Раздел → (Подраздел) →
 * Глава → Статья. Editorial footnotes are dropped.
 *
 * Page structure (verified live 2026-07-12): the legal text is a flat sequence
 * of anchored elements whose id starts with "z":
 *   <h3 id="zNNNN"> Раздел 1. … | Глава 1. … | Статья 1. Heading</h3>
 *   <p  id="zNN">   1. body clause text…</p>
 * Nav/footer headings have no z-anchor, so keying on id="z\d+" scopes to the
 * legal body. Editorial notes appear as <span class="note">Сноска…</span> and
 * are stripped from every block.
 */
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promisify } from 'node:util';
import type { LegalUnit } from '../types.ts';
import type { ParsedDocument } from './upsert.ts';

const execFileP = promisify(execFile);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * adilet.zan.kz is fetched via curl, not Node's `fetch`: its edge (a) omits the
 * TLS intermediate chain (undici → UNABLE_TO_VERIFY_LEAF_SIGNATURE) and (b)
 * resets undici's TLS/HTTP fingerprint (ECONNRESET), while curl negotiates fine
 * with the system trust store. Ingestion is a CLI batch job and every byte is
 * checksummed, so shelling out here is safe. `code` is validated (no shell —
 * execFile passes args directly) so nothing user-controlled can inject.
 */
export async function fetchAdiletHtml(code: string): Promise<{ html: string; url: string }> {
  if (!/^[A-Za-z0-9_]+$/.test(code)) throw new Error(`invalid adilet doc code: ${code}`);
  const url = `https://adilet.zan.kz/rus/docs/${code}`;
  const ua = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Lexab-corpus-ingest/1.0';
  let lastErr: Error | null = null;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const { stdout } = await execFileP('curl', ['-sS', '--fail', '--compressed', '--max-time', '60', '-A', ua, url], {
        maxBuffer: 64 * 1024 * 1024,
        encoding: 'utf8',
      });
      if (!/Статья\s+\d/.test(stdout)) throw new Error('page has no article markup');
      return { html: stdout, url };
    } catch (err) {
      lastErr = err as Error;
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

/** Drop footnote spans, then all tags → clean single-line text. */
const strip = (html: string): string =>
  decodeEntities(html.replace(/<span class="note">[\s\S]*?<\/span>/gi, '').replace(/<[^>]+>/g, ''))
    .replace(/\s+/g, ' ')
    .trim();

/** «Гражданский кодекс Республики Казахстан (Общая часть)» — drop the « - ИПС …» suffix. */
function titleOf(html: string): string {
  const m = html.match(/<title>(.*?)<\/title>/s);
  const raw = strip(m?.[1] ?? '');
  return raw.replace(/\s*[-–—]\s*ИПС.*$/i, '').trim() || raw;
}

export function parseAdiletHtml(code: string, html: string, url: string): ParsedDocument {
  const title = titleOf(html);
  const retrievedAt = new Date().toISOString();
  const sha256 = createHash('sha256').update(html).digest('hex');

  // Scope to the legal-text region: from the first anchored heading to the
  // footer (share buttons / after-text / scripts adilet appends after the law).
  // Headings ALWAYS carry id="z…"; article body <p> may or may not — so within
  // this region we match every <p>, which is why bounding the region matters.
  const startIdx = html.search(/<h3 id="z\d+"/);
  const tail = startIdx >= 0 ? html.slice(startIdx) : html;
  const endIdx = tail.search(/class="social-buttons"|class="[^"]*aftertext|<script/i);
  const content = endIdx >= 0 ? tail.slice(0, endIdx) : tail;

  const blocks: { tag: 'h3' | 'p'; anchor: string; text: string }[] = [];
  const re = /<h3 id="(z\d+)"[^>]*>([\s\S]*?)<\/h3>|<p\b([^>]*)>([\s\S]*?)<\/p>/gi;
  for (let m = re.exec(content); m; m = re.exec(content)) {
    if (m[1] !== undefined) {
      const text = strip(m[2]);
      if (text) blocks.push({ tag: 'h3', anchor: m[1], text });
    } else {
      const inner = m[4] ?? '';
      const text = strip(inner);
      if (!text) continue;
      // Anchor: the <p>'s own id, or an <a name="z…"> inside a heading paragraph
      // (newer laws mark articles as <p><b><a name="z…"></a>Статья N. …</b></p>).
      const anchor = (m[3] ?? '').match(/id="(z\d+)"/)?.[1] ?? inner.match(/<a\s+name="(z\d+)"/i)?.[1] ?? '';
      blocks.push({ tag: 'p', anchor, text });
    }
  }
  if (!blocks.length) throw new Error(`parsed 0 blocks for adilet/${code} — refusing partial save`);

  const unitId = (suffix: string) => `lu_kz_${code}_${suffix}`;
  const base = { language: 'ru', validFrom: null as string | null, validTo: null as string | null, sourceUrl: url, retrievedAt };
  const units: Omit<LegalUnit, 'documentId'>[] = [];
  let ord = 0;
  const push = (
    u: Omit<LegalUnit, 'documentId' | 'ord' | 'sha256Checksum' | 'retrievedAt' | 'sourceUrl' | 'language' | 'validTo' | 'validFrom'>,
  ) => {
    units.push({
      ...u,
      ...base,
      ord: ord++,
      sha256Checksum: createHash('sha256').update(`${u.breadcrumb}|${u.heading ?? ''}|${u.text}`).digest('hex'),
    });
  };

  const crumbRoot = `KZ / ${title}`;
  let part: { id: string; label: string } | null = null;
  let subpart: { id: string; label: string } | null = null;
  let chapter: { id: string; label: string } | null = null;
  let article: { id: string; num: string; heading: string; anchor: string; body: string[] } | null = null;
  let sections = 0;

  const crumb = () => [crumbRoot, part?.label, subpart?.label, chapter?.label].filter(Boolean).join(' / ');
  const flushArticle = () => {
    if (!article) return;
    push({
      id: article.id,
      parentId: chapter?.id ?? subpart?.id ?? part?.id ?? null,
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

  for (const b of blocks) {
    // Structural headers (Раздел / Подраздел / Глава) are always <h3> in adilet.
    if (b.tag === 'h3') {
      const razdel = b.text.match(/^Раздел\s+([IVXLC\d]+)\.?\s*(.*)/i);
      const podrazdel = b.text.match(/^Подраздел\s+([IVXLC\d]+)\.?\s*(.*)/i);
      const glava = b.text.match(/^Глава\s+(\d+(?:-\d+)?)\.?\s*(.*)/i);
      if (razdel) {
        flushArticle();
        const label = `Раздел ${razdel[1]}`;
        const id = unitId(`razdel-${razdel[1]}`);
        part = { id, label };
        subpart = null;
        chapter = null;
        push({ id, parentId: null, unitType: 'part', number: razdel[1], heading: razdel[2]?.trim() || null, breadcrumb: `${crumbRoot} / ${label}`, text: '', officialUnitUri: `${url}#${b.anchor}` });
        continue;
      }
      if (podrazdel) {
        flushArticle();
        const label = `Подраздел ${podrazdel[1]}`;
        const id = unitId(`podrazdel-${part?.label.replace(/\D+/g, '') ?? 'x'}-${podrazdel[1]}`);
        subpart = { id, label };
        chapter = null;
        push({ id, parentId: part?.id ?? null, unitType: 'part', number: podrazdel[1], heading: podrazdel[2]?.trim() || null, breadcrumb: `${crumbRoot}${part ? ` / ${part.label}` : ''} / ${label}`, text: '', officialUnitUri: `${url}#${b.anchor}` });
        continue;
      }
      if (glava) {
        flushArticle();
        const label = `Глава ${glava[1]}`;
        const id = unitId(`glava-${glava[1]}`);
        chapter = { id, label };
        push({ id, parentId: subpart?.id ?? part?.id ?? null, unitType: 'chapter', number: glava[1], heading: glava[2]?.trim() || null, breadcrumb: [crumbRoot, part?.label, subpart?.label].filter(Boolean).join(' / ') + ` / ${label}`, text: '', officialUnitUri: `${url}#${b.anchor}` });
        continue;
      }
    }
    // Article heading — <h3> Статья N. (codes) OR <p><b>Статья N. …</b></p> (newer
    // laws). The period after the number is required, so a body sentence that
    // merely starts "Статья 5 настоящего…" is never mistaken for a heading.
    const statya = b.text.match(/^Статья\s+(\d+(?:[.-]\d+)*)\.\s*(.*)/);
    if (statya) {
      flushArticle();
      article = { id: unitId(`st-${statya[1]}`), num: statya[1], heading: statya[2]?.trim() ?? '', anchor: b.anchor, body: [] };
      continue;
    }
    // Body clause of the current article (only <p>; stray <h3> like «ОБЩАЯ ЧАСТЬ»
    // and preamble before the first article are skipped).
    if (b.tag === 'p' && article) article.body.push(b.text);
  }
  flushArticle();
  if (sections === 0) throw new Error(`parsed 0 articles for adilet/${code} — refusing partial save`);

  return {
    docId: `ld_kz_${code}`,
    jurisdiction: 'KZ',
    officialSourceId: code,
    docType: /кодекс/i.test(title) ? 'code' : 'act',
    title,
    sourceUrl: url,
    retrievedAt,
    sha256,
    modifiedOnSource: null,
    units,
  };
}
