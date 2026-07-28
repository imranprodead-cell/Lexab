/**
 * Shared corpus writer: idempotent, incremental upsert of a parsed document
 * (any jurisdiction). No partial saves — the document checksum is written
 * LAST, so an interrupted run redoes the whole act next time.
 */
import type { Db } from '../../db.ts';
import type { LegalUnit } from '../types.ts';

export interface ParsedDocument {
  docId: string; // deterministic: ld_uk_ukpga-1979-54 / ld_uz_111181 / ld_de_bgb
  jurisdiction: 'UK' | 'UZ' | 'KZ' | 'DE' | 'US' | 'CA' | 'AE';
  officialSourceId: string;
  docType: 'act' | 'code' | 'regulation' | 'decree' | 'resolution';
  /** Канонический номер подзаконного акта («УП-6079»); у законов отсутствует. */
  docNumber?: string | null;
  title: string;
  sourceUrl: string;
  retrievedAt: string;
  sha256: string;
  modifiedOnSource: string | null;
  units: Omit<LegalUnit, 'documentId'>[];
}

export async function upsertParsedDocument(
  db: Db,
  doc: ParsedDocument,
  force: boolean,
): Promise<{ units: number; changed: boolean }> {
  const existing = await db.query<{ sha256_checksum: string }>(
    'SELECT sha256_checksum FROM legal_documents WHERE id = $1',
    [doc.docId],
  );
  if (!force && existing.rows[0]?.sha256_checksum === doc.sha256) {
    return { units: 0, changed: false };
  }

  // 1. Document row (checksum intentionally NOT updated yet).
  await db.query(
    `INSERT INTO legal_documents (id, jurisdiction, official_source_id, doc_type, doc_number, title, status, source_url, retrieved_at, sha256_checksum, modified_on_source)
     VALUES ($1, $2, $3, $4, $5, $6, 'in_force', $7, $8, coalesce((SELECT sha256_checksum FROM legal_documents WHERE id = $1), 'pending'), $9)
     ON CONFLICT (jurisdiction, official_source_id)
     DO UPDATE SET doc_number = $5, title = $6, source_url = $7, retrieved_at = $8, modified_on_source = $9, updated_at = now()`,
    [doc.docId, doc.jurisdiction, doc.officialSourceId, doc.docType, doc.docNumber ?? null, doc.title, doc.sourceUrl, doc.retrievedAt, doc.modifiedOnSource],
  );

  // 2. Units: upsert by deterministic id, then drop the ones that disappeared.
  for (const u of doc.units) {
    await db.query(
      `INSERT INTO legal_units (id, document_id, parent_id, unit_type, number, heading, breadcrumb, text, language, ord, valid_from, valid_to, official_unit_uri, source_url, retrieved_at, sha256_checksum)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
       ON CONFLICT (id) DO UPDATE SET
         parent_id = $3, unit_type = $4, number = $5, heading = $6, breadcrumb = $7, text = $8,
         ord = $10, valid_from = $11, valid_to = $12, official_unit_uri = $13,
         source_url = $14, retrieved_at = $15, sha256_checksum = $16`,
      [
        u.id, doc.docId, u.parentId, u.unitType, u.number, u.heading, u.breadcrumb, u.text, u.language,
        u.ord, u.validFrom, u.validTo, u.officialUnitUri, u.sourceUrl, u.retrievedAt, u.sha256Checksum,
      ],
    );
  }
  await db.query(`DELETE FROM legal_units WHERE document_id = $1 AND NOT (id = ANY($2::text[]))`, [
    doc.docId,
    doc.units.map((u) => u.id),
  ]);

  // 3. Checksum last — commits the document as fully ingested.
  await db.query('UPDATE legal_documents SET sha256_checksum = $2, updated_at = now() WHERE id = $1', [
    doc.docId,
    doc.sha256,
  ]);
  return { units: doc.units.length, changed: true };
}
