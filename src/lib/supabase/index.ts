/**
 * Supabase integration entry point.
 *
 *   import { getSupabase, isSupabaseConfigured } from '@/lib/supabase';
 *
 * - client.ts  — the singleton browser client (anon key, RLS applies)
 * - auth.ts    — sign-in / sign-out / session helpers
 * - storage.ts — file upload/download helpers (pass a bucket name)
 * - types.ts   — generated Database types (placeholder until tables exist)
 */
export { getSupabase, isSupabaseConfigured } from './client';
export * as supabaseAuth from './auth';
export * as supabaseStorage from './storage';
export type { Database } from './types';
