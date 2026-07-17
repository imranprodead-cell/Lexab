/**
 * KEK rotation: re-wrap every per-user data key from the OLD master key to the
 * NEW one, so DATA_ENCRYPTION_KEY_PREVIOUS can eventually be retired for DB data.
 *
 * Runbook:
 *   1. Set DATA_ENCRYPTION_KEY = <new key>, DATA_ENCRYPTION_KEY_PREVIOUS = <old key>.
 *   2. node --env-file=.env scripts/rotate-kek.ts            # re-wrap all data_keys rows
 *      node --env-file=.env scripts/rotate-kek.ts --dry-run  # report only, no writes
 *   3. The bulk ciphertext (text columns) is untouched — only the ~100-byte
 *      wrapped DEK per user is rewritten, so this is fast.
 *
 * IMPORTANT — stored FILES are NOT rotated here. Each file object embeds its own
 * per-file DEK wrapped under the KEK that was current when it was saved, and it
 * can only be re-wrapped by rewriting the object. Therefore:
 *   • Keep DATA_ENCRYPTION_KEY_PREVIOUS set as long as any pre-rotation file
 *     exists (readFileBytes/decFileBuffer try current THEN previous KEK), OR
 *   • re-upload / re-run the affected documents so their files are re-saved
 *     under the new key. A bulk file-rewrite migration is a documented follow-up.
 * Do NOT unset DATA_ENCRYPTION_KEY_PREVIOUS until both DB keys are rewrapped
 * (this script) AND no legacy files remain.
 */
import { getDb } from '../src/db.ts';
import { config } from '../src/config.ts';
import { rewrapKey } from '../src/lib/docCrypto.ts';

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  if (config.dataEncryptionKey.length < 32) {
    console.error('[rotate] DATA_ENCRYPTION_KEY (the NEW key) is not set or too short — aborting.');
    process.exit(1);
  }
  const db = await getDb();
  const rows = (await db.query<{ user_id: string; key_wrapped: string }>('SELECT user_id, key_wrapped FROM data_keys')).rows;
  console.log(`[rotate] ${rows.length} data_keys rows${dryRun ? ' (dry-run)' : ''}`);

  let rewrapped = 0, alreadyCurrent = 0, failed = 0;
  for (const row of rows) {
    const next = rewrapKey(row.key_wrapped);
    if (next === null) {
      failed++;
      console.error(`[rotate] ✗ user ${row.user_id}: cannot unwrap with current or previous KEK — set DATA_ENCRYPTION_KEY_PREVIOUS to the old key`);
      continue;
    }
    if (next === row.key_wrapped) {
      // Same ciphertext is astronomically unlikely (random iv), so this branch
      // is effectively never hit; kept for completeness.
      alreadyCurrent++;
      continue;
    }
    if (!dryRun) {
      await db.query('UPDATE data_keys SET key_wrapped = $2 WHERE user_id = $1', [row.user_id, next]);
    }
    rewrapped++;
  }

  console.log(`[rotate] ${dryRun ? 'would re-wrap' : 're-wrapped'} ${rewrapped}, unchanged ${alreadyCurrent}, FAILED ${failed}`);
  if (failed > 0) {
    console.error('[rotate] Some keys could not be unwrapped — do NOT unset DATA_ENCRYPTION_KEY_PREVIOUS. Fix and re-run.');
  } else if (!dryRun) {
    console.log('[rotate] DB keys re-wrapped. Retire DATA_ENCRYPTION_KEY_PREVIOUS ONLY after all pre-rotation FILES are also re-saved (see header).');
  }
  await db.close();
  if (failed > 0) process.exitCode = 1;
}

void main();
