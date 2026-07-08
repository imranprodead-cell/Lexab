/**
 * Supabase connectivity check (`npm run check:supabase`).
 *
 * Verifies, without creating anything:
 *  1. Auth service reachable with the anon key
 *  2. Service-role key valid (Storage: list buckets)
 *  3. Database (PostgREST) reachable — "no tables yet" counts as success
 */
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const anonKey = process.env.SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !anonKey || !serviceKey) {
  console.error('✗ SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY are not all set in server/.env');
  process.exit(1);
}

let failed = false;
const ok = (msg: string) => console.log(`✓ ${msg}`);
const fail = (msg: string) => {
  console.error(`✗ ${msg}`);
  failed = true;
};

// 1. Auth service health (anon key).
try {
  const res = await fetch(`${url}/auth/v1/health`, { headers: { apikey: anonKey } });
  if (res.ok) ok(`Auth reachable with anon key (${((await res.json()) as { name?: string }).name ?? 'GoTrue'})`);
  else fail(`Auth health returned HTTP ${res.status} — check SUPABASE_URL / anon key`);
} catch (err) {
  fail(`Auth unreachable: ${(err as Error).message}`);
}

// 2. Service-role key: list storage buckets (allowed only for service role).
const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
{
  const { data, error } = await admin.storage.listBuckets();
  if (error) fail(`Storage/service key: ${error.message}`);
  else ok(`Service-role key valid — Storage reachable (buckets: ${data.length === 0 ? 'none yet' : data.map((b) => b.name).join(', ')})`);
}

// 3. Database via PostgREST: probe a table that does not exist — a structured
// "table not found" error still proves the DB layer is up and the key works.
{
  const { error } = await admin.from('_lexai_connectivity_probe').select('*').limit(1);
  if (!error) ok('Database reachable (probe table unexpectedly exists)');
  else if (error.code === 'PGRST205' || error.code === '42P01') {
    ok('Database (PostgREST) reachable — no tables yet, as expected');
  } else {
    fail(`Database: ${error.message} (code ${error.code ?? 'n/a'})`);
  }
}

if (failed) {
  console.error('\nSupabase check FAILED — see errors above.');
  process.exit(1);
}
console.log('\nSupabase is connected and ready.');
