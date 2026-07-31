import { useNavigate } from 'react-router-dom';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useReveal } from '@/hooks/useReveal';
import { useI18n } from '@/i18n/I18nProvider';
import styles from './pages.module.css';

/** 404 fallback for unknown routes. */
export function NotFoundPage() {
  const navigate = useNavigate();
  const { t } = useI18n();
  usePageTitle(t('nf.title'));

  return (
    <div className={styles.page}>
      <div className={styles.nfWrap} ref={useReveal()}>
        <Avatar size={48} />
        <h1 className={styles.nfTitle}>{t('nf.title')}</h1>
        <p className={styles.nfBody}>{t('nf.body')}</p>
        <Button variant="primary" className={styles.nfCta} onClick={() => navigate('/chat')}>
          {t('nf.cta')}
        </Button>
      </div>
    </div>
  );
}
