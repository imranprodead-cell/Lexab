/** Legal RAG corpus types — mirror of migrations/014_rag_corpus.sql. */

export type JurisdictionCode = 'UK' | 'UZ' | 'KZ';

export interface LegalDocument {
  id: string;
  jurisdiction: JurisdictionCode;
  officialSourceId: string; // e.g. 'ukpga/1979/54'
  docType: 'act' | 'code' | 'regulation';
  title: string;
  status: 'in_force' | 'repealed' | 'missing';
  sourceUrl: string;
  retrievedAt: string;
  sha256Checksum: string;
  modifiedOnSource: string | null;
}

export type UnitType = 'part' | 'chapter' | 'crossheading' | 'section' | 'subsection' | 'article' | 'paragraph';

export interface LegalUnit {
  id: string; // deterministic: lu_uk_ukpga-1979-54_section-14
  documentId: string;
  parentId: string | null;
  unitType: UnitType;
  number: string | null;
  heading: string | null;
  breadcrumb: string; // 'UK / Sale of Goods Act 1979 / Part IV / s.14'
  text: string;
  language: string;
  ord: number;
  validFrom: string | null;
  validTo: string | null;
  officialUnitUri: string | null;
  sourceUrl: string;
  retrievedAt: string;
  sha256Checksum: string;
}

export interface RetrievedChunk {
  chunkId: string;
  unitId: string;
  documentId: string;
  jurisdiction: JurisdictionCode;
  breadcrumb: string;
  contextSummary: string;
  body: string;
  validFrom: string | null;
  validTo: string | null;
  sourceUrl: string;
  score: number;
}

export interface RetrieveParams {
  query: string;
  jurisdiction: JurisdictionCode;
  /** Redaction date — only units in force on this date are searched. Default: today. */
  asOfDate?: string;
  topK?: number;
  language?: string;
}
