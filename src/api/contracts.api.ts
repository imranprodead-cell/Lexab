/** Contracts (CLM) API — key dates, auto-renewals and obligations extracted
 *  from analysed contracts. Pro+ feature: the real endpoints answer 402 on
 *  Free/Standard (the pages surface an upsell / hide the card). */
import { USE_MOCK, http } from './client';
import { ApiError, clone, delay } from './util';
import type { ContractRow } from '@/types/domain';

export type { ContractRow, ContractTermsInfo, ContractObligation } from '@/types/domain';

/** Date-only ISO string N days from today (mock helper). */
const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

const mockContracts: ContractRow[] = [
  {
    documentId: 'd1',
    name: 'Employment_Agreement_v3.docx',
    counterparty: 'Meridian Labs Ltd',
    risk: 'Elevated',
    status: 'In review',
    mine: true,
    terms: {
      effectiveDate: inDays(-340),
      expiryDate: inDays(25),
      daysToExpiry: 25,
      autoRenew: true,
      renewalNoticeDays: 30,
      contractValue: '85 000',
      currency: 'GBP',
      governingLaw: 'England & Wales',
      extractedAt: new Date().toISOString(),
    },
    obligations: [
      { id: 'ob1', text: 'Направить уведомление о продлении', dueDate: inDays(-5), responsible: 'HR', done: false },
      { id: 'ob2', text: 'Пересмотреть оклад по итогам года', dueDate: inDays(20), responsible: null, done: false },
    ],
  },
  {
    documentId: 'd2',
    name: 'MSA_Acme_Corp.docx',
    counterparty: 'Acme Corp',
    risk: 'Low',
    status: 'Reviewed',
    mine: true,
    terms: {
      effectiveDate: inDays(-120),
      expiryDate: inDays(245),
      daysToExpiry: 245,
      autoRenew: false,
      renewalNoticeDays: null,
      contractValue: '1 200 000',
      currency: 'USD',
      governingLaw: 'New York',
      extractedAt: new Date().toISOString(),
    },
    obligations: [
      { id: 'ob3', text: 'Ежеквартальный отчёт об уровне сервиса', dueDate: inDays(40), responsible: 'Ops', done: true },
    ],
  },
  {
    documentId: 'd4',
    name: 'Supplier_Terms_2026.pdf',
    counterparty: 'Delta Logistics',
    risk: 'High',
    status: 'In review',
    mine: false,
    terms: {
      effectiveDate: inDays(-30),
      expiryDate: null,
      daysToExpiry: null,
      autoRenew: null,
      renewalNoticeDays: null,
      contractValue: null,
      currency: null,
      governingLaw: 'UK',
      extractedAt: new Date().toISOString(),
    },
    obligations: [],
  },
];

export const contractsApi = {
  /** All contracts with extracted terms, sorted by expiry ASC NULLS LAST. */
  async list(signal?: AbortSignal): Promise<ContractRow[]> {
    if (USE_MOCK) {
      await delay(60);
      return clone(mockContracts);
    }
    return http<ContractRow[]>('/contracts', { signal });
  },

  /** Terms for one document. 404 = no extracted terms; 402 = plan below Pro. */
  async get(documentId: string, signal?: AbortSignal): Promise<ContractRow> {
    if (USE_MOCK) {
      await delay(40);
      const row = mockContracts.find((c) => c.documentId === documentId);
      if (!row) throw new ApiError('No extracted terms', 404);
      return clone(row);
    }
    return http<ContractRow>(`/contracts/${documentId}`, { signal });
  },

  async setObligationDone(documentId: string, obligationId: string, done: boolean): Promise<{ id: string; done: boolean }> {
    if (USE_MOCK) {
      await delay(150);
      const row = mockContracts.find((c) => c.documentId === documentId);
      const ob = row?.obligations.find((o) => o.id === obligationId);
      if (!ob) throw new ApiError('Obligation not found', 404);
      ob.done = done;
      return { id: ob.id, done: ob.done };
    }
    return http<{ id: string; done: boolean }>(`/contracts/${documentId}/obligations/${obligationId}`, {
      method: 'PATCH',
      body: { done },
    });
  },
};
