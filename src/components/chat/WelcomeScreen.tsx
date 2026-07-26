import { Icon } from '@/components/icons/Icon';
import { Avatar } from '@/components/ui/Avatar';
import { GlassCard } from '@/components/ui/GlassCard';
import { useAuthStore } from '@/store/useAuthStore';
import { useUIStore } from '@/store/useUIStore';
import { COUNTRIES } from '@/data/countries';
import { useI18n } from '@/i18n/I18nProvider';
import styles from './chat.module.css';

interface WelcomeScreenProps {
  onAnalyze: () => void;
  onDraft: () => void;
  onCompare: () => void;
  /** «Посмотреть на примере»: мгновенный демо-разбор образца NDA без лимитов. */
  onSample: () => void;
}

export function WelcomeScreen({ onAnalyze, onDraft, onCompare, onSample }: WelcomeScreenProps) {
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
    { key: 'sample', icon: 'play' as const, onSelect: onSample },
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
      <div className={styles.welcomeGlow} />
      <div className={styles.welcomeInner}>
        <div style={{ display: 'flex', justifyContent: 'center' }}>
          <Avatar size={52} />
        </div>
        <h1 className={styles.welcomeTitle}>
          {greeting}, {firstName}.
        </h1>
        <p className={styles.welcomeSub}>{t('chat.welcome.sub')}</p>
        <div className={styles.suggestions}>
          {suggestions.map((s) => (
            <GlassCard key={s.key} as="button" className={styles.suggestion} onClick={s.onSelect}>
              <div className={styles.suggestionIcon}>
                <Icon name={s.icon} size={20} />
              </div>
              <div className={styles.suggestionTitle}>{t(`chat.suggest.${s.key}.title`)}</div>
              <div className={styles.suggestionBody}>
                {t(`chat.suggest.${s.key}.body`, s.key === 'draft' ? { country: countryInLaw } : undefined)}
              </div>
            </GlassCard>
          ))}
        </div>
      </div>
    </div>
  );
}
