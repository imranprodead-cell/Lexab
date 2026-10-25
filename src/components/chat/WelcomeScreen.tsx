import type { ReactNode } from 'react';
import { motion } from 'motion/react';
import { EASE } from '@/lib/motion';
import { Avatar } from '@/components/ui/Avatar';
import { useAuthStore } from '@/store/useAuthStore';
import { useI18n } from '@/i18n/I18nProvider';
import { RecentFiles } from './RecentFiles';
import styles from './chat.module.css';

interface WelcomeScreenProps {
  /** Композер первого сообщения — стоит в середине экрана между
   *  подзаголовком и «Недавними файлами» (эталон app/page.tsx, empty state). */
  composer?: ReactNode;
}

/* Каскад появления — эталонный app/page.tsx (empty state):
   логотип scale 0.92 (0.5s) → заголовок y:16 (0.55s, delay .08) →
   подзаголовок (delay .16) → композер (delay .24, в ChatPage) →
   «Недавние файлы» (delay .34) → дисклеймер (delay .6). */
export function WelcomeScreen({ composer }: WelcomeScreenProps) {
  const { t } = useI18n();
  const user = useAuthStore((s) => s.user);

  const hour = new Date().getHours();
  const greeting =
    hour < 12 ? t('chat.greeting.morning') : hour < 18 ? t('chat.greeting.afternoon') : t('chat.greeting.evening');
  const firstName = (user?.name ?? 'Aisha').replace(/^[A-Z]\.\s*/, '').split(' ')[0];

  return (
    <div className={styles.welcome}>
      <div className={styles.welcomeInner}>
        <motion.div
          initial={{ opacity: 0, scale: 0.92 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.5, ease: EASE }}
          className={styles.welcomeLogo}
        >
          <span className={styles.welcomeGlow} aria-hidden />
          <Avatar size={64} />
        </motion.div>

        <motion.h1
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.55, ease: EASE, delay: 0.08 }}
          className={styles.welcomeTitle}
        >
          {greeting}, {firstName}.
        </motion.h1>

        <motion.p
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.55, ease: EASE, delay: 0.16 }}
          className={styles.welcomeSub}
        >
          {t('chat.welcome.sub')}
        </motion.p>

        {composer}

        <RecentFiles delay={0.34} />

        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.5, ease: EASE, delay: 0.6 }}
          className={styles.welcomeDisclaimer}
        >
          {t('chat.disclaimer')}
        </motion.p>
      </div>
    </div>
  );
}
