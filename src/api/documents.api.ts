/** Documents API — the contracts table (search, filter, pagination-ready). */
import type { ContractDocument } from '@/types/domain';
import { USE_MOCK, http } from './client';
import { db } from './mock/db';
import { ApiError, clone, delay } from './util';

export interface DocumentQuery {
  search?: string;
  status?: string;
  risk?: string;
}

export const documentsApi = {
  async list(query: DocumentQuery = {}, signal?: AbortSignal): Promise<ContractDocument[]> {
    if (USE_MOCK) {
      await delay(450);
      let rows = clone(db.documents);
      const search = query.search?.trim().toLowerCase();
      if (search) {
        rows = rows.filter(
          (d) =>
            d.name.toLowerCase().includes(search) ||
            d.counterparty.toLowerCase().includes(search),
        );
      }
      if (query.status && query.status !== 'All') {
        rows = rows.filter((d) => d.status === query.status);
      }
      if (query.risk && query.risk !== 'All') {
        rows = rows.filter((d) => d.risk === query.risk);
      }
      return rows;
    }
    const params = new URLSearchParams();
    if (query.search) params.set('search', query.search);
    if (query.status) params.set('status', query.status);
    if (query.risk) params.set('risk', query.risk);
    return http<ContractDocument[]>(`/documents?${params.toString()}`, { signal });
  },

  async get(id: string, signal?: AbortSignal): Promise<ContractDocument> {
    if (USE_MOCK) {
      await delay(300);
      const doc = db.documents.find((d) => d.id === id);
      if (!doc) throw new ApiError('Document not found', 404);
      return clone(doc);
    }
    return http<ContractDocument>(`/documents/${id}`, { signal });
  },
};
