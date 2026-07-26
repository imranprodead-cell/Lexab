/**
 * Живая проверка «быстрых побед» против реальной базы (временный сценарий):
 *   1) checkContractDeadlines — договор истекает через 20 дней → уведомление
 *      владельцу + флаг expiry_reminded (фича уже была в коде — проверяем).
 *   2) checkSignatureReminders — подписант молчит 4 дня → reminded + заметка.
 *   3) sendWeeklyDigests(force) — письмо-сводка собралась, digest_sent_at.
 *   4) выключатель weekly_digest реально останавливает сводку.
 * Временный пользователь создаётся и подчистую удаляется здесь же (CASCADE).
 *
 *   RESEND_API_KEY= node --env-file=.env scripts/verify-quickwins.ts
 * (пустой ключ Resend — sendMail честно no-op'ится, проверяем эффекты в БД.)
 */
import { getDb, migrate } from '../src/db.ts';
import { checkContractDeadlines } from '../src/routes/contracts.routes.ts';
import { checkSignatureReminders } from '../src/routes/signatures.routes.ts';
import { sendWeeklyDigests } from '../src/lib/weeklyDigest.ts';

const UID = 'u_qwtest_' + Date.now().toString(36);
const EMAIL = `quickwins-${Date.now()}@lexab-test.dev`;

let failures = 0;
function check(label: string, ok: boolean, extra = ''): void {
  console.log(`${ok ? 'OK ' : 'FAIL'}  ${label}${extra ? ` — ${extra}` : ''}`);
  if (!ok) failures += 1;
}

async function main(): Promise<void> {
  const db = await getDb();
  await migrate(db);
  try {
    // ── Сцена: Pro-пользователь, договор с истечением, зависшая подпись ──
    await db.query(
      `INSERT INTO users (id, email, password_hash, name, initials, firm, jurisdiction, email_verified)
       VALUES ($1, $2, 'x', 'QuickWins Test', 'QT', 'Lexab', 'United Kingdom', true)`,
      [UID, EMAIL],
    );
    await db.query(`INSERT INTO subscriptions (user_id, plan, status) VALUES ($1, 'Pro', 'active')`, [UID]);
    await db.query(`INSERT INTO user_stats (user_id) VALUES ($1)`, [UID]);
    await db.query(
      `INSERT INTO documents (id, user_id, name, counterparty, status, risk, jurisdiction, size_bytes)
       VALUES ('doc_qwtest', $1, 'Test MSA.pdf', 'ACME', 'Reviewed', 'Low', 'UK', 100)`,
      [UID],
    );
    await db.query(
      `INSERT INTO contract_terms (document_id, expiry_date, auto_renew, renewal_notice_days)
       VALUES ('doc_qwtest', CURRENT_DATE + 20, false, NULL)`,
    );
    await db.query(
      `INSERT INTO signature_requests (id, user_id, document_name, status, sent_at)
       VALUES ('sig_qwtest', $1, 'Test MSA.pdf', 'Sent', now() - interval '4 days')`,
      [UID],
    );
    await db.query(
      `INSERT INTO signature_recipients (request_id, ord, name, email, signed, token)
       VALUES ('sig_qwtest', 0, 'Slow Signer', 'signer@lexab-test.dev', false, 'tok_qwtest')`,
    );

    // ── 1) Напоминание об истечении договора ──
    await checkContractDeadlines(db);
    const reminded = await db.query<{ expiry_reminded: boolean }>(
      `SELECT expiry_reminded FROM contract_terms WHERE document_id = 'doc_qwtest'`,
    );
    check('CLM: expiry_reminded выставлен', reminded.rows[0]?.expiry_reminded === true);
    const notif1 = await db.query(
      `SELECT id FROM notifications WHERE user_id = $1 AND title LIKE '%истека%'`,
      [UID],
    );
    check('CLM: уведомление об истечении в колокольчике', notif1.rows.length >= 1);

    // ── 2) Напоминание подписанту ──
    await checkSignatureReminders(db);
    const sr = await db.query<{ reminded: boolean }>(
      `SELECT reminded FROM signature_recipients WHERE request_id = 'sig_qwtest' AND ord = 0`,
    );
    check('Подписи: reminded выставлен', sr.rows[0]?.reminded === true);
    const notif2 = await db.query(
      `SELECT id FROM notifications WHERE user_id = $1 AND title = 'Подпись задерживается'`,
      [UID],
    );
    check('Подписи: заметка владельцу', notif2.rows.length === 1);
    // Повторный прогон не дублирует (дедуп-флаг).
    await checkSignatureReminders(db);
    const notif2b = await db.query(
      `SELECT id FROM notifications WHERE user_id = $1 AND title = 'Подпись задерживается'`,
      [UID],
    );
    check('Подписи: повторный прогон без дублей', notif2b.rows.length === 1);

    // ── 3) Дайджест (force — день недели не важен) ──
    const sent = await sendWeeklyDigests(db, { force: true });
    check('Дайджест: собрался хотя бы для тест-пользователя', sent >= 1, `sent=${sent}`);
    const ds = await db.query<{ digest_sent_at: string | null }>(
      `SELECT digest_sent_at FROM users WHERE id = $1`,
      [UID],
    );
    check('Дайджест: digest_sent_at проставлен', Boolean(ds.rows[0]?.digest_sent_at));
    // Дедуп: второй прогон в ту же неделю никого не берёт.
    const sent2 = await sendWeeklyDigests(db, { force: true });
    check('Дайджест: дедуп по digest_sent_at', sent2 === 0, `повторный sent=${sent2}`);

    // ── 4) Выключатель ──
    await db.query(`UPDATE users SET weekly_digest = false, digest_sent_at = NULL WHERE id = $1`, [UID]);
    const sent3 = await sendWeeklyDigests(db, { force: true });
    const stillNull = await db.query<{ digest_sent_at: string | null }>(
      `SELECT digest_sent_at FROM users WHERE id = $1`,
      [UID],
    );
    check('Дайджест: weekly_digest=false исключает пользователя', stillNull.rows[0]?.digest_sent_at === null, `sent=${sent3}`);
  } finally {
    await db.query('DELETE FROM users WHERE id = $1', [UID]);
    const gone = await db.query('SELECT 1 FROM users WHERE id = $1', [UID]);
    console.log(gone.rows.length === 0 ? 'CLEANUP OK — тест-пользователь удалён (CASCADE)' : 'CLEANUP FAILED!');
  }
  if (failures > 0) {
    console.error(`\n${failures} проверок провалено`);
    process.exit(1);
  }
  console.log('\nВСЕ ПРОВЕРКИ ПРОШЛИ');
  process.exit(0);
}

void main();
