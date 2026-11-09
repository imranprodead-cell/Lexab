import type { ChatStep } from '@/types/domain';

/**
 * Подписи шагов агента (tool-N) — общие для хода работы в ответе (WorkSteps)
 * и панели Progress (TaskSidebar). Без общей таблицы панель не знала шагов
 * агента и подписывала их все «Обдумываю ответ» (замечание владельца 09.11).
 * search_law подписывается отдельно («Ищу в базе законов …»).
 */
export const TOOL_STEP_KEYS: Record<string, string> = {
  get_provision: 'work.tool.getProvision',
  verify_citation: 'work.tool.verifyCitation',
  read_contract: 'work.tool.readContract',
  search_documents: 'work.tool.searchDocuments',
  propose_edit: 'work.tool.proposeEdit',
  get_review_edits: 'work.tool.reviewEdits',
  propose_reminder: 'work.tool.reminder',
  get_playbook: 'work.tool.playbook',
  compare_versions: 'work.tool.compare',
  calculate: 'work.tool.calculate',
  search_official: 'work.tool.searchOfficial',
  read_official: 'work.tool.readOfficial',
};

/** «Обдумываю ответ» — всегда последним: шаги агента (tool-N) приходят после него. */
export function answerLast(steps: ChatStep[]): ChatStep[] {
  return [...steps.filter((s) => s.id !== 'answer'), ...steps.filter((s) => s.id === 'answer')];
}
