/**
 * legislation.gov.uk client + CLML parser.
 *
 * Fetches the CURRENT in-force redaction of an act as CLML XML
 * (https://www.legislation.gov.uk/<id>/data.xml) and parses the body
 * hierarchy Part → Pblock (cross-heading) → P1group/P1 (section) → P2
 * (subsection) into LegalUnit rows with full provenance.
 *
 * WHITELIST RULE: this module is the ONLY way UK legislation text enters the
 * corpus — straight from the official API, with sha256 of the raw XML.
 * Schedules are out of the Stage-1 pilot scope (documented in docs/corpus-schema.md).
 */
import { createHash } from 'node:crypto';
import { XMLParser } from 'fast-xml-parser';
import type { LegalUnit, UnitType } from '../types.ts';

const BASE = 'https://www.legislation.gov.uk';

export interface ParsedAct {
  officialSourceId: string; // 'ukpga/1979/54'
  title: string;
  sourceUrl: string;
  retrievedAt: string;
  sha256: string;
  modifiedOnSource: string | null;
  actValidFrom: string | null;
  units: Omit<LegalUnit, 'documentId'>[];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Polite fetch: retry with backoff on 429/5xx/network, never partial. */
export async function fetchActXml(officialSourceId: string): Promise<{ xml: string; url: string }> {
  const url = `${BASE}/${officialSourceId}/data.xml`;
  let lastErr: Error | null = null;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'user-agent': 'LexAI-corpus-ingest/1.0' } });
      if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`);
      if (!res.ok) throw new Error(`HTTP ${res.status} (permanent)`);
      const xml = await res.text();
      if (!xml.includes('<Legislation')) throw new Error('response is not CLML');
      return { xml, url };
    } catch (err) {
      lastErr = err as Error;
      if (String(lastErr.message).includes('permanent')) break;
      await sleep(1000 * attempt * attempt); // 1s, 4s, 9s
    }
  }
  throw new Error(`fetch ${url} failed: ${lastErr?.message}`);
}

/* ── CLML walking helpers (fast-xml-parser preserveOrder shape) ────────────── */

type Node = Record<string, unknown>;

function tagOf(node: Node): string {
  return Object.keys(node).find((k) => k !== ':@' && k !== '#text') ?? '#text';
}
function childrenOf(node: Node): Node[] {
  const tag = tagOf(node);
  const v = node[tag];
  return Array.isArray(v) ? (v as Node[]) : [];
}
function attrsOf(node: Node): Record<string, string> {
  return (node[':@'] as Record<string, string>) ?? {};
}

/** Elements whose text must NOT leak into the statute text. */
const SKIP_TEXT = new Set(['Commentary', 'CommentaryRef', 'FootnoteRef', 'MarginNote', 'Footnote']);

/** Concatenate all descendant text, skipping editorial apparatus. */
function textOf(node: Node): string {
  const tag = tagOf(node);
  if (tag === '#text') return String(node['#text'] ?? '');
  if (SKIP_TEXT.has(tag)) return '';
  return childrenOf(node).map(textOf).join('');
}

const clean = (s: string): string => s.replace(/\s+/g, ' ').trim();

function findChild(nodes: Node[], tag: string): Node | undefined {
  return nodes.find((n) => tagOf(n) === tag);
}
function findAll(nodes: Node[], tag: string): Node[] {
  return nodes.filter((n) => tagOf(n) === tag);
}

/** Assemble readable text of a P2/P3 provision: "(2) Where the seller …". */
function provisionText(node: Node): string {
  const kids = childrenOf(node);
  const num = clean(textOf(findChild(kids, 'Pnumber') ?? ({ '#text': '' } as Node)));
  const para = kids.find((n) => /^P\dpara$/.test(tagOf(n)));
  const parts: string[] = [];
  for (const child of para ? childrenOf(para) : []) {
    const tag = tagOf(child);
    if (tag === 'Text') parts.push(clean(textOf(child)));
    else if (/^P\d$/.test(tag)) parts.push(provisionText(child));
    else if (!SKIP_TEXT.has(tag)) {
      const t = clean(textOf(child));
      if (t) parts.push(t);
    }
  }
  const body = parts.filter(Boolean).join('\n');
  return num ? `(${num}) ${body}` : body;
}

/* ── Main parser ───────────────────────────────────────────────────────────── */

export function parseActXml(officialSourceId: string, xml: string, url: string): ParsedAct {
  const parser = new XMLParser({
    preserveOrder: true,
    ignoreAttributes: false,
    attributeNamePrefix: '',
    trimValues: false,
    removeNSPrefix: true, // ukm:Metadata → Metadata
  });
  const root = parser.parse(xml) as Node[];
  const legislation = findChild(root, 'Legislation');
  if (!legislation) throw new Error('no <Legislation> root');
  const legKids = childrenOf(legislation);
  const legAttrs = attrsOf(legislation);

  // Metadata: title + last-modified date on the source.
  const metadata = findChild(legKids, 'Metadata');
  const metaKids = metadata ? childrenOf(metadata) : [];
  const title = clean(textOf(findChild(metaKids, 'title') ?? ({ '#text': officialSourceId } as Node)));
  const modified = clean(textOf(findChild(metaKids, 'modified') ?? ({ '#text': '' } as Node))) || null;
  const actValidFrom = legAttrs.RestrictStartDate || null;

  const retrievedAt = new Date().toISOString();
  const sha256 = createHash('sha256').update(xml).digest('hex');
  const idSlug = officialSourceId.replace(/\//g, '-');
  const unitId = (officialId: string) => `lu_uk_${idSlug}_${officialId}`;
  const provenance = { sourceUrl: url, retrievedAt, language: 'en', validTo: null as string | null };

  const units: Omit<LegalUnit, 'documentId'>[] = [];
  let ord = 0;
  const pushUnit = (u: Omit<LegalUnit, 'documentId' | 'ord' | 'sha256Checksum' | 'retrievedAt' | 'sourceUrl' | 'language' | 'validTo'>) => {
    units.push({
      ...u,
      ...provenance,
      ord: ord++,
      sha256Checksum: createHash('sha256').update(`${u.breadcrumb}|${u.heading ?? ''}|${u.text}`).digest('hex'),
    });
  };

  // Body lives at Legislation > Primary > Body.
  const primary = findChild(legKids, 'Primary');
  const body = primary ? findChild(childrenOf(primary), 'Body') : undefined;
  if (!body) throw new Error('no <Body> in CLML');

  const crumbRoot = `UK / ${title}`;
  let sections = 0;

  const walkSectionContainer = (nodes: Node[], crumb: string, parentId: string | null, validDefault: string | null) => {
    for (const node of nodes) {
      const tag = tagOf(node);
      if (tag === 'Part' || tag === 'Chapter') {
        const kids = childrenOf(node);
        const num = clean(textOf(findChild(kids, 'Number') ?? ({ '#text': '' } as Node)));
        const heading = clean(textOf(findChild(kids, 'Title') ?? ({ '#text': '' } as Node)));
        const attrs = attrsOf(node);
        const kind = tag === 'Part' ? 'Part' : 'Chapter';
        const id = unitId(attrs.id || `${kind.toLowerCase()}-${num || ord}`);
        const label = num ? `${kind} ${num.replace(new RegExp(`^${kind}\\s*`, 'i'), '')}` : heading;
        pushUnit({
          id, parentId, unitType: tag === 'Part' ? 'part' : 'chapter', number: num || null, heading: heading || null,
          breadcrumb: `${crumb} / ${label}`,
          text: '', validFrom: attrs.RestrictStartDate || validDefault,
          officialUnitUri: attrs.IdURI || null,
        });
        walkSectionContainer(kids, `${crumb} / ${label}`, id, attrs.RestrictStartDate || validDefault);
      } else if (tag === 'Pblock') {
        const kids = childrenOf(node);
        const heading = clean(textOf(findChild(kids, 'Title') ?? ({ '#text': '' } as Node)));
        walkSectionContainer(kids, crumb, parentId, attrsOf(node).RestrictStartDate || validDefault);
        void heading; // cross-headings kept out of the breadcrumb to keep paths short
      } else if (tag === 'P1group') {
        const kids = childrenOf(node);
        const heading = clean(textOf(findChild(kids, 'Title') ?? ({ '#text': '' } as Node)));
        const groupValid = attrsOf(node).RestrictStartDate || validDefault;
        for (const p1 of findAll(kids, 'P1')) {
          const p1Kids = childrenOf(p1);
          const attrs = attrsOf(p1);
          const num = clean(textOf(findChild(p1Kids, 'Pnumber') ?? ({ '#text': '' } as Node)));
          const officialId = attrs.id || `section-${num}`;
          const id = unitId(officialId);
          const crumbSec = `${crumb} / s.${num}`;
          sections++;

          // Whole-section text: intro Text + each subsection "(n) …".
          const p1para = p1Kids.find((n) => tagOf(n) === 'P1para');
          const pieces: string[] = [];
          const subs: { id: string; num: string; text: string; uri: string | null; valid: string | null }[] = [];
          for (const child of p1para ? childrenOf(p1para) : []) {
            const ctag = tagOf(child);
            if (ctag === 'Text') pieces.push(clean(textOf(child)));
            else if (ctag === 'P2') {
              const t = provisionText(child);
              pieces.push(t);
              const cAttrs = attrsOf(child);
              const cNum = clean(textOf(findChild(childrenOf(child), 'Pnumber') ?? ({ '#text': '' } as Node)));
              subs.push({
                id: cAttrs.id || `${officialId}-${cNum}`,
                num: cNum,
                text: t,
                uri: cAttrs.IdURI || null,
                valid: cAttrs.RestrictStartDate || groupValid,
              });
            } else if (!SKIP_TEXT.has(ctag)) {
              const t = clean(textOf(child));
              if (t) pieces.push(t);
            }
          }

          pushUnit({
            id, parentId, unitType: 'section', number: num || null, heading: heading || null,
            breadcrumb: crumbSec, text: pieces.filter(Boolean).join('\n'),
            validFrom: groupValid, officialUnitUri: attrs.IdURI || null,
          });
          for (const sub of subs) {
            pushUnit({
              id: unitId(sub.id), parentId: id, unitType: 'subsection', number: sub.num || null,
              heading: null, breadcrumb: `${crumbSec} / (${sub.num})`, text: sub.text,
              validFrom: sub.valid, officialUnitUri: sub.uri,
            });
          }
        }
      }
    }
  };

  walkSectionContainer(childrenOf(body), crumbRoot, null, actValidFrom);
  if (sections === 0) throw new Error(`parsed 0 sections for ${officialSourceId} — refusing partial save`);

  return { officialSourceId, title, sourceUrl: url, retrievedAt, sha256, modifiedOnSource: modified, actValidFrom, units };
}
