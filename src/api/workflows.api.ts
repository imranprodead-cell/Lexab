/** Agentic workflows API — run an ordered chain of actions over one document
 *  (re-analyse, auto-accept redlines, send for approval) and poll it for
 *  progress. Pro+ feature: the real endpoints answer 402 on lower plans (403
 *  for non-owners, 409 when an approval flow is already active). */
import { USE_MOCK, http } from './client';
import { ApiError, clone, delay } from './util';
import type { WorkflowRun, WorkflowStepInput } from '@/types/domain';

export type { WorkflowRun, WorkflowStepInput, WorkflowApprover } from '@/types/domain';

const now = () => new Date().toISOString();
const ago = (mins: number) => new Date(Date.now() - mins * 60_000).toISOString();

/** RU display label the mock uses in place of the server-provided one. */
function mockLabel(step: WorkflowStepInput): string {
  switch (step.kind) {
    case 'analyze':
      return 'Анализ и сверка с законом';
    case 'apply-redlines':
      return `Автоматически принять правки (${step.minSeverity} и выше)`;
    case 'send-for-approval':
      return `Отправить на согласование (${step.approvers.length})`;
  }
}

const mockRuns: WorkflowRun[] = [
  {
    id: 'wf_seed_1',
    documentId: 'd1',
    analysisId: 'an_wf_seed_1',
    status: 'done',
    steps: [
      { kind: 'analyze', label: 'Анализ и сверка с законом' },
      { kind: 'apply-redlines', label: 'Автоматически принять правки (High и выше)' },
    ],
    currentStep: 2,
    error: null,
    createdAt: ago(240),
  },
];

/** Advance one mock run by a single step per poll, so GET shows live progress. */
function advanceMockRun(run: WorkflowRun) {
  if (run.status === 'done' || run.status === 'failed') return;
  if (run.status === 'queued') {
    run.status = 'running';
    return;
  }
  // running → complete the current step and move on (or finish).
  if (run.currentStep < run.steps.length - 1) {
    run.currentStep += 1;
    return;
  }
  run.status = 'done';
  run.currentStep = run.steps.length;
  run.analysisId = `an_${run.id}`;
}

export const workflowsApi = {
  /** Launch a workflow over a document (201). Steps run in the given order. */
  async run(documentId: string, steps: WorkflowStepInput[]): Promise<WorkflowRun> {
    if (USE_MOCK) {
      await delay(300);
      const id = `wf_${Date.now()}`;
      const run: WorkflowRun = {
        id,
        documentId,
        analysisId: null,
        status: 'queued',
        steps: steps.map((s) => ({ kind: s.kind, label: mockLabel(s) })),
        currentStep: 0,
        error: null,
        createdAt: now(),
      };
      mockRuns.unshift(run);
      return clone(run);
    }
    return http<WorkflowRun>('/workflows/run', { method: 'POST', body: { documentId, steps } });
  },

  /** History, newest first. */
  async list(signal?: AbortSignal): Promise<WorkflowRun[]> {
    if (USE_MOCK) {
      await delay(60);
      return clone(mockRuns);
    }
    return http<WorkflowRun[]>('/workflows', { signal });
  },

  /** One run — polled for progress. 404 if not owner. */
  async get(id: string, signal?: AbortSignal): Promise<WorkflowRun> {
    if (USE_MOCK) {
      await delay(120);
      const run = mockRuns.find((r) => r.id === id);
      if (!run) throw new ApiError('Workflow run not found', 404);
      if (run.status !== 'done' && run.status !== 'failed') advanceMockRun(run);
      return clone(run);
    }
    return http<WorkflowRun>(`/workflows/${id}`, { signal });
  },
};
