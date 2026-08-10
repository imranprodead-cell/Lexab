/**
 * Ряд значков соцсетей для подвала — один на обе версии подвала (главная и
 * страницы-разделы), чтобы список площадок нельзя было развести по двум местам.
 *
 * Адреса берутся из `src/lib/contacts.ts` — единственной точки контактов.
 * Подписи только для читалки экрана: у знаков нет текста, поэтому без
 * `aria-label` ссылка звучала бы как «ссылка» и ничего больше.
 */
import { SOCIAL_LINKS } from '@/lib/contacts';
import { InstagramLogo, LinkedInLogo, XLogo, YouTubeLogo } from '@/components/icons/SocialLogos';
import { useI18n } from '@/i18n/I18nProvider';
import { pickText } from '@/i18n/messages';
import styles from './socialLinks.module.css';

const LOGOS = {
  x: XLogo,
  linkedin: LinkedInLogo,
  youtube: YouTubeLogo,
  instagram: InstagramLogo,
} as const;

/** Подпись группы ссылок для читалки экрана — на всех шести языках. */
const GROUP_LABEL = {
  ru: 'Мы в соцсетях',
  en: 'Follow us',
  de: 'Folgen Sie uns',
  ar: 'تابعنا',
  kk: 'Әлеуметтік желілерде',
  uz: 'Ijtimoiy tarmoqlarda',
};

interface SocialLinksProps {
  className?: string;
}

export function SocialLinks({ className }: SocialLinksProps) {
  const { lang } = useI18n();

  return (
    <nav className={className ? `${styles.row} ${className}` : styles.row} aria-label={pickText(GROUP_LABEL, lang)}>
      {SOCIAL_LINKS.map((s) => {
        const Logo = LOGOS[s.id];
        return (
          <a
            key={s.id}
            href={s.href}
            target="_blank"
            rel="noreferrer noopener"
            className={styles.link}
            aria-label={s.label}
            title={s.label}
          >
            <Logo />
          </a>
        );
      })}
    </nav>
  );
}
