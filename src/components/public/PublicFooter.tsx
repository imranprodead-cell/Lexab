/**
 * Подвал публичных страниц-разделов: карта сайта для человека и для краулера.
 *
 * Колонки берутся из общего меню и фильтруются по реестру существующих
 * страниц: пустая колонка не рисуется вовсе. Пока разделов мало, подвал сам
 * остаётся коротким — и в нём нет ни одной ссылки в никуда.
 *
 * Как и вся публичная часть — БЕЗ `motion/react` и без литеральных цветов.
 */
import { Link } from 'react-router-dom';
import { Avatar } from '@/components/ui/Avatar';
import { SocialLinks } from '@/components/ui/SocialLinks';
import { FOOTER_COLUMNS, LEGAL_LINKS } from '@/content/site/nav';
import { useI18n } from '@/i18n/I18nProvider';
import { PUBLIC_SLUGS } from '@/pages/public/registry';
import { publicPath } from '@/router/publicPaths';
import styles from './publicShell.module.css';

export function PublicFooter() {
  const { t, lang } = useI18n();

  const columns = FOOTER_COLUMNS.map((col) => ({
    title: col.title,
    items: col.items.filter((item) => item.kind === 'route' && PUBLIC_SLUGS.includes(item.slug)),
  })).filter((col) => col.items.length > 0);

  return (
    <footer className={styles.footer}>
      <div className={styles.footerInner}>
        <div className={styles.footerTop}>
          <div className={styles.footerBrandCol}>
            <Link to="/" className={styles.brand} aria-label="Lexab">
              <Avatar size={26} />
              <span className={styles.brandName}>Lexab</span>
            </Link>
            <p className={styles.footerTagline}>{t('auth.tagline')}</p>
          </div>

          {columns.map((col) => (
            <nav key={col.title.en} className={styles.footerCol} aria-label={col.title[lang]}>
              <div className={styles.footerColTitle}>{col.title[lang]}</div>
              {col.items.map((item) =>
                item.kind === 'route' ? (
                  <Link key={item.slug} to={publicPath(item.slug)} className={styles.footerLink}>
                    {item.label[lang]}
                  </Link>
                ) : null,
              )}
            </nav>
          ))}
        </div>

        <div className={styles.footerBottom}>
          <span className={styles.footerCopy}>© {new Date().getFullYear()} Lexab</span>
          <span className={styles.footerLegal}>
            {LEGAL_LINKS.map((l) => (
              <Link key={l.to} to={l.to} className={styles.footerLink}>
                {l.label[lang]}
              </Link>
            ))}
          </span>
          <SocialLinks className={styles.footerSocial} />
        </div>
      </div>
    </footer>
  );
}
