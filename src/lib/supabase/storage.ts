/**
 * Supabase Storage helpers — bucket-agnostic wrappers ready for future use.
 * No buckets are created here: pass the bucket name once you add one in the
 * Supabase dashboard (Storage → New bucket) or via a migration.
 */
import { getSupabase } from './client';

/** Upload a file; returns the storage path. Overwrites when `upsert` is true. */
export async function uploadFile(bucket: string, path: string, file: File | Blob, upsert = false): Promise<string> {
  const { data, error } = await getSupabase().storage.from(bucket).upload(path, file, { upsert });
  if (error) throw error;
  return data.path;
}

/** Public URL for a file in a PUBLIC bucket. */
export function getPublicUrl(bucket: string, path: string): string {
  return getSupabase().storage.from(bucket).getPublicUrl(path).data.publicUrl;
}

/** Time-limited URL for a file in a PRIVATE bucket (default: 1 hour). */
export async function getSignedUrl(bucket: string, path: string, expiresInSeconds = 3600): Promise<string> {
  const { data, error } = await getSupabase().storage.from(bucket).createSignedUrl(path, expiresInSeconds);
  if (error) throw error;
  return data.signedUrl;
}

export async function downloadFile(bucket: string, path: string): Promise<Blob> {
  const { data, error } = await getSupabase().storage.from(bucket).download(path);
  if (error) throw error;
  return data;
}

export async function removeFiles(bucket: string, paths: string[]): Promise<void> {
  const { error } = await getSupabase().storage.from(bucket).remove(paths);
  if (error) throw error;
}
