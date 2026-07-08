/**
 * Supabase admin client (server-side only).
 *
 * Uses the SERVICE ROLE key — it bypasses Row Level Security, so it must
 * never leave the server (never expose it to the frontend or commit it).
 * Created lazily: the server runs fine without Supabase configured.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config } from './config.ts';

let admin: SupabaseClient | null = null;

/** True when SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set. */
export function isSupabaseConfigured(): boolean {
  return Boolean(config.supabaseUrl && config.supabaseServiceRoleKey);
}

/** Service-role client for trusted server-side operations (auth admin, storage, DB). */
export function getSupabaseAdmin(): SupabaseClient {
  if (!config.supabaseUrl || !config.supabaseServiceRoleKey) {
    throw new Error('Supabase is not configured: set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in server/.env');
  }
  if (!admin) {
    admin = createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
      auth: {
        // A server has no user session to persist or refresh.
        persistSession: false,
        autoRefreshToken: false,
      },
    });
  }
  return admin;
}
