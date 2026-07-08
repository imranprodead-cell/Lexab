/** Templates API — the reusable clause/document library. */
import type { Template } from '@/types/domain';
import { USE_MOCK, http } from './client';
import { db } from './mock/db';
import { clone, delay } from './util';

export const templatesApi = {
  async list(category?: string, signal?: AbortSignal): Promise<Template[]> {
    if (USE_MOCK) {
      await delay(40);
      let rows = clone(db.templates);
      if (category && category !== 'All') {
        rows = rows.filter((t) => t.category === category);
      }
      return rows;
    }
    const params = category ? `?category=${encodeURIComponent(category)}` : '';
    return http<Template[]>(`/templates${params}`, { signal });
  },

  /** AI-drafted contract from a template + form answers. */
  async generate(
    id: string,
    fields: { partyA: string; partyB: string; jurisdiction?: string; term?: string; details?: string },
  ): Promise<{ title: string; content: string }> {
    if (USE_MOCK) {
      await delay(1500);
      const tpl = db.templates.find((t) => t.id === id);
      return {
        title: `${tpl?.name ?? 'Договор'} — ${fields.partyA} / ${fields.partyB}`,
        content: `${(tpl?.name ?? 'AGREEMENT').toUpperCase()}\n\nThis agreement is entered into between ${fields.partyA} and ${fields.partyB}.\n\n1. TERM: ${fields.term || '12 months'}.\n2. GOVERNING LAW: ${fields.jurisdiction || 'England and Wales'}.\n${fields.details ? `3. SPECIAL TERMS: ${fields.details}\n` : ''}\n(Демо-режим: полный текст генерирует ИИ при подключённом сервере.)`,
      };
    }
    return http<{ title: string; content: string }>(`/templates/${id}/generate`, { method: 'POST', body: fields });
  },
};
