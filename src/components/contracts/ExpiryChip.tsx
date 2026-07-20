import { Badge } from '@/components/ui/Badge';
import { useI18n } from '@/i18n/I18nProvider';

/** Coloured days-to-expiry chip: ≤30 days danger, ≤60 warn, further out neutral. */
export function ExpiryChip({ days }: { days: number | null }) {
  const { t } = useI18n();
  if (days === null) return <>—</>;
  const color = days <= 30 ? 'var(--sev-high)' : days <= 60 ? 'var(--sev-med)' : 'var(--dim)';
  const label = days < 0 ? t('contracts.expired') : days === 0 ? t('docs.today') : t('contracts.daysLeft', { n: days });
  return <Badge color={color}>{label}</Badge>;
}
