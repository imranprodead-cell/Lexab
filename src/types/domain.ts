/**
 * Core domain model for LexAI.
 *
 * These types are the contract between the UI and the API layer. The mock API
 * and any future real backend must both satisfy them, so screens never need to
 * change when the data source is swapped.
 */

export type Severity = 'High' | 'Medium' | 'Low';

export type RiskLevel = 'Low' | 'Elevated' | 'High';

export type RedlineStatus = 'pending' | 'accepted' | 'rejected';

/** A slash command shown in the chat composer autocomplete. */
export interface Command {
  cmd: string;
  description: string;
  icon: string;
}

/** A single legal finding surfaced by the analysis. */
export interface Finding {
  id: string;
  severity: Severity;
  title: string;
  citation: string;
  /** legal_units id when the citation resolved against the statute corpus. */
  unitId?: string | null;
  /** Id of the redline that fixes this issue — click the finding to jump to
   *  and highlight that clause. Null when the finding has no proposed change. */
  redlineId?: string | null;
  /** True when citation validation could not confirm the source. */
  unverified?: boolean;
}

/** A tracked change the AI proposes inside the document. */
export interface Redline {
  id: string;
  delText: string;
  insText: string;
  severity: Severity;
  status: RedlineStatus;
}

/** An inline segment of a document paragraph: plain text or a redline slot. */
export type DocSegment = string | { redlineId: string };

export interface DocBlock {
  type: 'heading' | 'paragraph';
  text?: string;
  segments?: DocSegment[];
}

/** The full result returned by the contract analysis endpoint. */
export interface AnalysisResult {
  id: string;
  /** Owning document id — used for server-side export (Word/PDF). */
  documentId?: string;
  fileName: string;
  fileSize: string;
  summary: string;
  riskScore: number;
  riskLevel: RiskLevel;
  clausesReviewed: number;
  findings: Finding[];
  redlines: Redline[];
  document: DocBlock[];  /** Current viewer may edit (owner / team admin / editor). */
  canEdit?: boolean;
}

/** A chat message in the conversational canvas. */
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  kind: 'file' | 'text' | 'analysis';
  text?: string;
  file?: { name: string; size: string };
  analysisId?: string;
  /** True while an assistant message is still streaming in. */
  streaming?: boolean;
  /** User's thumbs rating of an assistant reply. */
  feedback?: 'up' | 'down' | null;
}

/** A saved review session shown in the sidebar, grouped by recency. */
export interface ChatSession {
  id: string;
  title: string;
  updatedAt: string; // ISO
  /** Pinned to the top of the sidebar. */
  pinned?: boolean;
  /** Hidden from the sidebar; shown on the Archive page. */
  archived?: boolean;
}

export type ContractStatus = 'Draft' | 'In review' | 'Reviewed' | 'Signed';

export interface ContractDocument {
  id: string;
  name: string;
  counterparty: string;
  status: ContractStatus;
  risk: RiskLevel;
  jurisdiction: string;
  size: string;
  updatedAt: string; // ISO
  /** Shared with the owner's team. */
  teamShared?: boolean;
  /** Owner name when this document is visible via team sharing. */
  sharedBy?: string;
  /** Current viewer may edit it. */
  canEdit?: boolean;
  /** Current viewer owns it. */
  mine?: boolean;
}

export interface Template {
  id: string;
  name: string;
  category: string;
  description: string;
  jurisdiction: string;
  clauses: number;
}

/** A generated contract the user chose to keep in their personal library. */
export interface SavedTemplate {
  id: string;
  title: string;
  content: string;
  sourceTemplateId?: string;
  jurisdiction?: string;
  createdAt: string;
}

export type SignatureStatus = 'Draft' | 'Sent' | 'Viewed' | 'Completed' | 'Declined';

export interface SignatureRecipient {
  name: string;
  email: string;
  signed: boolean;
  /** Public signing-link token (owner view). */
  token?: string;
  signedAt?: string | null;
}

export interface SignatureRequest {
  id: string;
  documentName: string;
  status: SignatureStatus;
  recipients: SignatureRecipient[];
  sentAt: string | null; // ISO or null for drafts
}

export interface DocumentVersion {
  id: string;
  label: string;
  author: string;
  createdAt: string; // ISO
  note: string;
}

export interface AnalyticsSummary {
  contractsReviewed: number;
  avgRiskScore: number;
  highRiskFindings: number;
  hoursSaved: number;
  reviewsByWeek: { week: string; count: number }[];
  findingsBySeverity: { severity: Severity; count: number }[];
}

/** Authenticated user profile (drives the rail footer + settings form). */
export interface UserProfile {
  name: string;
  initials: string;
  firm: string;
  jurisdiction: string;
  email: string;
  /** Data URL or remote URL of the user's avatar (optional). */
  avatarUrl?: string;  /** Email confirmed via the verification link. */
  emailVerified?: boolean;
  /** Organisation name set by the team owner/admin (null = no named team). */
  teamName?: string | null;
}
