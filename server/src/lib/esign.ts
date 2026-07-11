/**
 * Dropbox Sign (HelloSign) e-signature provider — real, legally-weighted
 * signatures with an audit trail and a signed PDF, via their v3 REST API.
 *
 * Enabled only when DROPBOX_SIGN_API_KEY is set; otherwise the caller falls
 * back to the in-app typed-name simulation. TEST mode uses the free sandbox
 * (signatures are NOT legally binding there — flip DROPBOX_SIGN_TEST_MODE=0
 * with a paid plan for production).
 */
import crypto from 'node:crypto';
import { config } from '../config.ts';

const API_BASE = 'https://api.hellosign.com/v3';

export function dropboxSignEnabled(): boolean {
  return Boolean(config.dropboxSignApiKey);
}

/** HTTP Basic auth: API key as the username, empty password. */
function authHeader(): string {
  return `Basic ${Buffer.from(`${config.dropboxSignApiKey}:`).toString('base64')}`;
}

export interface EsignSigner {
  name: string;
  email: string;
}

export interface EsignSendResult {
  requestId: string;
  /** provider signature_id per signer email — links back to our recipient rows. */
  signatures: { email: string; signatureId: string }[];
}

/**
 * Create a signature request: uploads the document, emails each signer a
 * signing link, and returns the provider request id + per-signer ids.
 */
export async function sendSignatureRequest(input: {
  title: string;
  subject: string;
  message: string;
  signers: EsignSigner[];
  file: { name: string; buffer: Buffer; contentType: string };
}): Promise<EsignSendResult> {
  const form = new FormData();
  form.append('test_mode', config.dropboxSignTestMode ? '1' : '0');
  form.append('title', input.title.slice(0, 255));
  form.append('subject', input.subject.slice(0, 255));
  form.append('message', input.message.slice(0, 5000));
  input.signers.forEach((s, i) => {
    form.append(`signers[${i}][name]`, s.name);
    form.append(`signers[${i}][email_address]`, s.email);
    form.append(`signers[${i}][order]`, String(i));
  });
  form.append('file[0]', new Blob([input.file.buffer], { type: input.file.contentType }), input.file.name);

  const res = await fetch(`${API_BASE}/signature_request/send`, {
    method: 'POST',
    headers: { Authorization: authHeader() },
    body: form,
  });
  if (!res.ok) {
    throw new Error(`Dropbox Sign send failed (${res.status}): ${(await res.text()).slice(0, 500)}`);
  }
  const data = (await res.json()) as {
    signature_request: {
      signature_request_id: string;
      signatures: { signature_id: string; signer_email_address: string }[];
    };
  };
  const sr = data.signature_request;
  return {
    requestId: sr.signature_request_id,
    signatures: sr.signatures.map((s) => ({ email: s.signer_email_address, signatureId: s.signature_id })),
  };
}

/**
 * Verify a Dropbox Sign webhook event: event_hash is HMAC-SHA256 of
 * (event_time + event_type) keyed by the API key. Rejects forged callbacks.
 */
export function verifyWebhook(eventTime: string, eventType: string, eventHash: string): boolean {
  if (!config.dropboxSignApiKey || !eventHash) return false;
  const expected = crypto
    .createHmac('sha256', config.dropboxSignApiKey)
    .update(`${eventTime}${eventType}`)
    .digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(eventHash);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Download the completed, signed PDF (with the certificate of completion). */
export async function downloadSignedPdf(requestId: string): Promise<Buffer> {
  const res = await fetch(`${API_BASE}/signature_request/files/${encodeURIComponent(requestId)}?file_type=pdf`, {
    headers: { Authorization: authHeader() },
  });
  if (!res.ok) {
    throw new Error(`Dropbox Sign file download failed (${res.status})`);
  }
  return Buffer.from(await res.arrayBuffer());
}
