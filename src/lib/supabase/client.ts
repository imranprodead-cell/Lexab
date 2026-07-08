/**
 * Supabase browser client (singleton).
 *
 * Reads VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY from the environment —
 * the anon (publishable) key is safe to expose to the browser; everything
 * sensitive must stay behind Row Level Security policies.
 *
 * The client is created lazily so the app keeps working for developers who
 * haven't configured Supabase yet.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './types';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

let client: SupabaseClient<Database> | null = null;

/** True when both VITE_SUPABASE_* env vars are present. */
export function isSupabaseConfigured(): boolean {
  return Boolean(url && anonKey);
}

/** The shared Supabase client. Throws a clear error if env vars are missing. */
export function getSupabase(): SupabaseClient<Database> {
  if (!url || !anonKey) {
    throw new Error(
      'Supabase is not configured: set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env (see .env.example).',
    );
  }
  if (!client) {
    client = createClient<Database>(url, anonKey, {
      auth: {
        // Session persists in localStorage and refreshes automatically.
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    });
  }
  return client;
}
