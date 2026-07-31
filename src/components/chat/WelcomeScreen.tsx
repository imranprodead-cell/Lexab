import { Icon } from '@/components/icons/Icon';
import { Avatar } from '@/components/ui/Avatar';
import { useAuthStore } from '@/store/useAuthStore';
import { useUIStore } from '@/store/useUIStore';
import { useReveal } from '@/hooks/useReveal';
import { COUNTRIES } from '@/data/countries';
import { useI18n } from '@/i18n/I18nProvider';
import styles from './chat.module.css';

interface WelcomeScreenProps {
  onAnalyze: () => void;
  onDraft: () => void;
  onCompare: () => void;
}

export function WelcomeScreen({ onAnalyze, onDraft, onCompare }: WelcomeScreenProps) {
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

  // Каскад появления эталона: логотип → приветствие → подзаголовок → карточки.
  const logoRef = useReveal(0);
  const titleRef = useReveal(0.08);
  const subRef = useReveal(0.16);
  const cardRefs = [useReveal(0.28), useReveal(0.36), useReveal(0.44)];

  const hour = new Date().getHours();
  const greeting =
    hour < 12 ? t('chat.greeting.morning') : hour < 18 ? t('chat.greeting.afternoon') : t('chat.greeting.evening');
  const firstName = (user?.name ?? 'Aisha').replace(/^[A-Z]\.\s*/, '').split(' ')[0];

  return (
    <div className={styles.welcome}>
      <div className={styles.welcomeInner}>
        <div className={styles.welcomeLogo} ref={logoRef}>
          <div className={styles.welcomeGlow} aria-hidden />
          <Avatar size={52} />
        </div>
        <h1 className={styles.welcomeTitle} ref={titleRef}>
          {greeting}, {firstName}.
        </h1>
        <p className={styles.welcomeSub} ref={subRef}>
          {t('chat.welcome.sub')}
        </p>
        <div className={styles.suggestions}>
          {suggestions.map((s, i) => (
            <button
              key={s.key}
              type="button"
              ref={cardRefs[i]}
              className={`panel ${styles.suggestion}`}
              onClick={s.onSelect}
            >
              <div className={styles.suggestionIcon}>
                <Icon name={s.icon} size={20} />
              </div>
              <div className={styles.suggestionTitle}>{t(`chat.suggest.${s.key}.title`)}</div>
              <div className={styles.suggestionBody}>
                {t(`chat.suggest.${s.key}.body`, s.key === 'draft' ? { country: countryInLaw } : undefined)}
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
