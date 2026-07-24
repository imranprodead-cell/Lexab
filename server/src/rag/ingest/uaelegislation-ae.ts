/**
 * UAE Civil Transactions Law (Federal Law No. 5 of 1985) — the codified civil /
 * contract law of the United Arab Emirates. The official English translation is
 * published by the UAE Ministry of Justice on the UAE Legislation Portal
 * (uaelegislation.gov.ae, legislation #1025).
 *
 * WHITELIST / PROVENANCE NOTE: the live official portal is unreachable from our
 * network (uaelegislation.gov.ae sits behind a Cloudflare human-check;
 * elaws.moj.gov.ae times out / geo-blocks). We therefore fetch a faithful
 * snapshot of the OFFICIAL page from the Internet Archive (web.archive.org, the
 * `id_` raw form — no archive toolbar injected). The content is the official
 * page byte-for-byte; `source_url` records the original official URL and the
 * archive timestamp is kept for provenance. This is NOT a third-party editorial
 * mirror — it is the official text, delivered via a trusted preservation archive
 * because the official host blocks us. Law text is never generated.
 *
 * Page structure (verified live 2026-07-13, snapshot 20250708051603):
 *   <div class="c_title"><h4> [hierarchy prefix] :Article (125) </h4></div>
 *   <div class="text_area mm_cnt"><p>…article text…</p></div>
 * The hierarchy (Chapter/Part/Section/Division) appears as an h4 prefix only when
 * a level changes; otherwise the h4 is just "Article (N)". 1527 articles total.
 */
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promisify } from 'node:util';
import type { LegalUnit } from '../types.ts';
import type { ParsedDocument } from './upsert.ts';

const execFileP = promisify(execFile);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Official page (used for provenance) + the Internet Archive snapshot we fetch. */
export const AE_OFFICIAL_URL = 'https://uaelegislation.gov.ae/en/legislations/1025';
const AE_ARCHIVE_SNAPSHOT = '20250708051603';
const AE_ARCHIVE_URL = `https://web.archive.org/web/${AE_ARCHIVE_SNAPSHOT}id_/${AE_OFFICIAL_URL}`;

export interface UaeConfig {
  code: string; // 'civil'
  title: string; // 'Federal Law No. 5 of 1985 (Civil Transactions Law)'
  /** Inclusive article-number range to keep (default: whole code). */
  articleRange?: [number, number];
}

/**
 * Fetch the archived official page via curl (web.archive.org is reachable; our
 * runtime's fetch is fine too, but curl keeps this consistent with the other
 * CLI ingesters and dodges edge TLS quirks). Ingestion is a trusted batch job.
 */
export async function fetchUaeHtml(): Promise<{ html: string; url: string; archiveUrl: string }> {
  let lastErr: Error | null = null;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const { stdout } = await execFileP(
        'curl',
        ['-sSL', '--compressed', '--fail', '--max-time', '120', '-A', 'Lexab-corpus-ingest/1.0', AE_ARCHIVE_URL],
        { maxBuffer: 96 * 1024 * 1024, encoding: 'utf8' },
      );
      if (!/text_area/.test(stdout) || !/Article \(\d+\)/.test(stdout)) throw new Error('archived page has no article markup');
      return { html: stdout, url: AE_OFFICIAL_URL, archiveUrl: AE_ARCHIVE_URL };
    } catch (err) {
      lastErr = err as Error;
      await sleep(1500 * attempt * attempt);
    }
  }
  throw new Error(`fetch ${AE_ARCHIVE_URL} failed: ${lastErr?.message}`);
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

/** `<div class="text_area">` inner → readable body, each <p> a line. */
function bodyText(inner: string): string {
  return decodeEntities(inner.replace(/<\/p>/gi, '\n').replace(/<[^>]+>/g, ' '))
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
    .trim();
}

const LABEL_RANK: Record<string, number> = { Book: 1, Chapter: 2, Part: 3, Section: 4, Division: 5 };

export function parseUaeHtml(cfg: UaeConfig, html: string, url: string): ParsedDocument {
  const retrievedAt = new Date().toISOString();
  const sha256 = createHash('sha256').update(html).digest('hex');
  const [lo, hi] = cfg.articleRange ?? [1, 99999];

  const unitId = (suffix: string) => `lu_ae_${cfg.code}_${suffix}`;
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
  const crumbRoot = `AE / ${cfg.title}`;

  // Hierarchy stack keyed by level rank; updated from each h4 prefix.
  const stack = new Map<number, string>();
  const applyPrefix = (prefix: string) => {
    const clean = prefix.replace(/\s+/g, ' ').trim().replace(/[:\s]+$/, '');
    if (!clean) return;
    const segRe = /(Book|Chapter|Part|Section|Division)\s+([A-Za-z0-9]+)\s*:\s*(.*?)(?=\s+(?:Book|Chapter|Part|Section|Division)\s+[A-Za-z0-9]+\s*:|$)/g;
    let matched = false;
    for (let m = segRe.exec(clean); m; m = segRe.exec(clean)) {
      matched = true;
      const rank = LABEL_RANK[m[1]];
      const title = m[3].replace(/[:\s]+$/, '').trim();
      for (const k of [...stack.keys()]) if (k >= rank) stack.delete(k);
      stack.set(rank, `${m[1]} ${m[2]}${title ? ` — ${title}` : ''}`);
    }
    // Bare numbered sub-heading ("1- Categories of evidence") → deepest level.
    if (!matched) {
      for (const k of [...stack.keys()]) if (k >= 6) stack.delete(k);
      stack.set(6, clean);
    }
  };
  const crumb = () => [crumbRoot, ...[...stack.keys()].sort((a, b) => a - b).map((k) => stack.get(k)!)].join(' / ');

  // Each article: <h4> header </h4> … <div class="text_area…"> body </div>.
  const re = /<h4>([\s\S]*?)<\/h4>[\s\S]*?<div class="text_area[^"]*">([\s\S]*?)<\/div>/gi;
  let sections = 0;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    const h4 = strip(m[1]);
    // Article marker sits at the END of the h4 (after the hierarchy prefix) and
    // appears as "Article (125)" OR, on some articles, "Article 193" (no parens).
    // Take the LAST match so a cross-reference inside a prefix can't be mistaken
    // for the marker.
    const artMatches = [...h4.matchAll(/Article\s*\(?(\d+)\)?/g)];
    const artMatch = artMatches[artMatches.length - 1];
    if (!artMatch) continue;
    const n = Number(artMatch[1]);
    // Everything before the article marker is the hierarchy prefix (may be empty).
    const prefix = h4.slice(0, artMatch.index).replace(/[:\s]+$/, '').trim();
    if (prefix) applyPrefix(prefix);
    if (n < lo || n > hi) continue;
    const text = bodyText(m[2]);
    if (!text) continue; // repealed / empty article
    push({
      id: unitId(`art-${n}`),
      parentId: null,
      unitType: 'section',
      number: String(n),
      heading: null,
      breadcrumb: `${crumb()} / Article ${n}`,
      text,
      officialUnitUri: `${url}#item${n}`,
    });
    sections++;
  }

  if (sections === 0) throw new Error(`parsed 0 articles for UAE ${cfg.code} — refusing partial save`);

  return {
    docId: `ld_ae_${cfg.code}`,
    jurisdiction: 'AE',
    officialSourceId: cfg.code,
    docType: 'code',
    title: cfg.title,
    sourceUrl: url,
    retrievedAt,
    sha256,
    // modified_on_source is a DATE column and we don't have a source-side
    // modification date; the archive snapshot used for delivery is recorded in
    // the ingestion_runs.source label and this module's header, not here.
    modifiedOnSource: null,
    units,
  };
}
