import { useCallback } from 'react';
import { useI18n } from './I18nProvider';

/**
 * Перевод для новых экранов (ui-test 2026-11-15): решения по находкам, сроки
 * отказа, таблица проверок, образцы. Тексты — в общем словаре MESSAGES и в
 * translations/{uz,kk,de,ar}.ts под префиксом «ux.»; хук только его подставляет.
 */
export type UxT = (key: string, params?: Record<string, string | number>) => string;

export function useUxT(): UxT {
  const { t } = useI18n();
  return useCallback((key, params) => t(`ux.${key}`, params), [t]);
}
