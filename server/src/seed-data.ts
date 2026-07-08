/**
 * Seed data — mirrors the frontend mock (src/data/seed.ts and the stores) so
 * flipping VITE_USE_MOCK_API=false lands on the exact same demo content,
 * including the analytics figures (148 reviews, avg 41, 27 high-risk
 * findings, 216 hours saved, weekly counts 18/24/21/30/26/29).
 */
import { DEMO_USER_ID, config } from './config.ts';
import type { Db } from './db.ts';
import { newId } from './lib/ids.ts';
import { hashPassword } from './lib/passwords.ts';

const DAY = 86_400_000;
const HOUR = 3_600_000;

export async function seedIfEmpty(db: Db): Promise<boolean> {
  const res = await db.query<{ count: string | number }>('SELECT count(*) AS count FROM users');
  if (Number(res.rows[0]?.count ?? 0) > 0) return false;
  await seedDatabase(db);
  return true;
}

export async function seedDatabase(db: Db): Promise<void> {
  const now = Date.now();
  const daysAgo = (n: number) => new Date(now - n * DAY).toISOString();
  const hoursAgo = (n: number) => new Date(now - n * HOUR).toISOString();

  // ── Demo user ───────────────────────────────────────────────────────────────
  const passwordHash = await hashPassword(config.seedDemoPassword);
  await db.query(
    `INSERT INTO users (id, email, password_hash, name, initials, firm, jurisdiction)
     VALUES ($1, $2, $3, 'A. Rahman', 'AR', 'Freshfields', 'United Kingdom')`,
    [DEMO_USER_ID, 'a.rahman@freshfields.com', passwordHash],
  );
  await db.query(
    `INSERT INTO subscriptions (user_id, plan, status, renews_at) VALUES ($1, 'Pro', 'active', $2)`,
    [DEMO_USER_ID, daysAgo(-30)],
  );

  // ── Chat sessions ───────────────────────────────────────────────────────────
  const sessions: [string, string, number][] = [
    ['c1', 'Employment Agreement v3', 0],
    ['c2', 'MSA — Acme Corp', 0],
    ['c3', 'NDA — mutual', 1],
    ['c4', 'Supplier T&Cs review', 1],
    ['c5', 'Series A SAFE note', 3],
    ['c6', 'Lease — Unit 4B', 5],
    ['c7', 'DPA — GDPR check', 6],
  ];
  for (const [id, title, age] of sessions) {
    await db.query(
      'INSERT INTO chat_sessions (id, user_id, title, created_at, updated_at) VALUES ($1, $2, $3, $4, $4)',
      [id, DEMO_USER_ID, title, daysAgo(age)],
    );
  }

  // ── Documents (d1..d7) ──────────────────────────────────────────────────────
  const documents: [string, string, string, string, string, string, number, number][] = [
    ['d1', 'Employment_Agreement_v3.docx', 'Meridian Labs Ltd', 'In review', 'Elevated', 'UK', 48, 0],
    ['d2', 'MSA_Acme_Corp.docx', 'Acme Corp', 'Reviewed', 'Low', 'UK', 112, 1],
    ['d3', 'Mutual_NDA.docx', 'Northwind Partners', 'Signed', 'Low', 'UK', 22, 2],
    ['d4', 'Supplier_Terms_2026.pdf', 'Delta Logistics', 'In review', 'High', 'EU', 86, 2],
    ['d5', 'SAFE_SeriesA.docx', 'Orbit Ventures', 'Draft', 'Elevated', 'US', 54, 4],
    ['d6', 'Lease_Unit_4B.pdf', 'Kingsway Estates', 'Reviewed', 'Low', 'UK', 203, 5],
    ['d7', 'DPA_GDPR.docx', 'Cloudmesh Inc', 'In review', 'Elevated', 'EU', 61, 6],
  ];
  for (const [id, name, counterparty, status, risk, jurisdiction, kb, age] of documents) {
    await db.query(
      `INSERT INTO documents (id, user_id, name, counterparty, status, risk, jurisdiction, size_bytes, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [id, DEMO_USER_ID, name, counterparty, status, risk, jurisdiction, kb * 1024, daysAgo(age)],
    );
    // Version history (mirrors the mock's three entries per document).
    await db.query(
      `INSERT INTO document_versions (id, document_id, label, author, note, created_at) VALUES
       ($1, $4, 'v3 — current', 'A. Rahman', 'AI redlines applied to termination clause.', $5),
       ($2, $4, 'v2', 'A. Rahman', 'Counterparty revisions to schedule 2.', $6),
       ($3, $4, 'v1 — original', $7, 'Initial draft received.', $8)`,
      [`${id}_v3`, `${id}_v2`, `${id}_v1`, id, daysAgo(age), daysAgo(age + 2), counterparty, daysAgo(age + 9)],
    );
  }

  // ── Canonical demo analysis (an_employment_v3 → d1) ─────────────────────────
  const documentBlocks = [
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
  ];
  await db.query(
    `INSERT INTO analyses (id, user_id, document_id, file_name, file_size, summary, risk_score, risk_level, clauses_reviewed, document_blocks, created_at)
     VALUES ('an_employment_v3', $1, 'd1', 'Employment_Agreement_v3.docx', '48 KB', $2, 62, 'Elevated', 14, $3, $4)`,
    [
      DEMO_USER_ID,
      "This UK employment contract is largely standard, but three clauses create material legal exposure. The termination notice sits below the statutory floor, and the post-termination covenant is drafted too broadly to be reliably enforced. I've prepared tracked redlines for each finding.",
      JSON.stringify(documentBlocks),
      daysAgo(0),
    ],
  );
  const findings: [string, string, string, string][] = [
    ['f1', 'High', 'Termination notice below statutory minimum', 'Employment Rights Act 1996, s.86'],
    ['f2', 'Medium', 'Restraint of trade likely too broad to enforce', 'Tillman v Egon Zehnder [2019] UKSC 32'],
    ['f3', 'Medium', 'Holiday entitlement clause not compliant', 'Working Time Regulations 1998, reg.13'],
  ];
  for (let i = 0; i < findings.length; i++) {
    const [id, severity, title, citation] = findings[i];
    await db.query(
      'INSERT INTO findings (analysis_id, id, ord, severity, title, citation) VALUES ($1, $2, $3, $4, $5, $6)',
      ['an_employment_v3', id, i, severity, title, citation],
    );
  }
  const redlines: [string, string, string, string][] = [
    ['r1', "one (1) week's", "one (1) month's", 'High'],
    ['r2', 'twelve (12) months', 'six (6) months', 'Medium'],
    ['r3', 'the statutory minimum', "28 days' paid annual leave (inclusive of public holidays), accruing pro rata", 'Medium'],
  ];
  for (let i = 0; i < redlines.length; i++) {
    const [id, delText, insText, severity] = redlines[i];
    await db.query(
      `INSERT INTO redlines (analysis_id, id, ord, del_text, ins_text, severity, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'pending')`,
      ['an_employment_v3', id, i, delText, insText, severity],
    );
  }

  // Chat history for c1: the uploaded file + the finished analysis.
  await db.query(
    `INSERT INTO chat_messages (id, session_id, role, kind, file_name, file_size, created_at)
     VALUES ($1, 'c1', 'user', 'file', 'Employment_Agreement_v3.docx', '48 KB', $2)`,
    [newId('m'), hoursAgo(3)],
  );
  await db.query(
    `INSERT INTO chat_messages (id, session_id, role, kind, analysis_id, created_at)
     VALUES ($1, 'c1', 'assistant', 'analysis', 'an_employment_v3', $2)`,
    [newId('m'), hoursAgo(3)],
  );

  // ── Templates ───────────────────────────────────────────────────────────────
  const templates: [string, string, string, string, string, number][] = [
    ['t1', 'Mutual NDA', 'Confidentiality', 'Two-way non-disclosure for early commercial talks.', 'UK', 11],
    ['t2', 'Employment Contract', 'Employment', 'Full-time permanent employee agreement, UK-compliant.', 'UK', 24],
    ['t3', 'Master Services Agreement', 'Commercial', 'Framework agreement for recurring professional services.', 'UK', 32],
    ['t4', 'Data Processing Addendum', 'Privacy', 'GDPR Article 28 processor terms.', 'EU', 18],
    ['t5', 'SAFE (Post-Money)', 'Fundraising', 'Simple agreement for future equity.', 'US', 9],
    ['t6', 'Consultancy Agreement', 'Commercial', 'Independent contractor engagement terms.', 'UK', 16],
  ];
  for (const [id, name, category, description, jurisdiction, clauses] of templates) {
    await db.query(
      'INSERT INTO templates (id, name, category, description, jurisdiction, clauses) VALUES ($1, $2, $3, $4, $5, $6)',
      [id, name, category, description, jurisdiction, clauses],
    );
  }

  // ── Signature requests ──────────────────────────────────────────────────────
  await db.query(
    `INSERT INTO signature_requests (id, user_id, document_name, status, sent_at, created_at)
     VALUES ('s1', $1, 'Mutual_NDA.docx', 'Completed', $2, $2)`,
    [DEMO_USER_ID, daysAgo(3)],
  );
  await db.query(
    `INSERT INTO signature_recipients (request_id, ord, name, email, signed) VALUES
     ('s1', 0, 'A. Rahman', 'a.rahman@freshfields.com', true),
     ('s1', 1, 'J. Okoro', 'j.okoro@northwind.com', true)`,
  );
  await db.query(
    `INSERT INTO signature_requests (id, user_id, document_name, status, sent_at, created_at)
     VALUES ('s2', $1, 'MSA_Acme_Corp.docx', 'Sent', $2, $2)`,
    [DEMO_USER_ID, daysAgo(1)],
  );
  await db.query(
    `INSERT INTO signature_recipients (request_id, ord, name, email, signed) VALUES
     ('s2', 0, 'A. Rahman', 'a.rahman@freshfields.com', true),
     ('s2', 1, 'P. Nasser', 'p.nasser@acme.com', false)`,
  );

  // ── Notifications ───────────────────────────────────────────────────────────
  await db.query(
    `INSERT INTO notifications (id, user_id, icon, title, read, created_at) VALUES
     ('n1', $1, 'esign', 'NDA — mutual: документ подписан', false, $2),
     ('n2', $1, 'check', 'Анализ Employment_Agreement_v3 готов', false, $3),
     ('n3', $1, 'alert', 'Supplier_Terms_2026: найден высокий риск', true, $4)`,
    [DEMO_USER_ID, hoursAgo(2), hoursAgo(5), hoursAgo(26)],
  );

  // ── Team ────────────────────────────────────────────────────────────────────
  const members: [string, string, string, string, string][] = [
    ['A. Rahman', 'a.rahman@freshfields.com', 'owner', 'active', 'var(--accent)'],
    ['J. Okoro', 'j.okoro@freshfields.com', 'admin', 'active', 'var(--sev-low)'],
    ['P. Nasser', 'p.nasser@freshfields.com', 'editor', 'active', 'var(--sev-med)'],
    ['M. Chen', 'm.chen@freshfields.com', 'viewer', 'invited', 'var(--mut)'],
  ];
  for (let i = 0; i < members.length; i++) {
    const [name, email, role, status, color] = members[i];
    await db.query(
      `INSERT INTO team_members (id, owner_user_id, name, email, role, status, color, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [`tm${i + 1}`, DEMO_USER_ID, name, email, role, status, color, daysAgo(30 - i)],
    );
  }

  // ── Analytics: 148 reviews (weekly 18/24/21/30/26/29, W1 oldest), avg 41 ────
  const weekly = [18, 24, 21, 30, 26, 29]; // W1..W6
  let eventNo = 0;
  for (let week = 0; week < weekly.length; week++) {
    const ageBaseDays = (weekly.length - 1 - week) * 7; // W6 → 0, W1 → 35
    for (let j = 0; j < weekly[week]; j++) {
      const age = ageBaseDays + 0.5 + (j % 12) * 0.5; // stay well inside the bucket
      await db.query(
        'INSERT INTO review_events (id, user_id, risk_score, created_at) VALUES ($1, $2, 41, $3)',
        [`re_seed_${++eventNo}`, DEMO_USER_ID, daysAgo(age)],
      );
    }
  }
  await db.query(
    `INSERT INTO user_stats (user_id, findings_high, findings_medium, findings_low, hours_saved_minutes)
     VALUES ($1, 27, 63, 112, ${216 * 60})`,
    [DEMO_USER_ID],
  );
}
