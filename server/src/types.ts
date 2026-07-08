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
}

export interface Redline {
  id: string;
  delText: string;
  insText: string;
  severity: Severity;
  status: RedlineStatus;
}

export type DocSegment = string | { redlineId: string };

export interface DocBlock {
  type: 'heading' | 'paragraph';
  text?: string;
  segments?: DocSegment[];
}

export interface AnalysisResult {
  id: string;
  fileName: string;
  fileSize: string;
  summary: string;
  riskScore: number;
  riskLevel: RiskLevel;
  clausesReviewed: number;
  findings: Finding[];
  redlines: Redline[];
  document: DocBlock[];
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  kind: 'file' | 'text' | 'analysis';
  text?: string;
  file?: { name: string; size: string };
  analysisId?: string;
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
  updatedAt: string;
}

export interface Template {
  id: string;
  name: string;
  category: string;
  description: string;
  jurisdiction: string;
  clauses: number;
}

export type SignatureStatus = 'Draft' | 'Sent' | 'Viewed' | 'Completed' | 'Declined';

export interface SignatureRecipient {
  name: string;
  email: string;
  signed: boolean;
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
}

export interface UserProfile {
  name: string;
  initials: string;
  firm: string;
  jurisdiction: string;
  email: string;
  avatarUrl?: string;
}

/** Notification shape from src/store/useNotificationsStore.ts. */
export interface AppNotification {
  id: string;
  icon: 'esign' | 'check' | 'alert' | 'docs';
  title: string;
  time: string;
  read: boolean;
}

/** Team member shape from src/pages/TeamPage.tsx. */
export interface Member {
  id: string;
  name: string;
  email: string;
  roleKey: string;
  statusKey: string;
  color: string;
}
