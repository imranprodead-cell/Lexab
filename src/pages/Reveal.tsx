import type { HTMLAttributes } from 'react';
import { useReveal } from '@/hooks/useReveal';

/**
 * Обёртка каскада появления эталона для элементов в списках/сетках: тот же
 * <div> со всеми пропсами (className, onClick, style…), но с ref useReveal —
 * хук нельзя звать внутри .map(), а компонент можно. Чисто декоративная
 * вёрстка: поведение и обработчики проходят насквозь без изменений.
 */
export function Reveal({
  delay = 0,
  ...rest
}: HTMLAttributes<HTMLDivElement> & { delay?: number }) {
  return <div ref={useReveal<HTMLDivElement>(delay)} {...rest} />;
}
