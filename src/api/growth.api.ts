/**
 * API «фич роста»: демо-образец онбординга, публичная ссылка на отчёт,
 * вебхуки Slack/Teams. Небольшие и родственные — один модуль.
 */
import type { AnalysisResult, Severity } from '@/types/domain';
import { USE_MOCK, http } from './client';
import { delay } from './util';

/* ── Онбординг: образец анализа ─────────────────────────────────────────── */

export const onboardingApi = {
  /** Создать (или вернуть готовый) демо-разбор образца NDA — мгновенно, без лимитов. */
  async sample(): Promise<AnalysisResult> {
    if (USE_MOCK) {
      await delay(300);
      const { DEMO_ANALYSIS } = await import('@/data/seed');
      return { ...DEMO_ANALYSIS, id: 'an_sample', fileName: 'Образец NDA (демо).txt' };
    }
    return http<AnalysisResult>('/onboarding/sample', { method: 'POST' });
  },
};

/* ── Публичная ссылка на отчёт ──────────────────────────────────────────── */

export interface ShareLink {
  token: string;
  url: string;
}

export interface PublicReport {
  fileName: string;
  summary: string;
  riskScore: number;
  riskLevel: string;
  clausesReviewed: number;
  analyzedAt: string;
  firm: string;
  findings: { severity: Severity; title: string; citation: string; verified: boolean; playbookDeviation: boolean }[];
}

export const shareApi = {
  async create(analysisId: string): Promise<ShareLink> {
    if (USE_MOCK) {
      await delay(200);
      return { token: 'mock', url: `${location.origin}/share/mock` };
    }
    return http<ShareLink>(`/analysis/${analysisId}/share`, { method: 'POST' });
  },

  async revoke(analysisId: string): Promise<void> {
    if (USE_MOCK) {
      await delay(150);
      return;
    }
    await http<void>(`/analysis/${analysisId}/share`, { method: 'DELETE' });
  },

  /** ПУБЛИЧНО (страница /share/:token — без авторизации). */
  async publicReport(token: string, signal?: AbortSignal): Promise<PublicReport> {
    if (USE_MOCK) {
      await delay(150);
      return {
        fileName: 'NDA_Acme.pdf',
        summary: 'Одностороннее NDA с тремя рисковыми пунктами.',
        riskScore: 72,
        riskLevel: 'High',
        clausesReviewed: 9,
        analyzedAt: new Date().toISOString(),
        firm: 'Lexab',
        findings: [
          { severity: 'High', title: 'Бессрочная конфиденциальность', citation: 'ст. 98 ГК РУз', verified: true, playbookDeviation: false },
        ],
      };
    }
    return http<PublicReport>(`/share/${encodeURIComponent(token)}`, { signal });
  },
};

/* ── Вебхуки Slack/Teams ────────────────────────────────────────────────── */

export type WebhookProvider = 'slack' | 'teams';

export interface WebhookInfo {
  provider: WebhookProvider;
  maskedUrl: string;
  createdAt?: string;
}

export const webhooksApi = {
  async list(signal?: AbortSignal): Promise<WebhookInfo[]> {
    if (USE_MOCK) {
      await delay(40);
      return [];
    }
    return http<WebhookInfo[]>('/me/webhooks', { signal });
  },

  async save(provider: WebhookProvider, url: string): Promise<WebhookInfo> {
    if (USE_MOCK) {
      await delay(200);
      return { provider, maskedUrl: 'hooks.slack.com/…mock' };
    }
    return http<WebhookInfo>('/me/webhooks', { method: 'PUT', body: { provider, url } });
  },

  async remove(provider: WebhookProvider): Promise<void> {
    if (USE_MOCK) {
      await delay(150);
      return;
    }
    await http<void>(`/me/webhooks/${provider}`, { method: 'DELETE' });
  },

  async test(provider: WebhookProvider): Promise<{ ok: boolean }> {
    if (USE_MOCK) {
      await delay(300);
      return { ok: true };
    }
    return http<{ ok: boolean }>(`/me/webhooks/${provider}/test`, { method: 'POST' });
  },
};
