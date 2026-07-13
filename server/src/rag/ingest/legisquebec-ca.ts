/**
 * LégisQuébec (Publications Québec) — the official consolidated statutes of
 * Québec. Québec is Canada's civil-law province, so its contract law is
 * codified in the Civil Code of Québec (CCQ-1991) — unlike the common-law
 * provinces, whose contract law is judge-made. Book Five ("Obligations")
 * is the core of Québec (and the cleanest codified) contract law.
 *
 * WHITELIST RULE: this module is the ONLY way Canadian legislation text enters
 * the corpus — from the official LégisQuébec HTML, sha256 of the raw page.
 * (LégisQuébec 403s a bare client; a browser User-Agent is required.)
 *
 * Page structure (verified live 2026-07-13, en/document/cs/CCQ-1991):
 *   - hierarchy headers: <div class="Label-groupN"><span>BOOK </span>ONE</div>
 *     followed by <div class="TitleText-groupN…">PERSONS</div>. The group number
 *     N encodes depth (2=Book, 3=Title, 4=Chapter, 5=Division …).
 *   - articles: <div class="section" id="se:1385"> … <span class="Subsection">
 *     …text…</span> … <div class="HistoricalNote">1991, c. 64, a. 1385</div>.
 *     The article number is the "se:" id; body is the Subsection span(s);
 *     HistoryLink/HistoricalNote/Label-Section are editorial and dropped.
 */
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promisify } from 'node:util';
import type { LegalUnit } from '../types.ts';
import type { ParsedDocument } from './upsert.ts';

const execFileP = promisify(execFile);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const BASE = 'https://www.legisquebec.gouv.qc.ca';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

export interface CcqConfig {
  docId: string; // 'CCQ-1991'
  code: string; // 'ccq'
  title: string; // 'Civil Code of Québec'
  /** Inclusive article-number range to keep (Book Five obligations by default). */
  articleRange?: [number, number];
}

/**
 * Fetch the consolidated English CCQ page. LégisQuébec blocks non-browser
 * clients (403) and its edge is finicky with undici, so — like adilet — we
 * shell out to curl with a browser UA. Ingestion is a trusted CLI batch job.
 */
export async function fetchCcqHtml(cfg: CcqConfig): Promise<{ html: string; url: string }> {
  if (!/^[A-Za-z0-9-]+$/.test(cfg.docId)) throw new Error(`invalid CCQ doc id: ${cfg.docId}`);
  const url = `${BASE}/en/document/cs/${cfg.docId}`;
  let lastErr: Error | null = null;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const { stdout } = await execFileP(
        'curl',
        ['-sSL', '--compressed', '--fail', '--max-time', '90', '-A', UA, '-H', 'Accept-Language: en-CA,en;q=0.9', url],
        { maxBuffer: 64 * 1024 * 1024, encoding: 'utf8' },
      );
      if (!/id="se:\d/.test(stdout)) throw new Error('page has no article markup');
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
    .replace(/&#160;/g, ' ')
    .replace(/&laquo;/g, '«').replace(/&raquo;/g, '»')
    .replace(/&mdash;/g, '—').replace(/&ndash;/g, '–')
    .replace(/&rsquo;/g, '’').replace(/&lsquo;/g, '‘')
    .replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));

const strip = (html: string): string => decodeEntities(html.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

/** Map a hierarchy label word → a short breadcrumb label. */
function headingLabel(raw: string): string {
  return strip(raw).replace(/\s+/g, ' ').trim();
}

export function parseCcqHtml(cfg: CcqConfig, html: string, url: string): ParsedDocument {
  const retrievedAt = new Date().toISOString();
  const sha256 = createHash('sha256').update(html).digest('hex');
  const [lo, hi] = cfg.articleRange ?? [1, 99999];

  const unitId = (suffix: string) => `lu_ca_${cfg.code}_${suffix}`;
  const base = { language: 'en', validFrom: null as string | null, validTo: null as string | null, sourceUrl: url, retrievedAt };
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
  const crumbRoot = `CA / ${cfg.title}`;

  // Ordered stream of markers: hierarchy labels/titles and article openings.
  // Note: heading divs carry an integrity:order attribute BEFORE class, so the
  // class match must tolerate leading attributes ([^>]*).
  const markerRe =
    /<div[^>]*class="Label-group(\d+)"[^>]*>([\s\S]*?)<\/div>|<div[^>]*class="TitleText-group(\d+)[^"]*"[^>]*>([\s\S]*?)<\/div>|<div[^>]*class="section"[^>]*id="se:([0-9][0-9.A-Za-z]*)"[^>]*>/g;
  const markers = [...html.matchAll(markerRe)];

  // Hierarchy stack keyed by group level (2=Book, 3=Title, …).
  const stack = new Map<number, { label: string; title: string }>();
  const pending: { level: number; label: string } = { level: 0, label: '' };
  const crumbOf = () =>
    [crumbRoot, ...[...stack.keys()].sort((a, b) => a - b).map((k) => {
      const h = stack.get(k)!;
      return h.title ? `${h.label} — ${h.title}` : h.label;
    })].join(' / ');

  let sections = 0;
  for (let i = 0; i < markers.length; i++) {
    const m = markers[i];
    if (m[1] !== undefined) {
      // Label-groupN: start a heading at this level, drop anything deeper.
      const level = Number(m[1]);
      for (const k of [...stack.keys()]) if (k >= level) stack.delete(k);
      stack.set(level, { label: headingLabel(m[2]), title: '' });
      pending.level = level;
      pending.label = headingLabel(m[2]);
      continue;
    }
    if (m[3] !== undefined) {
      // TitleText-groupN: the descriptive title of the heading just opened.
      const level = Number(m[3]);
      const h = stack.get(level);
      if (h && !h.title) h.title = headingLabel(m[4]);
      continue;
    }
    // Article section: number from the se: id, body from Subsection spans.
    const num = m[5];
    const n = Number(num.replace(/[^\d.].*$/, ''));
    if (!Number.isFinite(n) || n < lo || n > hi) continue;
    const contentStart = (m.index ?? 0) + m[0].length;
    const contentEnd = i + 1 < markers.length ? markers[i + 1].index ?? html.length : html.length;
    const content = html.slice(contentStart, contentEnd);
    // Positive extraction: only the <span class="Subsection"> bodies are the law
    // text (this skips HistoryLink, HistoricalNote and the Label-Section number).
    const paras: string[] = [];
    for (const s of content.matchAll(/<span[^>]*class="Subsection"[^>]*>([\s\S]*?)<\/span>/g)) {
      const t = strip(s[1]);
      if (t) paras.push(t);
    }
    const text = paras.join('\n');
    if (!text) continue; // repealed article (no body)
    push({
      id: unitId(`art-${num}`),
      parentId: null,
      // 'section' is the pipeline's indexed-leaf convention (build-index and the
      // citation resolver key on it); the CCQ calls these "articles" — reflected
      // in the number/breadcrumb ("art. N"), not the unit_type.
      unitType: 'section',
      number: num,
      heading: null,
      breadcrumb: `${crumbOf()} / art. ${num}`,
      text,
      officialUnitUri: `${url}#se:${num}`,
    });
    sections++;
  }

  if (sections === 0) throw new Error(`parsed 0 articles for CCQ ${cfg.docId} — refusing partial save`);

  return {
    docId: `ld_ca_${cfg.code}`,
    jurisdiction: 'CA',
    officialSourceId: cfg.docId,
    docType: 'code',
    title: cfg.title,
    sourceUrl: url,
    retrievedAt,
    sha256,
    modifiedOnSource: null,
    units,
  };
}
