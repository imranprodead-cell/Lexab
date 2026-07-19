/**
 * Cloud-storage integrations (available on every plan): Google Drive,
 * Microsoft 365 (OneDrive via Graph), Dropbox.
 *
 *   GET    /integrations                     — connection status per provider
 *   GET    /integrations/:provider/connect   — OAuth consent URL to open
 *   GET    /integrations/:provider/callback  — PUBLIC: OAuth redirect target
 *   DELETE /integrations/:provider           — disconnect
 *   GET    /integrations/:provider/files?search= — recent/matching documents
 *   POST   /integrations/:provider/import { fileId, name } — pull the file in
 *                                              (same pipeline as POST /uploads)
 *
 * Providers are configured with env keys; an unconfigured provider answers 501
 * with a clear message instead of a broken OAuth redirect.
 */
import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { config } from '../config.ts';
import type { Db } from '../db.ts';
import { ALLOWED_EXTENSIONS, assertValidFileContent, extractText, fileExtension, MAX_UPLOAD_BYTES } from '../extract.ts';
import { filenameFromDisposition, parseDriveLink } from '../lib/driveLink.ts';
import { badRequest, HttpError, notFound } from '../lib/errors.ts';
import { audit } from '../lib/audit.ts';
import { encText } from '../lib/docCrypto.ts';
import { formatSize } from '../lib/format.ts';
import { newId } from '../lib/ids.ts';
import { assertStorageAllowance, withStorageReservation } from '../lib/limits.ts';
import { asObject, requireString } from '../lib/validate.ts';
import { deleteFile, saveFile } from '../storage.ts';

type Provider = 'google-drive' | 'microsoft' | 'dropbox';
const PROVIDERS: Provider[] = ['google-drive', 'microsoft', 'dropbox'];

const GDOC_MIME = 'application/vnd.google-apps.document';
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

interface ProviderConfig {
  label: string;
  clientId: string;
  clientSecret: string;
  authUrl: (redirectUri: string, state: string) => string;
  tokenUrl: string;
}

function providerConfig(provider: Provider): ProviderConfig {
  switch (provider) {
    case 'google-drive':
      return {
        label: 'Google Drive',
        clientId: config.googleDriveClientId,
        clientSecret: config.googleDriveClientSecret,
        authUrl: (redirectUri, state) =>
          'https://accounts.google.com/o/oauth2/v2/auth?' +
          new URLSearchParams({
            client_id: config.googleDriveClientId,
            redirect_uri: redirectUri,
            response_type: 'code',
            // drive.file — the app only ever sees files the user explicitly
            // picks (Google Picker) or imports by link. Non-restricted scope:
            // free to publish, no paid CASA verification. Deliberate product
            // decision — do not widen to drive.readonly.
            scope: 'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/userinfo.email',
            access_type: 'offline',
            prompt: 'consent',
            state,
          }).toString(),
        tokenUrl: 'https://oauth2.googleapis.com/token',
      };
    case 'microsoft':
      return {
        label: 'Microsoft 365',
        clientId: config.msClientId,
        clientSecret: config.msClientSecret,
        authUrl: (redirectUri, state) =>
          'https://login.microsoftonline.com/common/oauth2/v2.0/authorize?' +
          new URLSearchParams({
            client_id: config.msClientId,
            redirect_uri: redirectUri,
            response_type: 'code',
            scope: 'Files.Read User.Read offline_access',
            state,
          }).toString(),
        tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
      };
    case 'dropbox':
      return {
        label: 'Dropbox',
        clientId: config.dropboxAppKey,
        clientSecret: config.dropboxAppSecret,
        authUrl: (redirectUri, state) =>
          'https://www.dropbox.com/oauth2/authorize?' +
          new URLSearchParams({
            client_id: config.dropboxAppKey,
            redirect_uri: redirectUri,
            response_type: 'code',
            token_access_type: 'offline',
            state,
          }).toString(),
        tokenUrl: 'https://api.dropboxapi.com/oauth2/token',
      };
  }
}

function parseProvider(raw: string): Provider {
  if ((PROVIDERS as string[]).includes(raw)) return raw as Provider;
  throw badRequest(`Unknown provider. Allowed: ${PROVIDERS.join(', ')}`);
}

function assertConfigured(provider: Provider): ProviderConfig {
  const cfg = providerConfig(provider);
  if (!cfg.clientId || !cfg.clientSecret) {
    throw new HttpError(
      501,
      `Интеграция ${cfg.label} ещё не настроена — нужны ключи приложения (см. server/.env) / ${cfg.label} integration is not configured yet`,
    );
  }
  return cfg;
}

interface IntegrationRow {
  id: string;
  provider: Provider;
  access_token: string;
  refresh_token: string | null;
  expires_at: Date | string | null;
  account_email: string | null;
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
}

async function exchangeToken(cfg: ProviderConfig, params: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(cfg.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString(),
  });
  if (!res.ok) {
    throw new HttpError(502, `Не удалось получить доступ у провайдера (${res.status}) / Provider token exchange failed`);
  }
  return (await res.json()) as TokenResponse;
}

/** Fresh access token: refresh transparently when the stored one expired. */
async function ensureAccessToken(db: Db, userId: string, provider: Provider): Promise<IntegrationRow> {
  const res = await db.query<IntegrationRow>(
    'SELECT id, provider, access_token, refresh_token, expires_at, account_email FROM integrations WHERE user_id = $1 AND provider = $2',
    [userId, provider],
  );
  const row = res.rows[0];
  if (!row) throw new HttpError(400, 'Сначала подключите интеграцию в Настройках / Connect the integration in Settings first');

  const expiresAt = row.expires_at ? new Date(row.expires_at as string).getTime() : null;
  if (!expiresAt || expiresAt - Date.now() > 60_000) return row;
  if (!row.refresh_token) return row; // no refresh token — try the stored one

  const cfg = assertConfigured(provider);
  const refreshed = await exchangeToken(cfg, {
    grant_type: 'refresh_token',
    refresh_token: row.refresh_token,
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    ...(provider === 'microsoft' ? { scope: 'Files.Read User.Read offline_access' } : {}),
  });
  const newExpiry = refreshed.expires_in ? new Date(Date.now() + refreshed.expires_in * 1000) : null;
  await db.query(
    'UPDATE integrations SET access_token = $3, refresh_token = coalesce($4, refresh_token), expires_at = $5 WHERE user_id = $1 AND provider = $2',
    [userId, provider, refreshed.access_token, refreshed.refresh_token ?? null, newExpiry],
  );
  return { ...row, access_token: refreshed.access_token };
}

async function accountEmail(provider: Provider, accessToken: string): Promise<string | null> {
  try {
    if (provider === 'google-drive') {
      const res = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) return null;
      return ((await res.json()) as { email?: string }).email ?? null;
    }
    if (provider === 'microsoft') {
      const res = await fetch('https://graph.microsoft.com/v1.0/me', {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) return null;
      const me = (await res.json()) as { mail?: string; userPrincipalName?: string };
      return me.mail ?? me.userPrincipalName ?? null;
    }
    const res = await fetch('https://api.dropboxapi.com/2/users/get_current_account', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return null;
    return ((await res.json()) as { email?: string }).email ?? null;
  } catch {
    return null;
  }
}

export interface CloudFile {
  id: string;
  name: string;
  size: number | null;
  modifiedAt: string | null;
}

const IMPORTABLE = /\.(pdf|docx?|txt|md)$/i;

async function listFiles(provider: Provider, accessToken: string, search: string): Promise<CloudFile[]> {
  if (provider === 'google-drive') {
    const mimes = ['application/pdf', DOCX_MIME, 'text/plain', GDOC_MIME].map((m) => `mimeType='${m}'`).join(' or ');
    let q = `trashed=false and (${mimes})`;
    if (search) q += ` and name contains '${search.replace(/\\/g, '').replace(/'/g, "\\'")}'`;
    const res = await fetch(
      'https://www.googleapis.com/drive/v3/files?' +
        new URLSearchParams({
          q,
          fields: 'files(id,name,size,modifiedTime,mimeType)',
          pageSize: '30',
          orderBy: 'modifiedTime desc',
        }).toString(),
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!res.ok) throw new HttpError(502, `Google Drive не ответил (${res.status})`);
    const data = (await res.json()) as { files?: { id: string; name: string; size?: string; modifiedTime?: string; mimeType?: string }[] };
    // Drive files may have no extension in their display name — add one from
    // the mime type so the import (which validates by extension) accepts them.
    const EXT_BY_MIME: Record<string, string> = { [GDOC_MIME]: '.docx', [DOCX_MIME]: '.docx', 'application/pdf': '.pdf', 'text/plain': '.txt' };
    return (data.files ?? []).map((f) => {
      const ext = EXT_BY_MIME[f.mimeType ?? ''];
      const name = ext && !IMPORTABLE.test(f.name) ? `${f.name}${ext}` : f.name;
      return {
        id: f.id,
        name,
        size: f.size ? Number(f.size) : null,
        modifiedAt: f.modifiedTime ?? null,
      };
    });
  }

  if (provider === 'microsoft') {
    const url = search
      ? `https://graph.microsoft.com/v1.0/me/drive/root/search(q='${encodeURIComponent(search.replace(/'/g, ''))}')?$top=30`
      : 'https://graph.microsoft.com/v1.0/me/drive/root/children?$top=50&$orderby=lastModifiedDateTime desc';
    const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!res.ok) throw new HttpError(502, `Microsoft 365 не ответил (${res.status})`);
    const data = (await res.json()) as {
      value?: { id: string; name: string; size?: number; lastModifiedDateTime?: string; file?: unknown }[];
    };
    return (data.value ?? [])
      .filter((f) => f.file && IMPORTABLE.test(f.name))
      .slice(0, 30)
      .map((f) => ({ id: f.id, name: f.name, size: f.size ?? null, modifiedAt: f.lastModifiedDateTime ?? null }));
  }

  // Dropbox
  let entries: Record<string, unknown>[] = [];
  if (search) {
    const res = await fetch('https://api.dropboxapi.com/2/files/search_v2', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: search, options: { max_results: 30, file_status: 'active', filename_only: true } }),
    });
    if (!res.ok) throw new HttpError(502, `Dropbox не ответил (${res.status})`);
    const data = (await res.json()) as { matches?: { metadata?: { metadata?: Record<string, unknown> } }[] };
    entries = (data.matches ?? []).map((m) => m.metadata?.metadata ?? {});
  } else {
    // Recursive listing counts folders too — follow the cursor until we have
    // enough importable files (bounded, so huge accounts stay fast).
    let cursor: string | null = null;
    let hasMore = true;
    const importable = () => entries.filter((e) => e['.tag'] === 'file' && IMPORTABLE.test(String(e.name ?? ''))).length;
    for (let pageN = 0; pageN < 10 && hasMore && importable() < 30; pageN++) {
      const res: Response = cursor
        ? await fetch('https://api.dropboxapi.com/2/files/list_folder/continue', {
            method: 'POST',
            headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ cursor }),
          })
        : await fetch('https://api.dropboxapi.com/2/files/list_folder', {
            method: 'POST',
            headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: '', recursive: true, limit: 500 }),
          });
      if (!res.ok) throw new HttpError(502, `Dropbox не ответил (${res.status})`);
      const data = (await res.json()) as { entries?: unknown[]; cursor?: string; has_more?: boolean };
      entries.push(...((data.entries ?? []) as Record<string, unknown>[]));
      cursor = data.cursor ?? null;
      hasMore = Boolean(data.has_more) && cursor !== null;
    }
    // Freshest first, like the other providers.
    entries.sort((a, b) => String(b.server_modified ?? '').localeCompare(String(a.server_modified ?? '')));
  }
  return entries
    .filter((e) => e['.tag'] === 'file' && typeof e.name === 'string' && IMPORTABLE.test(e.name as string))
    .slice(0, 30)
    .map((e) => ({
      id: (e.id ?? e.path_lower) as string,
      name: e.name as string,
      size: typeof e.size === 'number' ? e.size : null,
      modifiedAt: typeof e.server_modified === 'string' ? e.server_modified : null,
    }));
}

/**
 * Read an HTTP response body into a Buffer WITHOUT ever buffering more than
 * `max` bytes: rejects up front on an oversized Content-Length, and streams the
 * body while counting, aborting the moment the running total crosses the cap.
 * Prevents a provider-hosted multi-GB file from OOM-ing the process (the old
 * `res.arrayBuffer()` buffered the whole body before any size check).
 */
async function readBodyCapped(res: Response, max: number): Promise<Buffer> {
  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > max) {
    throw badRequest('Файл больше 10 МБ — уменьшите его или загрузите вручную');
  }
  if (!res.body) return Buffer.alloc(0);
  const reader = res.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => {});
      throw badRequest('Файл больше 10 МБ — уменьшите его или загрузите вручную');
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

async function downloadFile(provider: Provider, accessToken: string, fileId: string): Promise<Buffer> {
  let res: Response;
  if (provider === 'google-drive') {
    // Try binary content first; Google Docs need an export instead.
    res = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (res.status === 403 || res.status === 400) {
      res = await fetch(
        `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/export?mimeType=${encodeURIComponent(DOCX_MIME)}`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
    }
  } else if (provider === 'microsoft') {
    res = await fetch(`https://graph.microsoft.com/v1.0/me/drive/items/${encodeURIComponent(fileId)}/content`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  } else {
    res = await fetch('https://content.dropboxapi.com/2/files/download', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Dropbox-API-Arg': JSON.stringify({ path: fileId }),
      },
    });
  }
  if (!res.ok) throw new HttpError(502, `Не удалось скачать файл у провайдера (${res.status}) / Cloud download failed`);
  return readBodyCapped(res, MAX_UPLOAD_BYTES);
}

export function integrationRoutes(app: FastifyInstance, db: Db): void {
  // Connection status for the Settings cards (any plan may look).
  app.get('/integrations', { preHandler: [app.authenticate] }, async (req) => {
    const res = await db.query<{ provider: Provider; account_email: string | null }>(
      'SELECT provider, account_email FROM integrations WHERE user_id = $1',
      [req.currentUser.id],
    );
    const connected = new Map(res.rows.map((r) => [r.provider, r.account_email]));
    return PROVIDERS.map((p) => ({
      provider: p,
      label: providerConfig(p).label,
      configured: Boolean(providerConfig(p).clientId && providerConfig(p).clientSecret),
      connected: connected.has(p),
      accountEmail: connected.get(p) ?? null,
    }));
  });

  // OAuth consent URL (Business feature).
  app.get('/integrations/:provider/connect', { preHandler: [app.authenticateReal] }, async (req) => {
    const provider = parseProvider((req.params as { provider: string }).provider);
    const cfg = assertConfigured(provider);
    const redirectUri = `${config.apiBaseUrl}${config.apiPrefix}/integrations/${provider}/callback`;
    const state = app.jwt.sign({ uid: req.currentUser.id, provider, purpose: 'integration' }, { expiresIn: '15m' });
    return { url: cfg.authUrl(redirectUri, state) };
  });

  // PUBLIC: the provider redirects here after consent. The tokens are NOT
  // activated yet — they're parked as a one-time grant, and the logged-in
  // frontend claims it with its own auth. Activation happens only when the
  // claiming user matches the user who started the flow, so a consent link
  // planted on someone else's browser can never link their drive to the
  // attacker's account (OAuth CSRF) — and no cross-origin cookies needed.
  app.get('/integrations/:provider/callback', async (req, reply) => {
    const provider = parseProvider((req.params as { provider: string }).provider);
    const { code, state, error } = req.query as { code?: string; state?: string; error?: string };
    const fail = (reason: string) =>
      reply.redirect(`${config.appBaseUrl}/settings?integration=${provider}&status=error&reason=${encodeURIComponent(reason)}`);

    if (error || !code || !state) return fail(error ?? 'no_code');
    let uid: string;
    try {
      const payload = app.jwt.verify<{ uid: string; provider: string; purpose: string }>(state);
      if (payload.purpose !== 'integration' || payload.provider !== provider) return fail('bad_state');
      uid = payload.uid;
    } catch {
      return fail('bad_state');
    }

    try {
      const cfg = assertConfigured(provider);
      const redirectUri = `${config.apiBaseUrl}${config.apiPrefix}/integrations/${provider}/callback`;
      const token = await exchangeToken(cfg, {
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        client_id: cfg.clientId,
        client_secret: cfg.clientSecret,
      });
      const email = await accountEmail(provider, token.access_token);
      const expiresAt = token.expires_in ? new Date(Date.now() + token.expires_in * 1000) : null;
      const claimId = `ig_${crypto.randomBytes(24).toString('base64url')}`;
      await db.query(
        `INSERT INTO integration_grants (id, user_id, provider, access_token, refresh_token, expires_at, account_email)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [claimId, uid, provider, token.access_token, token.refresh_token ?? null, expiresAt, email],
      );
      return reply.redirect(`${config.appBaseUrl}/settings?integration=${provider}&status=claim&claim=${claimId}`);
    } catch (err) {
      req.log.warn(err, 'integration callback failed');
      return fail('exchange_failed');
    }
  });

  // Final step: the frontend (authenticated) turns the grant into a live
  // integration. Only the user who initiated the consent may claim it.
  app.post('/integrations/claim', { preHandler: [app.authenticateReal] }, async (req, reply) => {
    const body = asObject(req.body);
    const claimId = requireString(body, 'claimId', { min: 8, max: 100 });
    // Stale grants die quietly (10-minute window).
    await db.query(`DELETE FROM integration_grants WHERE created_at < now() - interval '10 minutes'`);
    const res = await db.query<{
      user_id: string;
      provider: Provider;
      access_token: string;
      refresh_token: string | null;
      expires_at: Date | string | null;
      account_email: string | null;
    }>('DELETE FROM integration_grants WHERE id = $1 RETURNING user_id, provider, access_token, refresh_token, expires_at, account_email', [claimId]);
    const grant = res.rows[0];
    if (!grant) throw notFound('Подключение устарело — попробуйте ещё раз / The connection attempt expired — try again');
    if (grant.user_id !== req.currentUser.id) {
      throw new HttpError(403, 'Это подключение начал другой пользователь / This connection was started by another user');
    }
    await db.query(
      `INSERT INTO integrations (id, user_id, provider, access_token, refresh_token, expires_at, account_email)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (user_id, provider)
       DO UPDATE SET access_token = $4, refresh_token = coalesce($5, integrations.refresh_token),
                     expires_at = $6, account_email = coalesce($7, integrations.account_email)`,
      [newId('int'), grant.user_id, grant.provider, grant.access_token, grant.refresh_token, grant.expires_at, grant.account_email],
    );
    reply.code(204);
  });

  app.delete('/integrations/:provider', { preHandler: [app.authenticate] }, async (req, reply) => {
    const provider = parseProvider((req.params as { provider: string }).provider);
    const res = await db.query('DELETE FROM integrations WHERE user_id = $1 AND provider = $2 RETURNING id', [
      req.currentUser.id,
      provider,
    ]);
    if (!res.rows[0]) throw notFound('Интеграция не подключена');
    reply.code(204);
  });

  // Google Picker bootstrap: a fresh drive.file access token for the browser
  // (the picker runs client-side; picked files become readable by the app).
  app.get('/integrations/google-drive/picker-token', { preHandler: [app.authenticateReal] }, async (req) => {
    const row = await ensureAccessToken(db, req.currentUser.id, 'google-drive');
    return {
      accessToken: row.access_token,
      // The numeric project number prefixes the OAuth client id.
      appId: config.googleDriveClientId.split('-')[0] ?? '',
      apiKey: config.googleApiKey,
    };
  });

  // Browse cloud documents (search by name).
  app.get('/integrations/:provider/files', { preHandler: [app.authenticateReal] }, async (req) => {
    const provider = parseProvider((req.params as { provider: string }).provider);
    const { search = '' } = req.query as { search?: string };
    const row = await ensureAccessToken(db, req.currentUser.id, provider);
    return listFiles(provider, row.access_token, search.trim().slice(0, 100));
  });

  // Import a cloud file — lands in uploads exactly like POST /uploads, so the
  // chat can analyse it right away (analysis finds the upload by file name).
  app.post(
    '/integrations/:provider/import',
    { preHandler: [app.authenticateReal], config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const provider = parseProvider((req.params as { provider: string }).provider);
        const body = asObject(req.body);
      const fileId = requireString(body, 'fileId', { min: 1, max: 500 });
      const name = requireString(body, 'name', { min: 1, max: 300 });

      const ext = fileExtension(name);
      if (!ALLOWED_EXTENSIONS.includes(ext)) {
        throw badRequest(`Неподдерживаемый тип файла. Можно: ${ALLOWED_EXTENSIONS.join(', ')}`);
      }

      const row = await ensureAccessToken(db, req.currentUser.id, provider);
      const buffer = await downloadFile(provider, row.access_token, fileId);
      // The declared name/extension isn't trustworthy — verify the bytes match,
      // same as /uploads and the link-import path (defence in depth).
      assertValidFileContent(buffer, name);
      await assertStorageAllowance(db, req.currentUser.id, buffer.length);

      const mime = ext === '.pdf' ? 'application/pdf' : ext === '.docx' ? DOCX_MIME : 'text/plain';
      const stored = await saveFile(buffer, name, mime);
      const text = await extractText(buffer, name);
      // Encrypted at rest with the owner's data key (lazy migration tolerant).
      const storedText = text === null ? null : await encText(db, req.currentUser.id, text);
      const id = newId('up');
      await withStorageReservation(
        db,
        req.currentUser.id,
        buffer.length,
        (tx) =>
          tx
            .query(
              `INSERT INTO uploads (id, user_id, file_name, size_bytes, mime, storage, storage_key, url, extracted_text)
               VALUES ($1, $2, $3, $4, $5, $6, $7, NULL, $8)`,
              [id, req.currentUser.id, name, buffer.length, mime, stored.storage, stored.key, storedText],
            )
            .then(() => undefined),
        () => deleteFile(stored.storage, stored.key),
      );

      await audit(db, req, {
        type: 'file.uploaded',
        target: { type: 'document', id, label: name },
        metadata: { sizeBytes: buffer.length, source: 'cloud-import' },
      });
      reply.code(201);
      return { id, fileName: name, fileSize: formatSize(buffer.length) };
    },
  );

  // Cookie-free Google Drive fallback: import by a pasted share link. Keeps
  // the drive.file philosophy (only files the user explicitly chose): first a
  // token attempt (previously picked files), then the public
  // "anyone with the link" download. No Google verification required.
  app.post(
    '/integrations/google-drive/import-link',
    { preHandler: [app.authenticateReal], config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const body = asObject(req.body);
      const link = parseDriveLink(requireString(body, 'url', { min: 10, max: 2000 }));
      if (!link) {
        throw badRequest('Не похоже на ссылку Google Drive / Google Docs. / Not a Google Drive / Docs link.');
      }

      let buffer: Buffer | null = null;
      let name: string | null = null;

      // 1) Authenticated attempt — works for files already picked/imported.
      try {
        const row = await ensureAccessToken(db, req.currentUser.id, 'google-drive');
        const headers = { Authorization: `Bearer ${row.access_token}` };
        if (link.kind === 'doc') {
          const r = await fetch(
            `https://www.googleapis.com/drive/v3/files/${link.id}/export?mimeType=${encodeURIComponent(DOCX_MIME)}`,
            { headers },
          );
          if (r.ok) buffer = await readBodyCapped(r, MAX_UPLOAD_BYTES);
        } else {
          const meta = await fetch(`https://www.googleapis.com/drive/v3/files/${link.id}?fields=name`, { headers });
          if (meta.ok) name = ((await meta.json()) as { name?: string }).name ?? null;
          const r = await fetch(`https://www.googleapis.com/drive/v3/files/${link.id}?alt=media`, { headers });
          if (r.ok) buffer = await readBodyCapped(r, MAX_UPLOAD_BYTES);
        }
      } catch {
        /* Drive not connected — the public path below still works. */
      }

      // 2) Public "anyone with the link" download.
      if (!buffer || buffer.length === 0) {
        const publicUrl =
          link.kind === 'doc'
            ? `https://docs.google.com/document/d/${link.id}/export?format=docx`
            : `https://drive.google.com/uc?export=download&id=${link.id}`;
        const r = await fetch(publicUrl, { redirect: 'follow' });
        const type = r.headers.get('content-type') ?? '';
        // An HTML body is Google's sign-in / error page, not the file.
        if (r.ok && !type.includes('text/html')) {
          buffer = await readBodyCapped(r, MAX_UPLOAD_BYTES);
          name ??= filenameFromDisposition(r.headers.get('content-disposition'));
        }
      }

      if (!buffer || buffer.length === 0) {
        throw badRequest(
          'Файл недоступен. Откройте в Google Drive доступ «Все, у кого есть ссылка» и попробуйте снова. / ' +
            'File not accessible — set link sharing to “Anyone with the link” and retry.',
        );
      }
      if (buffer.length > MAX_UPLOAD_BYTES) throw badRequest('Файл больше 10 МБ. / File is over 10 MB.');

      name ??= link.kind === 'doc' ? `google-doc-${link.id.slice(0, 8)}.docx` : `drive-${link.id.slice(0, 8)}.pdf`;
      if (link.kind === 'doc' && !/\.docx$/i.test(name)) name += '.docx';
      const ext = fileExtension(name);
      if (!ALLOWED_EXTENSIONS.includes(ext)) {
        throw badRequest(`Неподдерживаемый тип файла. Можно: ${ALLOWED_EXTENSIONS.join(', ')}`);
      }
      // Magic-byte check — also rejects any interstitial page that slipped through.
      assertValidFileContent(buffer, name);
      await assertStorageAllowance(db, req.currentUser.id, buffer.length);

      const mime = ext === '.pdf' ? 'application/pdf' : ext === '.docx' ? DOCX_MIME : 'text/plain';
      const stored = await saveFile(buffer, name, mime);
      const text = await extractText(buffer, name);
      // Encrypted at rest with the owner's data key (lazy migration tolerant).
      const storedText = text === null ? null : await encText(db, req.currentUser.id, text);
      const id = newId('up');
      await withStorageReservation(
        db,
        req.currentUser.id,
        buffer.length,
        (tx) =>
          tx
            .query(
              `INSERT INTO uploads (id, user_id, file_name, size_bytes, mime, storage, storage_key, url, extracted_text)
               VALUES ($1, $2, $3, $4, $5, $6, $7, NULL, $8)`,
              [id, req.currentUser.id, name, buffer.length, mime, stored.storage, stored.key, storedText],
            )
            .then(() => undefined),
        () => deleteFile(stored.storage, stored.key),
      );

      await audit(db, req, {
        type: 'file.uploaded',
        target: { type: 'document', id, label: name },
        metadata: { sizeBytes: buffer.length, source: 'cloud-import' },
      });
      reply.code(201);
      return { id, fileName: name, fileSize: formatSize(buffer.length) };
    },
  );
}
