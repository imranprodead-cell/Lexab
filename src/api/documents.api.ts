/** Documents API — the contracts table (search, filter, pagination-ready). */
import type { ContractDocument } from '@/types/domain';
import { USE_MOCK, http, httpBlob } from './client';
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
      await delay(50);
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
      await delay(40);
      const doc = db.documents.find((d) => d.id === id);
      if (!doc) throw new ApiError('Document not found', 404);
      return clone(doc);
    }
    return http<ContractDocument>(`/documents/${id}`, { signal });
  },

  /** Server-rendered export of the reviewed document (Word/PDF). */
  async exportFile(id: string, format: 'docx' | 'pdf'): Promise<Blob> {
    if (USE_MOCK) {
      await delay(300);
      const doc = db.documents.find((d) => d.id === id);
      const html = `<!doctype html><html><head><meta charset="utf-8"></head><body><h2>${doc?.name ?? 'Document'}</h2><p>LexAI demo export.</p></body></html>`;
      return new Blob([html], { type: format === 'pdf' ? 'application/pdf' : 'application/msword' });
    }
    return httpBlob(`/documents/${id}/export`, { method: 'POST', body: { format } });
  },

  /** Owner: share / unshare the document with the team. */
  async share(id: string, teamShared: boolean): Promise<ContractDocument> {
    if (USE_MOCK) {
      await delay(150);
      const doc = db.documents.find((d) => d.id === id);
      if (!doc) throw new ApiError('Document not found', 404);
      doc.teamShared = teamShared;
      return clone(doc);
    }
    return http<ContractDocument>(`/documents/${id}`, { method: 'PATCH', body: { teamShared } });
  },

  /** Owner: delete the document with its analyses, versions and uploads. */
  async remove(id: string): Promise<void> {
    if (USE_MOCK) {
      await delay(200);
      const i = db.documents.findIndex((d) => d.id === id);
      if (i >= 0) db.documents.splice(i, 1);
      return;
    }
    await http<void>(`/documents/${id}`, { method: 'DELETE' });
  },
};
