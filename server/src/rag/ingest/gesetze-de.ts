/**
 * gesetze-im-internet.de — the official free consolidated German federal law
 * database (run by the Bundesministerium der Justiz / juris). Each law is
 * offered as a single XML inside `<abbr>/xml.zip`, conforming to the
 * gii-norm.dtd. We fetch the CURRENT consolidated redaction and parse the flat
 * `<norm>` stream into legal units: Buch → Abschnitt → Titel → Untertitel →
 * § (Paragraph).
 *
 * WHITELIST RULE: this module is the ONLY way German legislation text enters
 * the corpus — straight from the official source, sha256 of the raw XML.
 *
 * Page structure (verified live 2026-07-12, BGB): the document is a sequence of
 * sibling `<norm>` elements under `<dokumente>`:
 *   - the first norm is document metadata: <langue>Bürgerliches Gesetzbuch</langue>
 *   - structural headers carry <gliederungseinheit> with a <gliederungskennzahl>
 *     (nesting encoded in 3-digit groups: 010 = Buch 1, 010010 = Abschnitt 1…),
 *     <gliederungsbez> ("Buch 2") and <gliederungstitel> ("Recht der Schuldverhältnisse").
 *   - a paragraph carries <enbez>§ 433</enbez> + <titel>Heading</titel> and its
 *     body in <textdaten><text><Content><P>…</P></Content>.
 * Repealed ranges ("(XXXX) §§ 1012 bis 1017") and "Inhaltsübersicht" are skipped
 * because they never match the single-§ heading pattern.
 */
import { createHash } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';
import type { LegalUnit } from '../types.ts';
import type { ParsedDocument } from './upsert.ts';

const BASE = 'https://www.gesetze-im-internet.de';
const MAX_XML_BYTES = 64 * 1024 * 1024; // decompression cap (zip-bomb guard)

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Extract the single XML member of a gesetze-im-internet.de `xml.zip`. The
 * archive holds exactly one deflated file; we read its local file header and
 * inflate the exact compressed slice (dependency-free, no external `unzip`).
 */
function unzipSingleXml(zip: Buffer): string {
  if (zip.length < 30 || zip.readUInt32LE(0) !== 0x04034b50) {
    throw new Error('not a zip archive (bad local file header)');
  }
  const flag = zip.readUInt16LE(6);
  const method = zip.readUInt16LE(8);
  const compSize = zip.readUInt32LE(18);
  const fnLen = zip.readUInt16LE(26);
  const extraLen = zip.readUInt16LE(28);
  const dataStart = 30 + fnLen + extraLen;

  // Sizes live in the local header for gesetze archives (data-descriptor bit
  // unset). Fall back to "data start → central directory" only if they don't.
  let comp: Buffer;
  if ((flag & 0x08) === 0 && compSize > 0) {
    comp = zip.subarray(dataStart, dataStart + compSize);
  } else {
    const cdIdx = zip.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]), dataStart);
    comp = zip.subarray(dataStart, cdIdx >= 0 ? cdIdx : undefined);
  }
  if (method === 0) return comp.toString('utf8'); // stored
  if (method !== 8) throw new Error(`unsupported zip compression method ${method}`);
  return inflateRawSync(comp, { maxOutputLength: MAX_XML_BYTES }).toString('utf8');
}

/** Polite fetch of `<abbr>/xml.zip`; retry with backoff on 429/5xx/network, never partial. */
export async function fetchGesetzXml(abbr: string): Promise<{ xml: string; url: string }> {
  if (!/^[a-z0-9_]+$/.test(abbr)) throw new Error(`invalid gesetze abbr: ${abbr}`);
  const zipUrl = `${BASE}/${abbr}/xml.zip`;
  const url = `${BASE}/${abbr}/`; // human-facing landing page for provenance
  let lastErr: Error | null = null;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await fetch(zipUrl, { headers: { 'user-agent': 'Lexab-corpus-ingest/1.0' } });
      if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`);
      if (!res.ok) throw new Error(`HTTP ${res.status} (permanent)`);
      const xml = unzipSingleXml(Buffer.from(await res.arrayBuffer()));
      if (!xml.includes('<dokumente') || !/<enbez>§/.test(xml)) throw new Error('response is not gii-norm XML (permanent)');
      return { xml, url };
    } catch (err) {
      lastErr = err as Error;
      if (String(lastErr.message).includes('permanent')) break;
      await sleep(1000 * attempt * attempt); // 1s, 4s, 9s
    }
  }
  throw new Error(`fetch ${zipUrl} failed: ${lastErr?.message}`);
}

const decodeEntities = (s: string): string =>
  s
    .replace(/&nbsp;/g, ' ')
    .replace(/&szlig;/g, 'ß')
    .replace(/&auml;/g, 'ä').replace(/&ouml;/g, 'ö').replace(/&uuml;/g, 'ü')
    .replace(/&Auml;/g, 'Ä').replace(/&Ouml;/g, 'Ö').replace(/&Uuml;/g, 'Ü')
    .replace(/&mdash;/g, '—').replace(/&ndash;/g, '–')
    .replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));

/** Inner XML of an element → one-line clean text (all tags stripped). */
const strip = (xml: string): string => decodeEntities(xml.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();

/** `<Content>` inner XML → readable multi-line body: each <P>/<BR> becomes a line break. */
function contentToText(content: string): string {
  const withBreaks = content
    .replace(/<\/P>/gi, '\n')
    .replace(/<BR\s*\/?>/gi, '\n')
    .replace(/<\/DD>/gi, '\n');
  return decodeEntities(withBreaks.replace(/<[^>]+>/g, ''))
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
    .trim();
}

const firstTag = (xml: string, tag: string): string | null => {
  const m = xml.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
  return m ? m[1] : null;
};

/** Map a structural level word → corpus unit type (Buch is the top part). */
function structuralType(bez: string): LegalUnit['unitType'] {
  return /^Buch\b/i.test(bez) ? 'part' : 'chapter';
}

export function parseGesetzXml(abbr: string, xml: string, url: string): ParsedDocument {
  const code = abbr.toLowerCase();
  const jurabk = strip(firstTag(xml, 'jurabk') ?? '') || code.toUpperCase();
  const title = strip(firstTag(xml, 'langue') ?? '') || jurabk;
  const retrievedAt = new Date().toISOString();
  const sha256 = createHash('sha256').update(xml).digest('hex');

  const unitId = (suffix: string) => `lu_de_${code}_${suffix}`;
  const base = { language: 'de', validFrom: null as string | null, validTo: null as string | null, sourceUrl: url, retrievedAt };
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

  const crumbRoot = `DE / ${title}`;
  // Structural stack, keyed by gliederungskennzahl prefix (3-digit groups).
  const stack: { kennzahl: string; id: string; label: string }[] = [];
  let sections = 0;

  const normRe = /<norm\b[^>]*>([\s\S]*?)<\/norm>/gi;
  for (let m = normRe.exec(xml); m; m = normRe.exec(xml)) {
    const inner = m[1];

    // Structural header (Buch / Abschnitt / Titel / Untertitel / Kapitel).
    const glied = firstTag(inner, 'gliederungseinheit');
    if (glied) {
      const kennzahl = strip(firstTag(glied, 'gliederungskennzahl') ?? '');
      const bez = strip(firstTag(glied, 'gliederungsbez') ?? '');
      const gtitel = strip(firstTag(glied, 'gliederungstitel') ?? '');
      if (!kennzahl || !bez) continue;
      // Pop everything that is not an ancestor (its kennzahl must prefix ours).
      while (stack.length && !kennzahl.startsWith(stack[stack.length - 1].kennzahl)) stack.pop();
      const parentId = stack.length ? stack[stack.length - 1].id : null;
      const label = [bez, gtitel].filter(Boolean).join(' ');
      const id = unitId(`g-${kennzahl}`);
      push({
        id, parentId, unitType: structuralType(bez), number: bez.replace(/^\D+/, '') || null,
        heading: gtitel || null, breadcrumb: [crumbRoot, ...stack.map((s) => s.label), label].join(' / '),
        text: '', officialUnitUri: url,
      });
      stack.push({ kennzahl, id, label });
      continue;
    }

    // Paragraph: <enbez>§ 433</enbez> — a single §, not a repealed range or TOC.
    const enbez = strip(firstTag(inner, 'enbez') ?? '');
    const par = enbez.match(/^§\s*(\d+[a-z]*)$/i);
    if (!par) continue;
    const num = par[1];
    const heading = strip(firstTag(inner, 'titel') ?? '');
    const content = firstTag(inner, 'Content') ?? '';
    const text = contentToText(content);
    if (!text) continue; // e.g. "§ 433 (weggefallen)" with empty content
    const parentId = stack.length ? stack[stack.length - 1].id : null;
    push({
      id: unitId(`p-${num}`), parentId, unitType: 'section', number: num, heading: heading || null,
      breadcrumb: [crumbRoot, ...stack.map((s) => s.label), `§ ${num}`].join(' / '),
      text, officialUnitUri: `${BASE}/${code}/__${num}.html`,
    });
    sections++;
  }

  if (sections === 0) throw new Error(`parsed 0 sections for gesetze/${abbr} — refusing partial save`);

  return {
    docId: `ld_de_${code}`,
    jurisdiction: 'DE',
    officialSourceId: code,
    docType: /gesetzbuch/i.test(title) ? 'code' : 'act',
    title,
    sourceUrl: url,
    retrievedAt,
    sha256,
    modifiedOnSource: null,
    units,
  };
}
