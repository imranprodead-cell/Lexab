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
    const base = new URLSearchParams();
    if (query.search) base.set('search', query.search);
    if (query.status) base.set('status', query.status);
    if (query.risk) base.set('risk', query.risk);
    // The server paginates only the caller's OWN documents (pageSize capped at
    // 200 server-side) and appends the team-shared documents to EVERY page. So
    // one request can never see past the first 200 owned docs: a user with more
    // loses the older ones and the client-side counter/sort run on a partial
    // set. Walk every server page and merge, de-duplicating by id (shared docs
    // repeat on each page). Because only the OWN documents are paged, a page
    // that returns fewer than a full 200 owned docs is the last one — no need
    // to read X-Total-Count (which client.ts's http() does not expose). The
    // merged length then equals the real total, so the counter and the
    // name/risk/status sort operate on the whole library.
    const PAGE_SIZE = 200; // server's hard maximum
    const MAX_PAGES = 50; // safety ceiling (10k owned docs) against a runaway loop
    const byId = new Map<string, ContractDocument>();
    for (let page = 1; page <= MAX_PAGES; page++) {
      const params = new URLSearchParams(base);
      params.set('pageSize', String(PAGE_SIZE));
      params.set('page', String(page));
      const rows = await http<ContractDocument[]>(`/documents?${params.toString()}`, { signal });
      for (const doc of rows) byId.set(doc.id, doc);
      // Shared docs carry `sharedBy`; owned ones never do. Only owned docs are
      // paged, so a short page of owned docs means there is nothing after it.
      const ownInPage = rows.reduce((n, d) => (d.sharedBy ? n : n + 1), 0);
      if (ownInPage < PAGE_SIZE) break;
    }
    return [...byId.values()];
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

  /** Server-rendered export of the reviewed document (Word/PDF). For DOCX,
   *  `mode` chooses real Word tracked changes ('tracked', default) or the clean
   *  final document ('clean'); ignored for PDF. */
  async exportFile(id: string, format: 'docx' | 'pdf', mode?: 'tracked' | 'clean'): Promise<Blob> {
    if (USE_MOCK) {
      await delay(300);
      const doc = db.documents.find((d) => d.id === id);
      const html = `<!doctype html><html><head><meta charset="utf-8"></head><body><h2>${doc?.name ?? 'Document'}</h2><p>LexAI demo export.</p></body></html>`;
      return new Blob([html], { type: format === 'pdf' ? 'application/pdf' : 'application/msword' });
    }
    return httpBlob(`/documents/${id}/export`, { method: 'POST', body: { format, ...(mode ? { mode } : {}) } });
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
