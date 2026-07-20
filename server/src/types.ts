/**
 * Server-side copies of the frontend domain types (src/types/domain.ts).
 * These are the wire shapes — do not change them without changing the UI.
 */

export type Severity = 'High' | 'Medium' | 'Low';
export type RiskLevel = 'Low' | 'Elevated' | 'High';
export type RedlineStatus = 'pending' | 'accepted' | 'rejected';

export interface Finding {
  id: string;
  severity: Severity;
  title: string;
  citation: string;
  /** Link into the legal corpus (legal_units.id) when the finding cites a real provision. */
  unitId?: string | null;
  /** Id of the redline that fixes this issue (r1, r2, …), or null when the
   *  issue has no proposed change. Powers "click finding → jump to clause". */
  redlineId?: string | null;
  /** True when the citation failed validation — the finding was demoted (RAG Этап 4). */
  unverified?: boolean;
  /** True when this finding flags a deviation from the team's playbook (a
   *  standard-position breach) rather than a pure statutory risk. */
  playbookDeviation?: boolean;
}

export interface Redline {
  id: string;
  delText: string;
  insText: string;
  severity: Severity;
  status: RedlineStatus;
}

export type Mark = 'b' | 'i' | 'u' | 's';

export interface TextRun {
  text: string;
  marks?: Mark[];
  href?: string;
}

export type DocSegment = string | TextRun | { redlineId: string };

export type DocBlockType = 'heading' | 'paragraph' | 'bullet' | 'numbered';

export interface DocBlock {
  type: DocBlockType;
  text?: string;
  segments?: DocSegment[];
  align?: 'left' | 'center' | 'right';
  level?: 1 | 2;
}

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
  document: DocBlock[];  /** Viewer may edit (owner / team admin / editor). */
  canEdit?: boolean;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  kind: 'file' | 'text' | 'analysis';
  text?: string;
  file?: { name: string; size: string };
  analysisId?: string;
  /** User's thumbs rating of an assistant reply. */
  feedback?: 'up' | 'down' | null;
}

export interface ChatSession {
  id: string;
  title: string;
  updatedAt: string;
  pinned?: boolean;
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
  updatedAt: string;  /** Shared with the owner's team. */
  teamShared?: boolean;
  /** Owner name when the viewer sees it via team sharing. */
  sharedBy?: string;
  /** Viewer may edit (owner / admin / editor). */
  canEdit?: boolean;
  /** The viewer owns this document. */
  mine?: boolean;
}

export interface Template {
  id: string;
  name: string;
  /** Russian display name (shown to ru/kk/uz users; English `name` drives the LLM). */
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

export type SignatureStatus = 'Draft' | 'Sent' | 'Viewed' | 'Completed' | 'Declined';

export interface SignatureRecipient {
  name: string;
  email: string;
  signed: boolean;  /** Public signing token (owner view). */
  token?: string;
  signedAt?: string | null;
}

export interface SignatureRequest {
  id: string;
  documentName: string;
  status: SignatureStatus;
  recipients: SignatureRecipient[];
  sentAt: string | null;
}

export interface DocumentVersion {
  id: string;
  label: string;
  author: string;
  createdAt: string;
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

export interface UserProfile {
  name: string;
  initials: string;
  firm: string;
  jurisdiction: string;
  email: string;
  avatarUrl?: string;  /** Email confirmed via the verification link (Google users: auto-true). */
  emailVerified?: boolean;
  /** Organisation name set by the team owner/admin (null = no named team). */
  teamName?: string | null;
}

/** Notification shape from src/store/useNotificationsStore.ts. */
export interface AppNotification {
  id: string;
  icon: 'esign' | 'check' | 'alert' | 'docs';
  title: string;
  time: string;
  read: boolean;
  titleEn?: string | null;
  body?: string | null;
  bodyEn?: string | null;
  /** 'team_invite' (data = invite token) or 'open' (data = app path). */
  actionKind?: string;
  actionData?: string;
  createdAt?: string;
}

/** Team member shape from src/pages/TeamPage.tsx. */
export interface Member {
  id: string;
  name: string;
  email: string;
  roleKey: string;
  statusKey: string;
  color: string;
  /** Human job title (Юрист, Директор, …) chosen when inviting. */
  title?: string | null;
  /** True when the current viewer (team owner) may remove this member. */
  manageable?: boolean;
  /** Present on pending invitations (owner view) — builds the join link. */
  inviteToken?: string;
}
