/**
 * Пост-калибровка риск-скора. Модель ставит балл сама, но после валидации
 * цитат (validate-citations демотирует непроверенные находки в Low) балл
 * обязан соответствовать фактической тяжести ПРОВЕРЕННОГО списка находок —
 * иначе «шапка» кричит 72/100 над тремя мелочами. Потолки по наивысшей
 * severity; riskLevel перевыводится теми же порогами, что в normalizeGenerated
 * (<34 Low, <67 Elevated), чтобы цифра и бейдж не разъезжались.
 */
import type { Severity } from '../types.ts';

const CAP_BY_MAX_SEVERITY: Record<Severity | 'none', number> = {
  none: 20, // находок нет — договор чистый
  Low: 40,
  Medium: 65,
  High: 100,
};

export function recalibrateRisk(
  findings: { severity: Severity }[],
  riskScore: number,
): { riskScore: number; riskLevel: 'Low' | 'Elevated' | 'High' } {
  const maxSeverity: Severity | 'none' = findings.some((f) => f.severity === 'High')
    ? 'High'
    : findings.some((f) => f.severity === 'Medium')
      ? 'Medium'
      : findings.length
        ? 'Low'
        : 'none';
  const capped = Math.min(Math.max(0, Math.round(riskScore)), CAP_BY_MAX_SEVERITY[maxSeverity]);
  const riskLevel = capped < 34 ? 'Low' : capped < 67 ? 'Elevated' : 'High';
  return { riskScore: capped, riskLevel };
}
