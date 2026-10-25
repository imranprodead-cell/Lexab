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
  /** Договор загружен сканом или фото, и его текст для чата распознаёт ИИ:
   *  'pending' — ещё распознаётся, 'done' — готов, 'failed' — не вышло.
   *  Нет поля — текст взят из самого файла. */
  scanOcr?: 'pending' | 'done' | 'failed';
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
  /** Файлы, прикреплённые к вопросу (имя и размер). */
  attachments?: { name: string; size: string }[];
  /** Статьи законов, найденные в базе для этого ответа ИИ; url — статья на
   *  официальном сайте (lex.uz, legislation.gov.uk, …). */
  refs?: { label: string; doc: string; url?: string }[];
}

/**
 * Шаг работы над ответом чата (SSE-событие `step`): клиент показывает их
 * списком «Работаю…», как процесс у Claude. Только то, что сервер реально
 * делает, — подписи шагов клиент берёт из своих переводов по id.
 */
export interface ChatStep {
  id: 'prompt' | 'contract' | 'files' | 'memory' | 'search' | 'mode' | 'answer';
  status: 'active' | 'done';
  data?: {
    /** contract: имя договора или черновика. */
    name?: string;
    /** files: имена файлов чата, которые читает модель. */
    files?: string[];
    /** search: код базы законов (UZ, KZ, …) и поисковые запросы. */
    jurisdiction?: string;
    queries?: string[];
    found?: number;
    refs?: { label: string; doc: string; url?: string }[];
    failed?: boolean;
    /** mode: plan | slides | approve. */
    mode?: string;
  };
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
  /** Проект (дело), в котором лежит документ; null/отсутствует = вне проектов. */
  projectId?: string | null;
}

/** Документ из чата, который человек сохранил (Vault → Documents). */
export interface SavedDoc {
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
  /** «Деньги под риском»: стоимость договоров по уровням риска (из CLM-условий,
   *  по валютам) + сколько высокорисковых истекает в ближайшие ~3 месяца. */
  valueAtRisk: {
    currencies: { currency: string; high: number; elevated: number; low: number; total: number }[];
    highRiskExpiringSoon: number;
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
