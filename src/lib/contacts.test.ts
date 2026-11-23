/**
 * Сторож контактов. Ссылки на соцсети приходят из мобильных приложений вместе
 * с «хвостами» вида `?igsh=…`, `?si=…`, `?utm_source=share_via` — это разовые
 * метки конкретного нажатия «Поделиться». В подвале сайта они не нужны никому:
 * ломаются со временем и утаскивают чужую метку в чужую же аналитику.
 * Тест не даст такому хвосту вернуться при следующей правке.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { MANAGER_TELEGRAM, MANAGER_TELEGRAM_HANDLE, SOCIAL_LINKS } from './contacts';

describe('соцсети в подвале', () => {
  it('все четыре площадки на месте и в заданном порядке', () => {
    expect(SOCIAL_LINKS.map((s) => s.id)).toEqual(['x', 'linkedin', 'youtube', 'instagram']);
  });

  it('адреса ведут на нужные площадки по https', () => {
    const host = (href: string) => new URL(href).host;
    expect(SOCIAL_LINKS.every((s) => s.href.startsWith('https://'))).toBe(true);
    expect(host(SOCIAL_LINKS[0].href)).toBe('x.com');
    expect(host(SOCIAL_LINKS[1].href)).toBe('www.linkedin.com');
    expect(host(SOCIAL_LINKS[2].href)).toBe('www.youtube.com');
    expect(host(SOCIAL_LINKS[3].href)).toBe('www.instagram.com');
  });

  it('в адресах нет одноразовых меток «Поделиться»', () => {
    for (const s of SOCIAL_LINKS) {
      expect(new URL(s.href).search, `${s.label}: адрес должен быть без параметров`).toBe('');
    }
  });

  it('подписи заданы — без них у значка нет имени для читалки экрана', () => {
    expect(SOCIAL_LINKS.every((s) => s.label.trim().length > 0)).toBe(true);
  });
});

describe('контакт менеджера', () => {
  it('ссылка собирается из одного аккаунта — разъехаться нечему', () => {
    expect(MANAGER_TELEGRAM).toBe(`https://t.me/${MANAGER_TELEGRAM_HANDLE}`);
    expect(MANAGER_TELEGRAM_HANDLE.startsWith('@')).toBe(false);
  });

  it('описание компании для поисковиков (index.html) ведёт на тот же Telegram', () => {
    // index.html не импортирует TS — адрес там вписан руками. Ровно здесь он
    // и отстал: до 23.11.2026 поисковики видели старый t.me/MANAGER_CIVIS.
    const html = readFileSync(fileURLToPath(new URL('../../index.html', import.meta.url)), 'utf8');
    const telegramLinks = html.match(/https:\/\/t\.me\/[A-Za-z0-9_]+/g) ?? [];
    expect(telegramLinks).toEqual([MANAGER_TELEGRAM]);
  });
});
