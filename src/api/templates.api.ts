/** Templates API — the reusable clause/document library. */
import type { SavedTemplate, Template } from '@/types/domain';
import { USE_MOCK, http } from './client';
import { db } from './mock/db';
import { clone, delay } from './util';

/** In-memory personal library for mock mode (real mode persists on the server). */
let mockSaved: SavedTemplate[] = [];
let mockSavedSeq = 0;

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

  /** The user's personal library of saved generated contracts. */
  async listSaved(signal?: AbortSignal): Promise<SavedTemplate[]> {
    if (USE_MOCK) {
      await delay(40);
      return clone(mockSaved);
    }
    return http<SavedTemplate[]>('/templates/saved', { signal });
  },

  /** Keep a generated draft in the personal library. */
  async saveDraft(input: {
    title: string;
    content: string;
    sourceTemplateId?: string;
    jurisdiction?: string;
  }): Promise<SavedTemplate> {
    if (USE_MOCK) {
      await delay(120);
      const saved: SavedTemplate = {
        id: `st_mock_${++mockSavedSeq}`,
        title: input.title,
        content: input.content,
        ...(input.sourceTemplateId ? { sourceTemplateId: input.sourceTemplateId } : {}),
        ...(input.jurisdiction ? { jurisdiction: input.jurisdiction } : {}),
        createdAt: new Date().toISOString(),
      };
      mockSaved = [saved, ...mockSaved];
      return clone(saved);
    }
    return http<SavedTemplate>('/templates/saved', { method: 'POST', body: input });
  },

  /** Remove a saved template from the personal library. */
  async removeSaved(id: string): Promise<void> {
    if (USE_MOCK) {
      await delay(80);
      mockSaved = mockSaved.filter((s) => s.id !== id);
      return;
    }
    await http(`/templates/saved/${id}`, { method: 'DELETE' });
  },
};
