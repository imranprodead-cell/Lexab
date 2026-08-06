/**
 * Шапка публичных страниц-разделов.
 *
 * ПРАВИЛА (те же, что у PublicPage.tsx — здесь они особенно важны, потому что
 * этот файл попадает в КАЖДУЮ страницу сайта):
 *  - никакого `motion/react`: библиотека анимаций весит 48.7 КБ gzip, вчетверо
 *    больше всей шапки с подвалом;
 *  - только логические CSS-свойства, иначе арабская версия зеркалится неверно;
 *  - пункт меню показывается, только если его страница существует в реестре, —
 *    меню физически не может увести в 404.
 */
import { Link } from 'react-router-dom';
import { Avatar } from '@/components/ui/Avatar';
import { Icon } from '@/components/icons/Icon';
import { LanguageMenu } from '@/components/ui/LanguageMenu';
import { HEADER_NAV, type NavItem } from '@/content/site/nav';
import { useI18n } from '@/i18n/I18nProvider';
import { useResolvedDark } from '@/hooks/useResolvedDark';
import { useUIStore } from '@/store/useUIStore';
import { PUBLIC_SLUGS } from '@/pages/public/registry';
import { publicPath } from '@/router/publicPaths';
import styles from './publicShell.module.css';

/**
 * `onAnchor` передаёт только главная: там есть свой прокручиваемый контейнер и
 * функция прокрутки к секции. Без него пункты-якоря просто не рисуются.
 */
export function PublicHeader({
  activeSlug,
  onAnchor,
}: {
  activeSlug?: string;
  onAnchor?: (id: string) => void;
}) {
  const { t, lang } = useI18n();
  const dark = useResolvedDark();
  const toggleTheme = useUIStore((s) => s.toggleTheme);

  const visible = HEADER_NAV.filter((item: NavItem) =>
    item.kind === 'route' ? PUBLIC_SLUGS.includes(item.slug) : Boolean(onAnchor),
  );

  return (
    <header className={`glass-nav ${styles.bar}`}>
      <div className={styles.barInner}>
        <Link to="/" className={styles.brand} aria-label="Lexab">
          <Avatar size={28} />
          <span className={styles.brandName}>Lexab</span>
        </Link>

        {visible.length ? (
          <nav className={styles.nav} aria-label={t('landing.nav.aria')}>
            {visible.map((item) =>
              item.kind === 'route' ? (
                <Link
                  key={item.slug}
                  to={publicPath(item.slug)}
                  className={`nav-link ${styles.navLink} ${item.slug === activeSlug ? styles.navLinkActive : ''}`}
                  aria-current={item.slug === activeSlug ? 'page' : undefined}
                >
                  {item.label[lang]}
                </Link>
              ) : (
                <button
                  key={item.id}
                  type="button"
                  className={`nav-link ${styles.navLink}`}
                  onClick={() => onAnchor?.(item.id)}
                >
                  {item.label[lang]}
                </button>
              ),
            )}
          </nav>
        ) : null}

        <div className={styles.controls}>
          <LanguageMenu showLabel />
          <button
            type="button"
            className={styles.iconBtn}
            // Устойчивая зацепка для проверок: подписи кнопок переводятся на
            // шесть языков, искать по ним в тесте — гарантированная ложь.
            data-theme-toggle="true"
            onClick={toggleTheme}
            aria-label={dark ? t('top.theme.toLight') : t('top.theme.toDark')}
            title={dark ? t('top.theme.toLight') : t('top.theme.toDark')}
          >
            <Icon name={dark ? 'moon' : 'sun'} size={18} />
          </button>
          <Link to="/login" className={styles.headerCta}>
            {t('landing.navCta')}
          </Link>
        </div>
      </div>
    </header>
  );
}
