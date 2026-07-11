/**
 * File storage. Priority:
 *   1. Supabase Storage — when SUPABASE_STORAGE_BUCKET is set (private bucket,
 *      7-day signed download URLs)
 *   2. S3 — when S3_BUCKET is set
 *   3. Local disk under DATA_DIR/uploads (served by GET {API_PREFIX}/files/:key)
 */
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.ts';
import { getSupabaseAdmin, isSupabaseConfigured } from './supabase.ts';

const SIGNED_URL_TTL = 7 * 24 * 3600;

export interface StoredFile {
  storage: 's3' | 'local' | 'supabase';
  key: string;
  url: string;
}

function sanitizeName(name: string): string {
  return path.basename(name).replace(/[^\w.-]+/g, '_').slice(0, 120) || 'file';
}

export async function saveFile(buffer: Buffer, fileName: string, mime?: string): Promise<StoredFile> {
  const key = `${crypto.randomBytes(12).toString('hex')}__${sanitizeName(fileName)}`;

  if (config.supabaseStorageBucket && isSupabaseConfigured()) {
    const supabase = getSupabaseAdmin();
    const objectKey = `uploads/${key}`;
    const { error } = await supabase.storage
      .from(config.supabaseStorageBucket)
      .upload(objectKey, buffer, { contentType: mime ?? 'application/octet-stream', upsert: false });
    if (error) throw new Error(`Supabase Storage upload failed: ${error.message}`);
    const { data, error: signError } = await supabase.storage
      .from(config.supabaseStorageBucket)
      .createSignedUrl(objectKey, SIGNED_URL_TTL);
    if (signError) throw new Error(`Supabase Storage sign failed: ${signError.message}`);
    return { storage: 'supabase', key: objectKey, url: data.signedUrl };
  }

  if (config.s3Bucket) {
    const { S3Client, PutObjectCommand, GetObjectCommand } = await import('@aws-sdk/client-s3');
    const client = new S3Client({
      region: config.s3Region,
      ...(config.s3Endpoint ? { endpoint: config.s3Endpoint, forcePathStyle: true } : {}),
    });
    const objectKey = `uploads/${key}`;
    await client.send(
      new PutObjectCommand({
        Bucket: config.s3Bucket,
        Key: objectKey,
        Body: buffer,
        ContentType: mime ?? 'application/octet-stream',
      }),
    );
    let url: string;
    if (config.s3PublicUrl) {
      url = `${config.s3PublicUrl.replace(/\/$/, '')}/${objectKey}`;
    } else {
      const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner');
      url = await getSignedUrl(client, new GetObjectCommand({ Bucket: config.s3Bucket, Key: objectKey }), {
        expiresIn: 7 * 24 * 3600,
      });
    }
    return { storage: 's3', key: objectKey, url };
  }

  const dir = path.join(config.dataDir, 'uploads');
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, key), buffer);
  return { storage: 'local', key, url: `${config.apiPrefix}/files/${key}` };
}

/** Read back a stored file's bytes (used when an analysis needs PDF content). */
export async function readFileBytes(storage: 's3' | 'local' | 'supabase', key: string): Promise<Buffer> {
  if (storage === 'supabase') {
    const { data, error } = await getSupabaseAdmin()
      .storage.from(config.supabaseStorageBucket)
      .download(key);
    if (error) throw new Error(`Supabase Storage download failed: ${error.message}`);
    return Buffer.from(await data.arrayBuffer());
  }
  if (storage === 's3') {
    const { S3Client, GetObjectCommand } = await import('@aws-sdk/client-s3');
    const client = new S3Client({
      region: config.s3Region,
      ...(config.s3Endpoint ? { endpoint: config.s3Endpoint, forcePathStyle: true } : {}),
    });
    const res = await client.send(new GetObjectCommand({ Bucket: config.s3Bucket, Key: key }));
    const bytes = await res.Body?.transformToByteArray();
    return Buffer.from(bytes ?? new Uint8Array());
  }
  // Keys are server-generated; sanitize anyway before touching the filesystem.
  const safe = path.basename(key);
  return fs.readFile(path.join(config.dataDir, 'uploads', safe));
}

/**
 * Delete a stored file. Idempotent: an already-missing object is not an
 * error, so callers can retry cleanup safely.
 */
export async function deleteFile(storage: 's3' | 'local' | 'supabase', key: string): Promise<void> {
  if (storage === 'supabase') {
    const { error } = await getSupabaseAdmin()
      .storage.from(config.supabaseStorageBucket)
      .remove([key]);
    if (error) throw new Error(`Supabase Storage delete failed: ${error.message}`);
    return;
  }
  if (storage === 's3') {
    const { S3Client, DeleteObjectCommand } = await import('@aws-sdk/client-s3');
    const client = new S3Client({
      region: config.s3Region,
      ...(config.s3Endpoint ? { endpoint: config.s3Endpoint, forcePathStyle: true } : {}),
    });
    await client.send(new DeleteObjectCommand({ Bucket: config.s3Bucket, Key: key }));
    return;
  }
  // Keys are server-generated; sanitize anyway before touching the filesystem.
  const safe = path.basename(key);
  try {
    await fs.unlink(path.join(config.dataDir, 'uploads', safe));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
}
