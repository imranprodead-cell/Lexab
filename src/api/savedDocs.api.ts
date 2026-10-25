/**
 * Сохранённые документы — то, что ИИ написал в чате и человек сохранил из
 * боковой панели. Показываются в Vault → Documents рядом с договорами и в
 * «Недавних файлах». Каталога шаблонов больше нет (решение владельца
 * 2026-10-25): документ на любую тему ИИ пишет сам после уточняющих вопросов.
 *
 * На сервере это прежние таблица saved_templates и адреса /templates/saved —
 * их не переименовывали, чтобы не трогать сохранённые данные.
 */
import type { SavedDoc } from '@/types/domain';
import { USE_MOCK, http, httpBlob } from './client';
import { clone, delay } from './util';

/** Тестовый режим: сохранённое живёт в памяти (в настоящем — на сервере). */
let mockSaved: SavedDoc[] = [];
let mockSavedSeq = 0;

export const savedDocsApi = {
  /** Сохранённые документы, новые сверху; limit — только последние N. */
  async list(signal?: AbortSignal, limit?: number): Promise<SavedDoc[]> {
    if (USE_MOCK) {
      await delay(40);
      return clone(limit ? mockSaved.slice(0, limit) : mockSaved);
    }
    return http<SavedDoc[]>(limit ? `/templates/saved?limit=${limit}` : '/templates/saved', { signal });
  },

  /** Сохранить документ из чата. */
  async save(input: { title: string; content: string; sourceTemplateId?: string; jurisdiction?: string }): Promise<SavedDoc> {
    if (USE_MOCK) {
      await delay(120);
      const saved: SavedDoc = {
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
    return http<SavedDoc>('/templates/saved', { method: 'POST', body: input });
  },

  /** Записать правки (боковая панель, рабочее окно) в сохранённый документ. */
  async update(id: string, input: { content: string }): Promise<SavedDoc> {
    if (USE_MOCK) {
      await delay(80);
      const idx = mockSaved.findIndex((s) => s.id === id);
      if (idx < 0) throw new Error('Saved document not found');
      mockSaved[idx] = { ...mockSaved[idx], content: input.content };
      return clone(mockSaved[idx]);
    }
    return http<SavedDoc>(`/templates/saved/${id}`, { method: 'PATCH', body: input });
  },

  async remove(id: string): Promise<void> {
    if (USE_MOCK) {
      await delay(80);
      mockSaved = mockSaved.filter((s) => s.id !== id);
      return;
    }
    await http(`/templates/saved/${id}`, { method: 'DELETE' });
  },

  /** Настоящий .docx из текста документа (собирает сервер). */
  async exportDocx(title: string, content: string): Promise<Blob> {
    if (USE_MOCK) {
      await delay(120);
      return new Blob([`${title}\n\n${content}`], { type: 'text/plain' });
    }
    return httpBlob('/export/docx', { method: 'POST', body: { title, content } });
  },

  /** PDF из текста документа; кириллица — шрифтами Noto на сервере. */
  async exportPdf(title: string, content: string): Promise<Blob> {
    if (USE_MOCK) {
      await delay(120);
      return new Blob([`${title}\n\n${content}`], { type: 'text/plain' });
    }
    return httpBlob('/export/pdf', { method: 'POST', body: { title, content } });
  },
};
