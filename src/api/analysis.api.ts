/**
 * Analysis API — kicks off a contract review and returns the structured result.
 *
 * Swap-in note: the mock resolves after a fixed delay. A real endpoint would
 * likely stream Server-Sent Events for the progress steps; the UI already
 * animates steps independently (see chat store), so only this module changes.
 */
import type { AnalysisResult, DocBlock, Redline, RedlineStatus } from '@/types/domain';
import { downloadBlob } from '@/lib/download';
import { USE_MOCK, http, httpBlob } from './client';
import { db } from './mock/db';
import { ApiError, clone, delay } from './util';

export interface AnalyzeInput {
  fileName: string;
  fileSize: string;
  /** Default law context from the country selector (e.g. "German law"). */
  jurisdiction?: string;
}

async function analyzeMock(_input: AnalyzeInput): Promise<AnalysisResult> {
  // Matches the prototype timing: three ~1.15s steps before the report lands.
  await delay(3450);
  return clone(db.analysis);
}

async function getAnalysisMock(id: string): Promise<AnalysisResult> {
  await delay(40);
  if (db.analysis.id !== id) throw new ApiError('Analysis not found', 404);
  return clone(db.analysis);
}

export const analysisApi = {
  analyze(input: AnalyzeInput, signal?: AbortSignal): Promise<AnalysisResult> {
    if (USE_MOCK) return analyzeMock(input);
    return http<AnalysisResult>('/analysis', { method: 'POST', body: input, signal });
  },

  get(id: string, signal?: AbortSignal): Promise<AnalysisResult> {
    if (USE_MOCK) return getAnalysisMock(id);
    return http<AnalysisResult>(`/analysis/${id}`, { signal });
  },

  /** Generate a fresh contract from a prompt; returns it as an editable analysis. */
  async draft(prompt: string, jurisdiction?: string): Promise<AnalysisResult> {
    if (USE_MOCK) {
      await delay(1500);
      return { ...clone(db.analysis), id: `an_draft_${Date.now()}`, fileName: prompt.slice(0, 60) || 'Draft contract' };
    }
    return http<AnalysisResult>('/analysis/draft', { method: 'POST', body: { prompt, jurisdiction } });
  },

  /** Re-run the AI review against the current draft of an existing analysis. */
  async reanalyze(analysisId: string, jurisdiction?: string): Promise<AnalysisResult> {
    if (USE_MOCK) {
      await delay(1800);
      return clone(db.analysis);
    }
    return http<AnalysisResult>('/analysis', { method: 'POST', body: { analysisId, jurisdiction } });
  },

  /** Latest analysis linked to a document (404 if none has been run yet). */
  async latestForDocument(documentId: string, signal?: AbortSignal): Promise<AnalysisResult> {
    if (USE_MOCK) {
      await delay(60);
      if (documentId !== 'd1') throw new ApiError('No analysis for this document yet', 404);
      return clone(db.analysis);
    }
    return http<AnalysisResult>(`/documents/${documentId}/analysis`, { signal });
  },

  /** Persist a redline decision — accept, reject, or revert back to pending (undo). */
  async updateRedline(analysisId: string, redlineId: string, status: RedlineStatus): Promise<void> {
    if (USE_MOCK) {
      await delay(80);
      const rl = db.analysis.redlines.find((r) => r.id === redlineId);
      if (rl) rl.status = status;
      return;
    }
    await http(`/analysis/${analysisId}/redlines/${redlineId}`, { method: 'PATCH', body: { status } });
  },

  /** Persist manual edits made in the workspace editor. */
  // `redlines` (optional) carries the current suggestion snapshot so undo/redo
  // can re-create a redline the restored document references but that an earlier
  // edit had deleted — otherwise that clause's text is silently lost on reload.
  async saveDocument(id: string, document: DocBlock[], redlines?: Redline[]): Promise<void> {
    if (USE_MOCK) {
      await delay(200);
      db.analysis.document = clone(document);
      if (redlines) db.analysis.redlines = clone(redlines);
      return;
    }
    await http(`/analysis/${id}/document`, { method: 'PATCH', body: { document, ...(redlines ? { redlines } : {}) } });
  },

  /** Branded PDF report of the analysis (binary). */
  async downloadReport(id: string, fileName: string): Promise<void> {
    let blob: Blob;
    if (USE_MOCK) {
      await delay(300);
      blob = new Blob([`Lexab demo report for ${fileName}`], { type: 'text/plain' });
    } else {
      blob = await httpBlob(`/analysis/${id}/report.pdf`);
    }
    downloadBlob(blob, `Lexab_Report_${fileName.replace(/\.[^.]+$/, '')}.pdf`);
  },
};
