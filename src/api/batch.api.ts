/** Batch review API — analyse a pack of uploaded contracts in one job. Files are
 *  uploaded first (uploadsApi.upload) and their ids handed to POST /batch. Pro+
 *  feature: the real endpoints answer 402 on Free/Standard (the page surfaces an
 *  upsell). */
import { USE_MOCK, http } from './client';
import { ApiError, clone, delay } from './util';
import type { BatchItem, BatchJob } from '@/types/domain';

export type { BatchItem, BatchJob } from '@/types/domain';

const now = () => new Date().toISOString();
const ago = (mins: number) => new Date(Date.now() - mins * 60_000).toISOString();

/** A finished item for the mock fixtures. */
const mockDoneItem = (id: string, fileName: string, riskScore: number, riskLevel: string, findingsCount: number): BatchItem => ({
  id,
  fileName,
  status: 'done',
  documentId: `d_${id}`,
  analysisId: `an_${id}`,
  riskScore,
  riskLevel,
  findingsCount,
  error: null,
});

const mockJobs: BatchJob[] = [
  {
    id: 'batch_2',
    status: 'done',
    total: 3,
    done: 3,
    failed: 0,
    createdAt: ago(180),
    items: [
      mockDoneItem('bi_21', 'NDA_Acme.docx', 22, 'Low', 3),
      mockDoneItem('bi_22', 'MSA_Delta.pdf', 61, 'Elevated', 7),
      mockDoneItem('bi_23', 'Lease_2026.docx', 84, 'High', 11),
    ],
  },
  {
    id: 'batch_1',
    status: 'done',
    total: 2,
    done: 1,
    failed: 1,
    createdAt: ago(1440),
    items: [
      mockDoneItem('bi_11', 'Employment_v2.docx', 38, 'Elevated', 5),
      {
        id: 'bi_12',
        fileName: 'Corrupt_scan.pdf',
        status: 'error',
        documentId: null,
        analysisId: null,
        riskScore: null,
        riskLevel: null,
        findingsCount: null,
        error: 'Не удалось извлечь текст',
      },
    ],
  },
];

/** Advance one mock job by a single item per poll, so GET shows live progress. */
function advanceMockJob(job: BatchJob) {
  const items = job.items ?? [];
  const next = items.find((i) => i.status === 'queued' || i.status === 'processing');
  if (!next) {
    job.status = 'done';
    return;
  }
  job.status = 'processing';
  if (next.status === 'queued') {
    next.status = 'processing';
    return;
  }
  // processing → done (with a plausible risk score derived from the id).
  const seed = items.indexOf(next);
  const score = 20 + ((seed * 27) % 70);
  next.status = 'done';
  next.documentId = `d_${next.id}`;
  next.analysisId = `an_${next.id}`;
  next.riskScore = score;
  next.riskLevel = score >= 70 ? 'High' : score >= 40 ? 'Elevated' : 'Low';
  next.findingsCount = 2 + (seed % 9);
  job.done += 1;
  if (!items.some((i) => i.status === 'queued' || i.status === 'processing')) job.status = 'done';
}

export const batchApi = {
  /** Queue a new job from already-uploaded file ids (1..20). */
  async start(uploadIds: string[], jurisdiction?: string): Promise<BatchJob> {
    if (USE_MOCK) {
      await delay(300);
      const id = `batch_${Date.now()}`;
      const job: BatchJob = {
        id,
        status: 'queued',
        total: uploadIds.length,
        done: 0,
        failed: 0,
        createdAt: now(),
        items: uploadIds.map((_uid, i) => ({
          id: `bi_${id}_${i}`,
          fileName: `Договор ${i + 1}`,
          status: 'queued',
          documentId: null,
          analysisId: null,
          riskScore: null,
          riskLevel: null,
          findingsCount: null,
          error: null,
        })),
      };
      mockJobs.unshift(job);
      return clone(job);
    }
    return http<BatchJob>('/batch', { method: 'POST', body: { uploadIds, jurisdiction } });
  },

  /** History (no items), newest first. */
  async list(signal?: AbortSignal): Promise<BatchJob[]> {
    if (USE_MOCK) {
      await delay(60);
      return clone(mockJobs.map(({ items: _items, ...rest }) => rest));
    }
    return http<BatchJob[]>('/batch', { signal });
  },

  /** One job WITH items — polled for progress. 404 if not owner. */
  async get(id: string, signal?: AbortSignal): Promise<BatchJob> {
    if (USE_MOCK) {
      await delay(120);
      const job = mockJobs.find((j) => j.id === id);
      if (!job) throw new ApiError('Batch job not found', 404);
      if (job.status !== 'done') advanceMockJob(job);
      return clone(job);
    }
    return http<BatchJob>(`/batch/${id}`, { signal });
  },
};
