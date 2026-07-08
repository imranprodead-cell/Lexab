/**
 * Supabase Auth helpers — thin wrappers ready for future wiring.
 * NOTE: the app currently authenticates against the LexAI backend
 * (server/, JWT). These helpers become useful if/when auth moves to Supabase.
 */
import type { Session, User } from '@supabase/supabase-js';
import { getSupabase } from './client';

export async function signUpWithEmail(email: string, password: string) {
  const { data, error } = await getSupabase().auth.signUp({ email, password });
  if (error) throw error;
  return data;
}

export async function signInWithEmail(email: string, password: string) {
  const { data, error } = await getSupabase().auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

/** OAuth sign-in (e.g. 'google'); redirects back to `redirectTo` after consent. */
export async function signInWithOAuth(provider: 'google' | 'github', redirectTo?: string) {
  const { data, error } = await getSupabase().auth.signInWithOAuth({
    provider,
    options: redirectTo ? { redirectTo } : undefined,
  });
  if (error) throw error;
  return data;
}

export async function signOut(): Promise<void> {
  const { error } = await getSupabase().auth.signOut();
  if (error) throw error;
}

export async function getSession(): Promise<Session | null> {
  const { data, error } = await getSupabase().auth.getSession();
  if (error) throw error;
  return data.session;
}

export async function getUser(): Promise<User | null> {
  const { data } = await getSupabase().auth.getUser();
  return data.user ?? null;
}

/** Subscribe to auth changes; returns an unsubscribe function. */
export function onAuthStateChange(callback: (session: Session | null) => void): () => void {
  const { data } = getSupabase().auth.onAuthStateChange((_event, session) => callback(session));
  return () => data.subscription.unsubscribe();
}
