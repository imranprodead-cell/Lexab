/**
 * govinfo.gov (U.S. Government Publishing Office) — the official source of the
 * United States Code. The Office of the Law Revision Counsel's USLM XML
 * (uscode.house.gov) is the cleaner feed but is unreachable from some networks;
 * govinfo publishes the SAME official Code as per-title PDF, which we parse.
 *
 * WHITELIST RULE: this module is the ONLY way U.S. federal law enters the
 * corpus — from the official GPO package, sha256 of the raw PDF.
 *
 * Scope: individual federal titles that bear on contracts — Title 9 (Federal
 * Arbitration Act) and the E-SIGN chapter of Title 15. Core U.S. contract law
 * (UCC Article 2) is STATE law and is added separately once an official,
 * machine-readable state source is available.
 *
 * GPO PDF text layout (verified live 2026-07-13, Title 9):
 *   - running header lines "Page N   TITLE 9—ARBITRATION   § X" — dropped;
 *   - "CHAPTER N—NAME" dividers, each followed by a "Sec." analysis table that
 *     lists "num. heading." (authoritative section headings);
 *   - section bodies "§ N. Heading … <statutory text> (July 30, 1947, ch. 392,
 *     61 Stat. 670; …)" — the credit-line parenthetical ends the statutory text;
 *     everything after it (DERIVATION, Editorial Notes, AMENDMENTS, Statutory
 *     Notes …) is editorial apparatus and is EXCLUDED from the law text.
 *   - words are hyphenated across line breaks ("trans-\naction").
 */
import { createHash } from 'node:crypto';
import type { LegalUnit } from '../types.ts';
import type { ParsedDocument } from './upsert.ts';

const GOVINFO = 'https://www.govinfo.gov';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface UscodeTitleConfig {
  titleNum: number; // 9
  code: string; // 'usc09' — id/citation slug
  pkgYear: number; // govinfo package year, e.g. 2024
  title: string; // 'United States Code, Title 9 — Arbitration'
  /** A single chapter granule (e.g. 'chap96') instead of the whole title —
   *  lets us carve the E-SIGN chapter out of the enormous Title 15. */
  granule?: string;
  /** Keep only sections whose number is in this set (null = whole title). */
  sectionFilter?: (n: number) => boolean;
}

/** Fetch the official title (or chapter granule) PDF from govinfo; retry with backoff, never partial. */
export async function fetchUscodePdf(cfg: UscodeTitleConfig): Promise<{ pdf: Buffer; url: string; pkgUrl: string }> {
  const pkg = `USCODE-${cfg.pkgYear}-title${cfg.titleNum}`;
  const doc = cfg.granule ? `${pkg}-${cfg.granule}` : pkg;
  const pkgUrl = `${GOVINFO}/content/pkg/${pkg}/pdf/${doc}.pdf`;
  const url = `${GOVINFO}/app/details/${pkg}`; // human-facing landing page for provenance
  let lastErr: Error | null = null;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await fetch(pkgUrl, { headers: { 'user-agent': 'Lexab-corpus-ingest/1.0' } });
      if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`);
      if (!res.ok) throw new Error(`HTTP ${res.status} (permanent)`);
      const pdf = Buffer.from(await res.arrayBuffer());
      if (pdf.subarray(0, 5).toString() !== '%PDF-') throw new Error('response is not a PDF (permanent)');
      return { pdf, url, pkgUrl };
    } catch (err) {
      lastErr = err as Error;
      if (String(lastErr.message).includes('permanent')) break;
      await sleep(1000 * attempt * attempt);
    }
  }
  throw new Error(`fetch ${pkgUrl} failed: ${lastErr?.message}`);
}

const decodeQuotes = (s: string): string =>
  s
    .replace(/‘‘|’’/g, '"') // GPO renders quotation marks as doubled single quotes
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"');

/** De-hyphenate across line breaks and collapse the remaining wrap into spaces. */
function normalizeFlow(raw: string): string {
  return decodeQuotes(raw)
    .replace(/([A-Za-z])-\n([a-z])/g, '$1$2') // trans-\naction → transaction
    .replace(/\s*\n\s*/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/** Drop GPO running-header/footer lines so they never leak into statutory text. */
function stripRunningHeaders(text: string, titleNum: number): string {
  const titleRe = new RegExp(`^TITLE ${titleNum}\\b.*$`);
  return text
    .split('\n')
    .filter((line) => {
      const l = line.trim();
      if (/^Page \d+\b/.test(l)) return false; // "Page 3 TITLE 9—ARBITRATION § 10"
      if (titleRe.test(l)) return false; // standalone banner
      return true;
    })
    .join('\n');
}

/** Credit line that terminates statutory text — both the old date-first form
 *  "(July 30, 1947, ch. 392, 61 Stat. 670…" and the modern "(Pub. L. 106–229,
 *  …, June 30, 2000, 114 Stat. 464…". The invariant is a parenthetical carrying
 *  "Stat. <n>", which never appears inside statutory body text. */
const CREDIT_RE = /\((?:[^()]|\([^()]*\))*?Stat\.\s+\d+/;

/**
 * Parse the "Sec." analysis tables into a section-number → heading map. Each
 * entry is "num. heading." (heading may wrap and ends at a period before the
 * next "num. " / a CAPS editorial header / a new chapter).
 */
function parseHeadings(text: string): Map<number, string> {
  const map = new Map<number, string>();
  const analysisBlocks = text.matchAll(/\nSec\.\n([\s\S]*?)(?=\nCHAPTER \d|\n§ \d|$)/g);
  for (const block of analysisBlocks) {
    const entries = block[1].matchAll(/(?:^|\n)(\d+)\.\s+([\s\S]*?)\.(?=\n\d+\.\s|\n[A-Z]{2,}|\nCHAPTER|\n§|\s*$)/g);
    for (const e of entries) {
      const n = Number(e[1]);
      // The last entry in a block can run into trailing editorial notes; a
      // heading never contains a credit line or an editorial header, so cut there.
      const heading = normalizeFlow(e[2]).split(/\s+(?:Editorial Notes|Statutory Notes|Historical|AMENDMENTS|EFFECTIVE DATE|Pub\. L\.)\b/)[0].trim();
      if (heading && !map.has(n)) map.set(n, heading);
    }
  }
  return map;
}

export function parseUscodeText(cfg: UscodeTitleConfig, pdfText: string, url: string, sha256: string): ParsedDocument {
  const retrievedAt = new Date().toISOString();
  const clean = stripRunningHeaders(pdfText, cfg.titleNum);
  const headings = parseHeadings(clean);

  const unitId = (suffix: string) => `lu_us_${cfg.code}_${suffix}`;
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
  const crumbRoot = `US / ${cfg.title}`;

  // Chapter dividers, in document order, to build breadcrumbs and parent ids.
  // The chapter title wraps across lines and is hyphenated ("REC-\nOGNITION");
  // capture up to the "Sec." table / a subchapter divider / the first section,
  // then reflow (all-caps titles wrap uppercase, so rejoin those hyphens too).
  const reflowTitle = (s: string) => normalizeFlow(s).replace(/([A-Za-z])-\s+([A-Za-z])/g, '$1$2');
  const chapters = [...clean.matchAll(/CHAPTER (\d+)([A-Z]?)—([\s\S]{0,180}?)(?=\n\s*(?:Sec\.|SUBCHAPTER|§\s*\d)|\n\n|$)/g)].map((m) => ({
    idx: m.index ?? 0,
    label: `Chapter ${m[1]}${m[2]}`,
    name: reflowTitle(m[3]),
    id: unitId(`ch-${m[1]}${m[2].toLowerCase()}`),
    pushed: false,
  }));
  const chapterAt = (pos: number) => {
    let cur: (typeof chapters)[number] | null = null;
    for (const c of chapters) if (c.idx <= pos) cur = c;
    return cur;
  };

  // Section bodies: "§ N. …" at a line start, up to the next section marker.
  const secRe = /(?:^|\n)§\s*(\d+[A-Za-z]?)\.\s/g;
  const starts: { num: string; n: number; at: number; bodyAt: number }[] = [];
  for (let m = secRe.exec(clean); m; m = secRe.exec(clean)) {
    starts.push({ num: m[1], n: Number(m[1].replace(/[A-Za-z]/g, '')), at: m.index, bodyAt: secRe.lastIndex });
  }

  let sections = 0;
  for (let i = 0; i < starts.length; i++) {
    const s = starts[i];
    if (cfg.sectionFilter && !cfg.sectionFilter(s.n)) continue;
    const end = i + 1 < starts.length ? starts[i + 1].at : clean.length;
    const rawSpan = clean.slice(s.bodyAt, end);
    // Statutory text ends at the credit line; everything after is editorial.
    const creditIdx = rawSpan.search(CREDIT_RE);
    const statutory = normalizeFlow(creditIdx >= 0 ? rawSpan.slice(0, creditIdx) : rawSpan);
    if (!statutory || statutory.length < 3) continue; // repealed/omitted/transferred

    const heading = headings.get(s.n) ?? null;
    // Body text without the repeated heading prefix (kept separate in `heading`).
    let text = statutory;
    if (heading && text.startsWith(heading)) text = text.slice(heading.length).replace(/^[\s.;:—-]+/, '');
    if (!text) text = statutory;

    const chap = chapterAt(s.at);
    if (chap && !chap.pushed) {
      push({ id: chap.id, parentId: null, unitType: 'chapter', number: chap.label.replace(/^Chapter\s*/, ''), heading: chap.name, breadcrumb: `${crumbRoot} / ${chap.label} — ${chap.name}`, text: '', officialUnitUri: url });
      chap.pushed = true;
    }
    push({
      id: unitId(`s-${s.num}`),
      parentId: chap?.id ?? null,
      unitType: 'section',
      number: s.num,
      heading,
      breadcrumb: `${crumbRoot}${chap ? ` / ${chap.label} — ${chap.name}` : ''} / § ${s.num}`,
      text,
      officialUnitUri: `${GOVINFO}/link/uscode/${cfg.titleNum}/${s.num}`,
    });
    sections++;
  }

  if (sections === 0) throw new Error(`parsed 0 sections for ${cfg.code} — refusing partial save`);

  return {
    docId: `ld_us_${cfg.code}`,
    jurisdiction: 'US',
    officialSourceId: `uscode-title-${cfg.titleNum}`,
    docType: 'code',
    title: cfg.title,
    sourceUrl: url,
    retrievedAt,
    sha256,
    modifiedOnSource: null,
    units,
  };
}
