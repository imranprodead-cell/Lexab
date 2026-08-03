// @vitest-environment jsdom
/**
 * Регресс на падение страницы дела: `notFound` вычисляется ПОСЛЕ загрузки, то
 * есть первая отрисовка идёт по обычной ветке, а вторая — по ветке «дело не
 * найдено». Пока useReveal вызывался внутри JSX обычной ветки, число хуков
 * между этими отрисовками менялось и React ронял страницу («Rendered fewer
 * hooks than expected»). Тест проходит именно этот переход загрузка → 404.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { I18nProvider } from '@/i18n/I18nProvider';
import { clearAsyncCache } from '@/hooks/useAsync';

vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>();
  return { ...actual, http: vi.fn() };
});

import { http } from '@/api/client';
import { ProjectDetailPage } from './ProjectDetailPage';

const mockHttp = http as unknown as ReturnType<typeof vi.fn>;

// jsdom-заглушки — те же, что в ProjectsPage.test.tsx.
window.matchMedia =
  window.matchMedia ??
  ((query: string) =>
    ({ matches: false, media: query, addEventListener: () => undefined, removeEventListener: () => undefined }) as unknown as MediaQueryList);
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
window.requestAnimationFrame = window.requestAnimationFrame ?? ((cb: FrameRequestCallback) => setTimeout(() => cb(0), 0) as unknown as number);

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const flush = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 30));
  });

describe('ProjectDetailPage — переход «загрузка → дело не найдено»', () => {
  let root: Root;
  let host: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    clearAsyncCache();
    localStorage.setItem('lexai.lang', 'en');
    document.body.innerHTML = '';
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  it('удалённое/чужое дело показывает «Project not found», а не роняет страницу', async () => {
    // Список дел пуст → после загрузки project === null → notFound = true.
    mockHttp.mockImplementation(() => Promise.resolve([]));

    const errors: unknown[] = [];
    const origError = console.error;
    console.error = (...args: unknown[]) => {
      errors.push(args[0]);
      origError(...args);
    };

    try {
      await act(async () => {
        root.render(
          <I18nProvider>
            <MemoryRouter initialEntries={['/projects/proj_missing']}>
              <Routes>
                <Route path="/projects/:id" element={<ProjectDetailPage />} />
              </Routes>
            </MemoryRouter>
          </I18nProvider>,
        );
      });
      await flush(); // здесь состояние переключается на «не найдено»

      expect(document.body.innerHTML).toContain('Project not found');
      // Ни одной ошибки про порядок хуков — страница пережила смену ветки.
      const hookErrors = errors.filter((e) => typeof e === 'string' && /hook/i.test(e));
      expect(hookErrors).toEqual([]);
    } finally {
      console.error = origError;
    }
  });
});
