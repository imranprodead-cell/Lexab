/**
 * Analysis API — kicks off a contract review and returns the structured result.
 *
 * Swap-in note: the mock resolves after a fixed delay. A real endpoint would
 * likely stream Server-Sent Events for the progress steps; the UI already
 * animates steps independently (see chat store), so only this module changes.
 */
import type { AnalysisResult, DocBlock } from '@/types/domain';
import { USE_MOCK, http, httpBlob } from './client';
import { db } from './mock/db';
import { ApiError, clone, delay } from './util';

export interface AnalyzeInput {
  fileName: string;
  fileSize: string;
}

async function analyzeMock(_input: AnalyzeInput): Promise<AnalysisResult> {
  // Matches the prototype timing: three ~1.15s steps before the report lands.
  await delay(3450);
  return clone(db.analysis);
}

async function getAnalysisMock(id: string): Promise<AnalysisResult> {
  await delay(250);
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

  /** Persist manual edits made in the workspace editor. */
  async saveDocument(id: string, document: DocBlock[]): Promise<void> {
    if (USE_MOCK) {
      await delay(200);
      db.analysis.document = clone(document);
      return;
    }
    await http(`/analysis/${id}/document`, { method: 'PATCH', body: { document } });
  },

  /** Branded PDF report of the analysis (binary). */
  async downloadReport(id: string, fileName: string): Promise<void> {
    let blob: Blob;
    if (USE_MOCK) {
      await delay(300);
      blob = new Blob([`LexAI demo report for ${fileName}`], { type: 'text/plain' });
    } else {
      blob = await httpBlob(`/analysis/${id}/report.pdf`);
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `LexAI_Report_${fileName.replace(/\.[^.]+$/, '')}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },
};
