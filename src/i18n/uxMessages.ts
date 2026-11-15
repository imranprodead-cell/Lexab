import { useCallback } from 'react';
import { useI18n } from './I18nProvider';
import { registerMessages } from './messages';
import { UX_MESSAGES } from './uxStrings';

/**
 * Перевод для новых экранов (2026-11-15): решения по находкам, сроки отказа,
 * таблица проверок, образцы. RU/EN — в uxStrings.ts (вне главного чанка),
 * uz/kk/de/ar — в translations/*.ts под префиксом «ux.»; хук его подставляет.
 *
 * Тексты подключаются к общему словарю при загрузке этого модуля — то есть
 * вместе с первой страницей, которой они нужны, до её первой отрисовки.
 */
registerMessages(UX_MESSAGES);

export type UxT = (key: string, params?: Record<string, string | number>) => string;

export function useUxT(): UxT {
  const { t } = useI18n();
  return useCallback((key, params) => t(`ux.${key}`, params), [t]);
}
