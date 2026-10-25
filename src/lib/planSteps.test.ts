import { describe, expect, it } from 'vitest';
import type { ChatMessage } from '@/types/domain';
import { MOCK_PLAN_REPLY } from '@/data/seed';
import { approvedPlan, planSteps } from './planSteps';

describe('plan steps for the Progress column', () => {
  it('takes the numbered action list: bold action or the text before the dash', () => {
    expect(planSteps(MOCK_PLAN_REPLY.ru)).toEqual([
      'Соберите доказательства',
      'Направьте претензию',
      'Предложите график погашения',
      'Подайте иск',
    ]);
    expect(planSteps('### План\n1. Запросить акт сверки — у бухгалтерии\n2) Подготовить расчёт: неустойка\n\n### Риски\n1. не шаг')).toEqual([
      'Запросить акт сверки',
      'Подготовить расчёт',
    ]);
    expect(planSteps('Просто текст без списка.')).toEqual([]);
  });

  it('finds the plan that was approved, not a later draft', () => {
    const msg = (id: string, role: ChatMessage['role'], text: string): ChatMessage => ({ id, role, kind: 'text', text });
    const plan = MOCK_PLAN_REPLY.ru;
    expect(approvedPlan([msg('u1', 'user', '/plan долг'), msg('a1', 'assistant', plan)])).toBeNull(); // ещё не одобрен
    const approved = approvedPlan([
      msg('u1', 'user', '/plan долг'),
      msg('a1', 'assistant', plan),
      msg('u2', 'user', '/approve'),
      msg('a2', 'assistant', 'Проект претензии…'),
    ]);
    expect(approved?.messageId).toBe('a1');
    expect(approved?.steps).toHaveLength(4);
  });
});
