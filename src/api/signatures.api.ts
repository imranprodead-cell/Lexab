/** E-signature API — list requests and send a document for signing. */
import type { SignatureRequest } from '@/types/domain';
import { USE_MOCK, http } from './client';
import { db } from './mock/db';
import { clone, delay } from './util';

export interface SendSignatureInput {
  documentName: string;
  recipients: { name: string; email: string }[];
}

export const signaturesApi = {
  async list(signal?: AbortSignal): Promise<SignatureRequest[]> {
    if (USE_MOCK) {
      await delay(40);
      return clone(db.signatures);
    }
    return http<SignatureRequest[]>('/signatures', { signal });
  },

  async send(input: SendSignatureInput): Promise<SignatureRequest> {
    if (USE_MOCK) {
      await delay(700);
      const request: SignatureRequest = {
        id: `s_${Date.now()}`,
        documentName: input.documentName,
        status: 'Sent',
        sentAt: new Date().toISOString(),
        recipients: input.recipients.map((r) => ({ ...r, signed: false })),
      };
      db.signatures.unshift(request);
      return clone(request);
    }
    return http<SignatureRequest>('/signatures', { method: 'POST', body: input });
  },
};
