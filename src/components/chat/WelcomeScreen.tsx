import type { ReactNode } from 'react';
import { motion } from 'motion/react';
import { EASE } from '@/lib/motion';
import { Icon } from '@/components/icons/Icon';
import { Avatar } from '@/components/ui/Avatar';
import { useAuthStore } from '@/store/useAuthStore';
import { useUIStore } from '@/store/useUIStore';
import { COUNTRIES } from '@/data/countries';
import { useI18n } from '@/i18n/I18nProvider';
import styles from './chat.module.css';

interface WelcomeScreenProps {
  onAnalyze: () => void;
  onDraft: () => void;
  onCompare: () => void;
  /** Композер первого сообщения — стоит в середине экрана между
   *  подзаголовком и карточками (эталон app/page.tsx, empty state). */
  composer?: ReactNode;
}

/* Каскад появления — дословно эталонный app/page.tsx (empty state):
   логотип scale 0.92 (0.5s) → заголовок y:16 (0.55s, delay .08) →
   подзаголовок (delay .16) → композер (delay .24, в ChatPage) →
   карточки y:18 (0.5s, delay .34+i*.08, hover y:-3) → дисклеймер (delay .6). */
export function WelcomeScreen({ onAnalyze, onDraft, onCompare, composer }: WelcomeScreenProps) {
  const { t, lang } = useI18n();
  const user = useAuthStore((s) => s.user);
  // The NDA card follows the top-bar country selector — the same jurisdiction
  // the draft itself will be generated under (defaultLaw in useChatStore).
  // Russian needs the genitive ("по праву Германии"); every other language
  // takes its localized country name from the country.* i18n keys.
  const countryCode = useUIStore((s) => s.country);
  const country = COUNTRIES.find((c) => c.code === countryCode) ?? COUNTRIES[1];
  const countryInLaw = lang === 'ru' ? country.nameGen : t(`country.${country.code}`);

  const suggestions = [
    { key: 'analyze', icon: 'search' as const, onSelect: onAnalyze },
    { key: 'draft', icon: 'pen' as const, onSelect: onDraft },
    { key: 'compare', icon: 'layout' as const, onSelect: onCompare },
  ];

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

        <div className={styles.suggestions}>
          {suggestions.map((s, i) => (
            <motion.button
              key={s.key}
              type="button"
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, ease: EASE, delay: 0.34 + i * 0.08 }}
              whileHover={{ y: -3 }}
              className={`panel ${styles.suggestion}`}
              onClick={s.onSelect}
            >
              <span className={styles.suggestionIcon}>
                <Icon name={s.icon} size={20} />
              </span>
              <span className={styles.suggestionTitle}>{t(`chat.suggest.${s.key}.title`)}</span>
              <span className={styles.suggestionBody}>
                {t(`chat.suggest.${s.key}.body`, s.key === 'draft' ? { country: countryInLaw } : undefined)}
              </span>
            </motion.button>
          ))}
        </div>

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
