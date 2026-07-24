/**
 * Core domain model for Lexab.
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
  /** True when this clause deviates from an active team playbook position. */
  playbookDeviation?: boolean;
}

/** A tracked change the AI proposes inside the document. */
export interface Redline {
  id: string;
  delText: string;
  insText: string;
  severity: Severity;
  status: RedlineStatus;
}

/** Inline character formatting on a text run. b=bold, i=italic, u=underline, s=strikethrough. */
export type Mark = 'b' | 'i' | 'u' | 's';

/** A formatted run of text inside a paragraph. */
export interface TextRun {
  text: string;
  /** Applied inline marks (empty/absent = plain). */
  marks?: Mark[];
  /** When set, the run is a hyperlink. */
  href?: string;
}

/**
 * An inline segment of a document paragraph. A bare `string` is a plain run
 * (kept for backward compatibility with older stored documents); a `TextRun`
 * carries inline formatting; a redline slot references a tracked change.
 */
export type DocSegment = string | TextRun | { redlineId: string };

/** Block-level type. `bullet`/`numbered` are single list items; consecutive
 *  items of the same kind render as one list. */
export type DocBlockType = 'heading' | 'paragraph' | 'bullet' | 'numbered';

export interface DocBlock {
  type: DocBlockType;
  text?: string;
  segments?: DocSegment[];
  /** Paragraph/list-item alignment (default left). */
  align?: 'left' | 'center' | 'right';
  /** Heading depth (1 = section title, 2 = sub-heading). Default 2. */
  level?: 1 | 2;
}

/** True when a segment is a redline slot (vs. plain text / formatted run). */
export function isRedlineSlot(seg: DocSegment): seg is { redlineId: string } {
  return typeof seg !== 'string' && 'redlineId' in seg;
}

/** True when a segment is a formatted text run (vs. bare string / redline). */
export function isTextRun(seg: DocSegment): seg is TextRun {
  return typeof seg !== 'string' && 'text' in seg;
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
  /** Russian display name (ru/kk/uz users); English `name` drives generation. */
  nameRu?: string | null;
  category: string;
  description: string;
  descriptionRu?: string | null;
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

/**
 * A team "playbook": a set of standard positions (rules) the AI checks each
 * analysed contract against, flagging clauses that deviate. `jurisdiction` is
 * one of the corpus codes (UK/UZ/KZ/DE/US/CA/AE) or null for a global playbook.
 */
export interface Playbook {
  id: string;
  name: string;
  jurisdiction: string | null;
  active: boolean;
  rules: string[];
  createdAt: string; // ISO
  updatedAt: string; // ISO
}

/** A tracked obligation extracted from a contract (CLM). Dates are date-only ISO (YYYY-MM-DD). */
export interface ContractObligation {
  id: string;
  text: string;
  dueDate: string | null;
  responsible: string | null;
  done: boolean;
}

/** Key terms extracted from an analysed contract. `daysToExpiry` is computed server-side. */
export interface ContractTermsInfo {
  effectiveDate: string | null;
  expiryDate: string | null;
  daysToExpiry: number | null;
  autoRenew: boolean | null;
  renewalNoticeDays: number | null;
  contractValue: string | null;
  currency: string | null;
  governingLaw: string | null;
  extractedAt: string; // ISO
}

/** One row of the contract-lifecycle register (own + team-shared documents). */
export interface ContractRow {
  documentId: string;
  name: string;
  counterparty: string;
  risk: string;
  status: string;
  mine: boolean;
  terms: ContractTermsInfo;
  obligations: ContractObligation[];
}

/** One file inside a batch review job. Populated as the queue processes it. */
export interface BatchItem {
  id: string;
  fileName: string;
  status: 'queued' | 'processing' | 'done' | 'error';
  documentId: string | null;
  analysisId: string | null;
  riskScore: number | null;
  riskLevel: string | null;
  findingsCount: number | null;
  error: string | null;
}

/** A batch review job: a set of uploaded contracts analysed together (Pro+). */
export interface BatchJob {
  id: string;
  status: 'queued' | 'processing' | 'done';
  total: number;
  done: number;
  failed: number;
  createdAt: string; // ISO
  /** Present on GET /batch/:id (per-file rows); absent on the history list. */
  items?: BatchItem[];
}

/** One approver of a `send-for-approval` workflow step (mirrors NewApprovalStep). */
export interface WorkflowApprover {
  name: string;
  email: string;
  role?: string | null;
  dueAt?: string | null;
}

/** A single step requested when launching an agentic workflow (order matters). */
export type WorkflowStepInput =
  | { kind: 'analyze' }
  | { kind: 'apply-redlines'; minSeverity: Severity }
  | { kind: 'send-for-approval'; approvers: WorkflowApprover[] };

/**
 * An agentic workflow run over one document: a queued chain of steps (analyse,
 * auto-accept redlines, send for approval) polled for progress. Pro+ feature.
 * The server returns a ready-made display `label` per step — render it as-is.
 */
export interface WorkflowRun {
  id: string;
  documentId: string | null;
  analysisId: string | null;
  status: 'queued' | 'running' | 'done' | 'failed';
  steps: { kind: string; label: string }[];
  currentStep: number;
  error: string | null;
  createdAt: string; // ISO
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
  /** Last 12 calendar months of activity, oldest first ("YYYY-MM"). */
  monthly: { month: string; reviews: number; findings: number }[];
  /** Corporate risk centre: where the portfolio's risk sits. */
  riskCenter: {
    topContracts: { id: string; name: string; counterparty: string; riskScore: number; riskLevel: RiskLevel }[];
    byJurisdiction: { jurisdiction: string; total: number; high: number }[];
    byCounterparty: { counterparty: string; total: number; high: number }[];
  };
  /** Citation validation stats + freshness of the statute corpus. */
  compliance: {
    verified: number;
    unverified: number;
    corpus: { jurisdiction: string; documents: number; updatedAt: string | null }[];
  };
  /** Per-member workload — null unless the viewer owns an active team.
   *  Counts come from THIS team's audit trail only (ai.analysis events under
   *  the owner's scope) — a member's outside work never shows up here. */
  team:
    | { id: string; name: string; role: string; reviews30d: number; reviewsTotal: number; lastActive: string | null }[]
    | null;
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
