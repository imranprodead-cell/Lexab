/**
 * Контакты для связи — В ОДНОЙ ТОЧКЕ.
 *
 * Ссылка на менеджера стоит в четырёх местах (лендинг, плавающий виджет,
 * правовые страницы, вкладка пополнения баланса API) и уже один раз разъехалась:
 * после переименования проекта Civis → Lexab часть мест осталась на старом
 * аккаунте, а QR-код на виджете вообще кодировал прежний адрес — картинку
 * поиском по тексту не найти. Меняется аккаунт — правится только этот файл
 * (и перегенерируется QR в TelegramWidget.tsx, там про это написано).
 */

/** Телеграм-аккаунт менеджера без «@». */
export const MANAGER_TELEGRAM_HANDLE = 'MANAGER_Lexab';

/** Полная ссылка на переписку с менеджером. */
export const MANAGER_TELEGRAM = `https://t.me/${MANAGER_TELEGRAM_HANDLE}`;

/** Как показывать контакт в тексте интерфейса. */
export const MANAGER_TELEGRAM_LABEL = `@${MANAGER_TELEGRAM_HANDLE}`;

/**
 * Соцсети в подвале сайта. Порядок здесь = порядок значков на странице.
 *
 * `label` не переводится намеренно: это имена площадок, они одинаковы во всех
 * шести локалях и уходят в `aria-label` — читалка экрана должна произносить
 * «LinkedIn», а не переведённое слово.
 */
export interface SocialLink {
  id: 'x' | 'linkedin' | 'youtube' | 'instagram';
  label: string;
  href: string;
}

export const SOCIAL_LINKS: readonly SocialLink[] = [
  { id: 'x', label: 'X', href: 'https://x.com/Ir3112465630060' },
  { id: 'linkedin', label: 'LinkedIn', href: 'https://www.linkedin.com/in/imran-a-466771422' },
  { id: 'youtube', label: 'YouTube', href: 'https://www.youtube.com/@lexab-ai' },
  { id: 'instagram', label: 'Instagram', href: 'https://www.instagram.com/lexab.ai' },
];
