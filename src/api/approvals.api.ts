/** Approval workflows API — ordered sign-off chains (Pro/Business). */
import { USE_MOCK, http } from './client';
import { delay } from './util';

export type ApprovalStepStatus = 'waiting' | 'pending' | 'approved' | 'rejected';
export type ApprovalFlowStatus = 'active' | 'approved' | 'rejected' | 'cancelled';

export interface ApprovalStep {
  id: string;
  ord: number;
  name: string;
  email: string;
  role: string | null;
  status: ApprovalStepStatus;
  dueAt: string | null;
  decidedAt: string | null;
  comment: string | null;
  /** Owner view only: builds the public decision link. */
  token?: string;
}

export interface ApprovalFlow {
  id: string;
  documentId: string;
  status: ApprovalFlowStatus;
  createdAt: string;
  steps: ApprovalStep[];
}

export interface NewApprovalStep {
  name: string;
  email: string;
  role?: string;
  dueAt?: string; // ISO date
}

export const approvalsApi = {
  async forDocument(documentId: string, signal?: AbortSignal): Promise<ApprovalFlow[]> {
    if (USE_MOCK) {
      await delay(40);
      return [];
    }
    return http<ApprovalFlow[]>(`/approvals?documentId=${encodeURIComponent(documentId)}`, { signal });
  },

  async create(documentId: string, steps: NewApprovalStep[]): Promise<ApprovalFlow> {
    if (USE_MOCK) {
      await delay(300);
      throw new Error('Недоступно в демо-режиме');
    }
    return http<ApprovalFlow>('/approvals', { method: 'POST', body: { documentId, steps } });
  },

  async cancel(id: string): Promise<void> {
    await http<void>(`/approvals/${id}/cancel`, { method: 'POST' });
  },
};
