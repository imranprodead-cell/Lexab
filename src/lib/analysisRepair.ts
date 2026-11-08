import type { AnalysisResult } from '@/types/domain';

/**
 * Агент дочинил ссылки разбора в фоне (сервер: finishRepairInBackground):
 * подставляем свежие находки и серьёзность правок, НЕ трогая документ,
 * статусы правок и историю отмены — пользователь мог уже править договор,
 * пока шла проверка.
 */
export function mergeRepaired(local: AnalysisResult, fresh: AnalysisResult): AnalysisResult {
  if (local.id !== fresh.id) return local;
  const severity = new Map(fresh.redlines.map((r) => [r.id, r.severity]));
  const rest: AnalysisResult = { ...local };
  delete rest.repairPending;
  return {
    ...rest,
    findings: fresh.findings,
    redlines: local.redlines.map((r) => (severity.has(r.id) ? { ...r, severity: severity.get(r.id) as typeof r.severity } : r)),
    ...(fresh.repairPending ? { repairPending: true } : {}),
  };
}

/** Как часто и как долго ждём фоновую починку (сервер снимает отметку сам
 *  через 5 минут, если что-то пошло не так). */
export const REPAIR_POLL_MS = 3000;
export const REPAIR_WAIT_MS = 5.5 * 60 * 1000;
