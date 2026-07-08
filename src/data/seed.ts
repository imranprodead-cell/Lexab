/**
 * Seed data for the mock API. In production this is replaced by real backend
 * responses; the shapes match `types/domain.ts` exactly so the UI is agnostic
 * to the source.
 */
import type {
  AnalysisResult,
  ChatSession,
  Command,
  ContractDocument,
  DocumentVersion,
  SignatureRequest,
  Template,
  UserProfile,
  AnalyticsSummary,
} from '@/types/domain';

export const CURRENT_USER: UserProfile = {
  name: 'A. Rahman',
  initials: 'AR',
  firm: 'Freshfields',
  jurisdiction: 'United Kingdom',
  email: 'a.rahman@freshfields.com',
};

export const COMMANDS: Command[] = [
  { cmd: '/analyze', description: 'Review a contract for legal risk', icon: 'search' },
  { cmd: '/draft', description: 'Generate a clause or full document', icon: 'pen' },
  { cmd: '/compare', description: 'Diff two contract versions', icon: 'layout' },
  { cmd: '/translate', description: 'Translate & localise legal text', icon: 'globe' },
];

export const ANALYSIS_STEPS = [
  'Parsing document structure',
  'Checking against UK statute & case law',
  'Building risk report',
];

/** The canonical demo analysis returned by /analyze. */
export const DEMO_ANALYSIS: AnalysisResult = {
  id: 'an_employment_v3',
  fileName: 'Employment_Agreement_v3.docx',
  fileSize: '48 KB',
  summary:
    "This UK employment contract is largely standard, but three clauses create material legal exposure. The termination notice sits below the statutory floor, and the post-termination covenant is drafted too broadly to be reliably enforced. I've prepared tracked redlines for each finding.",
  riskScore: 62,
  riskLevel: 'Elevated',
  clausesReviewed: 14,
  findings: [
    {
      id: 'f1',
      severity: 'High',
      title: 'Termination notice below statutory minimum',
      citation: 'Employment Rights Act 1996, s.86',
    },
    {
      id: 'f2',
      severity: 'Medium',
      title: 'Restraint of trade likely too broad to enforce',
      citation: 'Tillman v Egon Zehnder [2019] UKSC 32',
    },
    {
      id: 'f3',
      severity: 'Medium',
      title: 'Holiday entitlement clause not compliant',
      citation: 'Working Time Regulations 1998, reg.13',
    },
  ],
  redlines: [
    { id: 'r1', delText: "one (1) week's", insText: "one (1) month's", severity: 'High', status: 'pending' },
    { id: 'r2', delText: 'twelve (12) months', insText: 'six (6) months', severity: 'Medium', status: 'pending' },
    {
      id: 'r3',
      delText: 'the statutory minimum',
      insText: "28 days' paid annual leave (inclusive of public holidays), accruing pro rata",
      severity: 'Medium',
      status: 'pending',
    },
  ],
  document: [
    { type: 'heading', text: '5.  Termination' },
    {
      type: 'paragraph',
      segments: [
        'Either party may terminate this Agreement by giving ',
        { redlineId: 'r1' },
        ' written notice to the other. Upon termination, the Employee shall promptly return all Company property and confidential materials.',
      ],
    },
    { type: 'heading', text: '8.  Post-Termination Restrictions' },
    {
      type: 'paragraph',
      segments: [
        'The Employee shall not, for a period of ',
        { redlineId: 'r2' },
        ' following the Termination Date, solicit or entice away any client with whom the Employee dealt during the twelve (12) months prior to termination.',
      ],
    },
    { type: 'heading', text: '11.  Holiday Entitlement' },
    {
      type: 'paragraph',
      segments: [
        'The Employee is entitled to ',
        { redlineId: 'r3' },
        " in each holiday year, in addition to the Employee's normal working days.",
      ],
    },
  ],
};

const now = Date.now();
const days = (n: number) => new Date(now - n * 86_400_000).toISOString();

export const CHAT_SESSIONS: ChatSession[] = [
  { id: 'c1', title: 'Employment Agreement v3', updatedAt: days(0) },
  { id: 'c2', title: 'MSA — Acme Corp', updatedAt: days(0) },
  { id: 'c3', title: 'NDA — mutual', updatedAt: days(1) },
  { id: 'c4', title: 'Supplier T&Cs review', updatedAt: days(1) },
  { id: 'c5', title: 'Series A SAFE note', updatedAt: days(3) },
  { id: 'c6', title: 'Lease — Unit 4B', updatedAt: days(5) },
  { id: 'c7', title: 'DPA — GDPR check', updatedAt: days(6) },
];

export const DOCUMENTS: ContractDocument[] = [
  { id: 'd1', name: 'Employment_Agreement_v3.docx', counterparty: 'Meridian Labs Ltd', status: 'In review', risk: 'Elevated', jurisdiction: 'UK', size: '48 KB', updatedAt: days(0) },
  { id: 'd2', name: 'MSA_Acme_Corp.docx', counterparty: 'Acme Corp', status: 'Reviewed', risk: 'Low', jurisdiction: 'UK', size: '112 KB', updatedAt: days(1) },
  { id: 'd3', name: 'Mutual_NDA.docx', counterparty: 'Northwind Partners', status: 'Signed', risk: 'Low', jurisdiction: 'UK', size: '22 KB', updatedAt: days(2) },
  { id: 'd4', name: 'Supplier_Terms_2026.pdf', counterparty: 'Delta Logistics', status: 'In review', risk: 'High', jurisdiction: 'EU', size: '86 KB', updatedAt: days(2) },
  { id: 'd5', name: 'SAFE_SeriesA.docx', counterparty: 'Orbit Ventures', status: 'Draft', risk: 'Elevated', jurisdiction: 'US', size: '54 KB', updatedAt: days(4) },
  { id: 'd6', name: 'Lease_Unit_4B.pdf', counterparty: 'Kingsway Estates', status: 'Reviewed', risk: 'Low', jurisdiction: 'UK', size: '203 KB', updatedAt: days(5) },
  { id: 'd7', name: 'DPA_GDPR.docx', counterparty: 'Cloudmesh Inc', status: 'In review', risk: 'Elevated', jurisdiction: 'EU', size: '61 KB', updatedAt: days(6) },
];

export const TEMPLATES: Template[] = [
  { id: 't1', name: 'Mutual NDA', category: 'Confidentiality', description: 'Two-way non-disclosure for early commercial talks.', jurisdiction: 'UK', clauses: 11 },
  { id: 't2', name: 'Employment Contract', category: 'Employment', description: 'Full-time permanent employee agreement, UK-compliant.', jurisdiction: 'UK', clauses: 24 },
  { id: 't3', name: 'Master Services Agreement', category: 'Commercial', description: 'Framework agreement for recurring professional services.', jurisdiction: 'UK', clauses: 32 },
  { id: 't4', name: 'Data Processing Addendum', category: 'Privacy', description: 'GDPR Article 28 processor terms.', jurisdiction: 'EU', clauses: 18 },
  { id: 't5', name: 'SAFE (Post-Money)', category: 'Fundraising', description: 'Simple agreement for future equity.', jurisdiction: 'US', clauses: 9 },
  { id: 't6', name: 'Consultancy Agreement', category: 'Commercial', description: 'Independent contractor engagement terms.', jurisdiction: 'UK', clauses: 16 },
];

export const SIGNATURES: SignatureRequest[] = [
  {
    id: 's1',
    documentName: 'Mutual_NDA.docx',
    status: 'Completed',
    sentAt: days(3),
    recipients: [
      { name: 'A. Rahman', email: 'a.rahman@freshfields.com', signed: true },
      { name: 'J. Okoro', email: 'j.okoro@northwind.com', signed: true },
    ],
  },
  {
    id: 's2',
    documentName: 'MSA_Acme_Corp.docx',
    status: 'Sent',
    sentAt: days(1),
    recipients: [
      { name: 'A. Rahman', email: 'a.rahman@freshfields.com', signed: true },
      { name: 'P. Nasser', email: 'p.nasser@acme.com', signed: false },
    ],
  },
];

export const VERSIONS: DocumentVersion[] = [
  { id: 'v3', label: 'v3 — current', author: 'A. Rahman', createdAt: days(0), note: 'AI redlines applied to termination clause.' },
  { id: 'v2', label: 'v2', author: 'A. Rahman', createdAt: days(2), note: 'Counterparty revisions to schedule 2.' },
  { id: 'v1', label: 'v1 — original', author: 'Meridian Labs', createdAt: days(9), note: 'Initial draft received.' },
];

export const ANALYTICS: AnalyticsSummary = {
  contractsReviewed: 148,
  avgRiskScore: 41,
  highRiskFindings: 27,
  hoursSaved: 216,
  reviewsByWeek: [
    { week: 'W1', count: 18 },
    { week: 'W2', count: 24 },
    { week: 'W3', count: 21 },
    { week: 'W4', count: 30 },
    { week: 'W5', count: 26 },
    { week: 'W6', count: 29 },
  ],
  findingsBySeverity: [
    { severity: 'High', count: 27 },
    { severity: 'Medium', count: 63 },
    { severity: 'Low', count: 112 },
  ],
};
