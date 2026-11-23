// @vitest-environment jsdom
/**
 * Страница подтверждения СМЕНЫ почты (/confirm-email?token=…). До 23.11.2026
 * её не было вовсе: письмо вело на «не найдено», и смена адреса не завершалась.
 * Сеть замокана на уровне http() (unit-тест).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { I18nProvider } from '@/i18n/I18nProvider';

vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>();
  return { ...actual, http: vi.fn() };
});

import { http } from '@/api/client';
import { useAuthStore } from '@/store/useAuthStore';
import type { UserProfile } from '@/types/domain';
import { ConfirmEmailPage } from './ConfirmEmailPage';

const mockHttp = http as unknown as ReturnType<typeof vi.fn>;

globalThis.IntersectionObserver =
  globalThis.IntersectionObserver ??
  (class {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  } as unknown as typeof IntersectionObserver);
window.matchMedia =
  window.matchMedia ??
  ((query: string) =>
    ({ matches: false, media: query, addEventListener: () => undefined, removeEventListener: () => undefined }) as unknown as MediaQueryList);

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const flush = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 30));
  });

let root: Root | null = null;
let host: HTMLDivElement;

async function render(url: string) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(
      <I18nProvider>
        <MemoryRouter initialEntries={[url]}>
          <ConfirmEmailPage />
        </MemoryRouter>
      </I18nProvider>,
    );
  });
  await flush();
}

const userWith = (email: string): UserProfile => ({ name: 'Тест', initials: 'Т', firm: '', jurisdiction: 'UZ', email });

const confirmCalls = () => mockHttp.mock.calls.filter(([path]) => path === '/auth/confirm-email');

beforeEach(() => {
  localStorage.setItem('lexai.lang', 'ru');
  mockHttp.mockReset();
  useAuthStore.setState({ token: null, user: null });
});

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
});

describe('ConfirmEmailPage', () => {
  it('подтверждает смену один раз, показывает новый адрес и снимает отозванный сеанс', async () => {
    useAuthStore.setState({ token: 'old-token', user: userWith('old@example.uz') });
    mockHttp.mockImplementation((path: string) =>
      path === '/auth/confirm-email' ? Promise.resolve({ ok: true, email: 'new@example.uz' }) : Promise.resolve(undefined),
    );

    await render('/confirm-email?token=abcdefghijklmnop');

    expect(confirmCalls()).toHaveLength(1);
    expect(confirmCalls()[0][1]).toMatchObject({ method: 'POST', body: { token: 'abcdefghijklmnop' } });
    expect(host.textContent).toContain('Почта изменена');
    expect(host.textContent).toContain('new@example.uz');
    expect(host.querySelector('a[href="/login"]')).not.toBeNull();
    expect(useAuthStore.getState().token).toBeNull();
  });

  it('просроченная ссылка — текст ошибки сервера, сеанс не трогаем', async () => {
    useAuthStore.setState({ token: 'live-token', user: userWith('me@example.uz') });
    mockHttp.mockRejectedValue(new Error('Ссылка недействительна или истекла — запросите смену адреса ещё раз'));

    await render('/confirm-email?token=abcdefghijklmnop');

    expect(host.textContent).toContain('Ссылка недействительна или истекла');
    expect(useAuthStore.getState().token).toBe('live-token');
  });

  it('ссылка без кода — сразу ошибка, на сервер не ходим', async () => {
    await render('/confirm-email');

    expect(confirmCalls()).toHaveLength(0);
    expect(host.textContent).toContain('Ссылка недействительна');
  });
});
