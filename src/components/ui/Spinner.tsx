import { useI18n } from '@/i18n/I18nProvider';
import styles from './ui.module.css';

export function Spinner({ size = 20 }: { size?: number }) {
  const { t } = useI18n();
  return <div className={styles.spinner} style={{ width: size, height: size }} role="status" aria-label={t('a11y.loading')} />;
}
