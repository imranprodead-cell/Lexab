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
  { id: 't1', name: 'Mutual NDA', nameRu: 'Двусторонний NDA', category: 'Confidentiality', description: 'Two-way non-disclosure for early commercial talks.', descriptionRu: 'Взаимное соглашение о неразглашении для ранних переговоров.', jurisdiction: 'UK', clauses: 11 },
  { id: 't2', name: 'Employment Contract', nameRu: 'Трудовой договор', category: 'Employment', description: 'Full-time permanent employee agreement, UK-compliant.', descriptionRu: 'Бессрочный трудовой договор с сотрудником (право Великобритании).', jurisdiction: 'UK', clauses: 24 },
  { id: 't3', name: 'Master Services Agreement', nameRu: 'Рамочный договор услуг (MSA)', category: 'Commercial', description: 'Framework agreement for recurring professional services.', descriptionRu: 'Рамочное соглашение о регулярных профессиональных услугах.', jurisdiction: 'UK', clauses: 32 },
  { id: 't4', name: 'Data Processing Addendum', nameRu: 'Соглашение об обработке данных', category: 'Privacy', description: 'GDPR Article 28 processor terms.', descriptionRu: 'Условия обработчика по статье 28 GDPR.', jurisdiction: 'EU', clauses: 18 },
  { id: 't5', name: 'SAFE (Post-Money)', nameRu: 'SAFE (Post-Money)', category: 'Fundraising', description: 'Simple agreement for future equity.', descriptionRu: 'Простое соглашение о будущем участии в капитале.', jurisdiction: 'US', clauses: 9 },
  { id: 't6', name: 'Consultancy Agreement', nameRu: 'Договор консультационных услуг', category: 'Commercial', description: 'Independent contractor engagement terms.', descriptionRu: 'Условия привлечения независимого консультанта.', jurisdiction: 'UK', clauses: 16 },
  { id: 't7', name: 'Residential Lease', nameRu: 'Аренда квартиры', category: 'Real Estate', description: 'Residential tenancy between individuals.', descriptionRu: 'Найм жилого помещения между физлицами: срок, депозит, коммунальные платежи.', jurisdiction: 'UZ', clauses: 14 },
  { id: 't8', name: 'Commercial Lease', nameRu: 'Аренда коммерческого помещения', category: 'Real Estate', description: 'Office or retail space lease.', descriptionRu: 'Аренда офиса или торговой площади: индексация, ремонт, досрочное расторжение.', jurisdiction: 'KZ', clauses: 20 },
  { id: 't9', name: 'Services Agreement', nameRu: 'Договор оказания услуг', category: 'Commercial', description: 'Paid provision of services.', descriptionRu: 'Возмездное оказание услуг: объём, сроки, приёмка, оплата.', jurisdiction: 'UZ', clauses: 15 },
  { id: 't10', name: 'Work Contract', nameRu: 'Договор подряда', category: 'Commercial', description: 'Contract for work with a deliverable.', descriptionRu: 'Выполнение работ с результатом: этапы, приёмка, гарантия, неустойка.', jurisdiction: 'UZ', clauses: 18 },
  { id: 't11', name: 'Sale of Goods', nameRu: 'Договор купли-продажи товара', category: 'Sales', description: 'One-off sale of goods.', descriptionRu: 'Разовая купля-продажа: качество, передача, переход риска.', jurisdiction: 'KZ', clauses: 12 },
  { id: 't12', name: 'Supply Agreement', nameRu: 'Договор поставки', category: 'Sales', description: 'Recurring deliveries of goods.', descriptionRu: 'Регулярные поставки: график, приёмка по количеству/качеству, ответственность.', jurisdiction: 'KZ', clauses: 17 },
  { id: 't13', name: 'Personal Loan', nameRu: 'Договор займа между физлицами', category: 'Finance', description: 'Loan of money between individuals.', descriptionRu: 'Денежный займ: сумма, проценты, график возврата, расписка.', jurisdiction: 'UZ', clauses: 10 },
  { id: 't14', name: 'Employment Contract (UZ)', nameRu: 'Трудовой договор (Узбекистан)', category: 'Employment', description: 'Employment contract under the Labour Code of Uzbekistan.', descriptionRu: 'Трудовой договор по ТК Республики Узбекистан: испытательный срок, отпуск.', jurisdiction: 'UZ', clauses: 22 },
  { id: 't15', name: 'Employment Contract (KZ)', nameRu: 'Трудовой договор (Казахстан)', category: 'Employment', description: 'Employment contract under the Labour Code of Kazakhstan.', descriptionRu: 'Трудовой договор по ТК Республики Казахстан.', jurisdiction: 'KZ', clauses: 22 },
  { id: 't16', name: 'Contractor Agreement', nameRu: 'Договор с самозанятым / ИП', category: 'Employment', description: 'Civil-law engagement of a contractor (no employment).', descriptionRu: 'Гражданско-правовой договор с самозанятым или ИП: без трудовых отношений.', jurisdiction: 'KZ', clauses: 13 },
  { id: 't17', name: 'Agency Agreement', nameRu: 'Агентский договор', category: 'Commercial', description: 'Agent acts on behalf of a principal.', descriptionRu: 'Агент действует от имени принципала: полномочия, вознаграждение, отчёты.', jurisdiction: 'GB', clauses: 16 },
  { id: 't18', name: 'License Agreement', nameRu: 'Лицензионный договор', category: 'IP & IT', description: 'License of software or content.', descriptionRu: 'Лицензия на ПО или контент: объём прав, территория, роялти.', jurisdiction: 'US', clauses: 15 },
  { id: 't19', name: 'Mandate Agreement', nameRu: 'Договор поручения', category: 'Commercial', description: 'Attorney performs legal acts for a principal.', descriptionRu: 'Поверенный совершает юридические действия от имени доверителя.', jurisdiction: 'UZ', clauses: 11 },
  { id: 't20', name: 'Distribution Agreement', nameRu: 'Дистрибьюторский договор', category: 'Commercial', description: 'Exclusive or non-exclusive distribution.', descriptionRu: 'Эксклюзивная/неэксклюзивная дистрибуция: территория, планы продаж.', jurisdiction: 'AE', clauses: 19 },
  { id: 't21', name: 'Franchise Agreement', nameRu: 'Договор франчайзинга', category: 'Commercial', description: 'Commercial concession: brand, standards, royalties.', descriptionRu: 'Коммерческая концессия: бренд, стандарты, паушальный взнос, роялти.', jurisdiction: 'AE', clauses: 24 },
  { id: 't22', name: 'Service Level Agreement (SLA)', nameRu: 'Соглашение об уровне сервиса (SLA)', category: 'IP & IT', description: 'Availability metrics, response times, service credits.', descriptionRu: 'Метрики доступности, время реакции, сервисные кредиты.', jurisdiction: 'GB', clauses: 12 },
  { id: 't23', name: 'Business Loan', nameRu: 'Кредитный договор для бизнеса', category: 'Finance', description: 'Loan to a company: tranches, covenants, security.', descriptionRu: 'Займ для компании: транши, ковенанты, обеспечение, досрочное погашение.', jurisdiction: 'GB', clauses: 16 },
  { id: 't24', name: "Shareholders' Agreement", nameRu: 'Акционерное соглашение', category: 'Corporate', description: 'Shareholder rights: governance, drag/tag-along.', descriptionRu: 'Права акционеров: управление, drag/tag-along, преимущественная покупка.', jurisdiction: 'GB', clauses: 28 },
  { id: 't25', name: 'Software Development Agreement', nameRu: 'Договор на разработку ПО', category: 'IP & IT', description: 'Bespoke development: spec, milestones, IP, acceptance.', descriptionRu: 'Заказная разработка: ТЗ, этапы, IP-права, приёмка, поддержка.', jurisdiction: 'US', clauses: 21 },
  { id: 't26', name: 'Freelance Contract', nameRu: 'Международный фриланс-контракт', category: 'Commercial', description: 'Cross-border contract with a freelancer.', descriptionRu: 'Кросс-граничный контракт с фрилансером: оплата, IP, независимый статус.', jurisdiction: 'US', clauses: 12 },
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
  monthly: [14, 11, 16, 13, 18, 15, 19, 17, 22, 20, 24, 21].map((reviews, i) => {
    const d = new Date();
    d.setUTCMonth(d.getUTCMonth() - (11 - i), 1);
    const month = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    return { month, reviews, findings: Math.round(reviews * 0.7) };
  }),
  riskCenter: {
    topContracts: [
      { id: 'd1', name: 'MSA — Meridian Labs', counterparty: 'Meridian Labs', riskScore: 82, riskLevel: 'High' },
      { id: 'd2', name: 'Supply Agreement — Acme', counterparty: 'Acme GmbH', riskScore: 67, riskLevel: 'Elevated' },
      { id: 'd3', name: 'NDA — Northwind', counterparty: 'Northwind LLC', riskScore: 44, riskLevel: 'Elevated' },
      { id: 'd4', name: 'SaaS Terms — Contoso', counterparty: 'Contoso Ltd', riskScore: 31, riskLevel: 'Low' },
    ],
    byJurisdiction: [
      { jurisdiction: 'UK', total: 9, high: 2 },
      { jurisdiction: 'UZ', total: 6, high: 1 },
      { jurisdiction: 'DE', total: 3, high: 0 },
    ],
    byCounterparty: [
      { counterparty: 'Meridian Labs', total: 4, high: 2 },
      { counterparty: 'Acme GmbH', total: 3, high: 1 },
      { counterparty: 'Northwind LLC', total: 2, high: 0 },
    ],
  },
  compliance: {
    verified: 178,
    unverified: 24,
    corpus: [
      { jurisdiction: 'UK', documents: 8, updatedAt: days(12) },
      { jurisdiction: 'UZ', documents: 4, updatedAt: days(20) },
      { jurisdiction: 'KZ', documents: 4, updatedAt: days(18) },
      { jurisdiction: 'DE', documents: 1, updatedAt: days(25) },
    ],
  },
  team: null,
};
