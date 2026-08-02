// @vitest-environment jsdom
/**
 * Смоук «Проектов» (дел юристов): пустое состояние → создание через модалку →
 * карточка появляется в сетке. Сеть замокана на уровне http() (unit-тест);
 * стейт-мок хранит список, так что фоновый reload() после создания
 * возвращает те же данные, что и оптимистичная вставка.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { I18nProvider } from '@/i18n/I18nProvider';
import { clearAsyncCache } from '@/hooks/useAsync';

// Подменяем только http: остальные экспорты (USE_MOCK, httpSSE…) нужны
// сторам, которые тянет TopBar.
vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>();
  return { ...actual, http: vi.fn() };
});

import { http } from '@/api/client';
import { ProjectsPage } from './ProjectsPage';

const mockHttp = http as unknown as ReturnType<typeof vi.fn>;

// jsdom-заглушки — те же, что в ChatPage.test.tsx / ApiDocsPage.test.tsx.
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

interface ProjectRow {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  docsCount: number;
}

describe('ProjectsPage — список и создание', () => {
  let root: Root;
  let host: HTMLDivElement;
  let projects: ProjectRow[];

  beforeEach(async () => {
    vi.clearAllMocks();
    clearAsyncCache(); // кэш useAsync общий на процесс — тесты не должны делиться данными
    localStorage.setItem('lexai.lang', 'en'); // детерминированные строки
    projects = [];

    // Стейт-мок: GET отдаёт текущий список, POST создаёт строку.
    mockHttp.mockImplementation((path: string, opts?: { method?: string; body?: { name?: string } }) => {
      if (path === '/projects' && opts?.method === 'POST') {
        const now = new Date().toISOString();
        const row: ProjectRow = { id: `proj_${projects.length + 1}`, name: String(opts.body?.name), createdAt: now, updatedAt: now, docsCount: 0 };
        projects = [row, ...projects];
        return Promise.resolve(row);
      }
      if (path === '/projects') return Promise.resolve(projects);
      return Promise.resolve([]); // уведомления TopBar и прочее
    });

    document.body.innerHTML = '';
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);

    await act(async () => {
      root.render(
        <I18nProvider>
          <MemoryRouter initialEntries={['/projects']}>
            <ProjectsPage />
          </MemoryRouter>
        </I18nProvider>,
      );
    });
    await flush();
  });

  it('пустое состояние: призыв создать первое дело', () => {
    expect(mockHttp).toHaveBeenCalledWith('/projects', expect.anything());
    const html = document.body.innerHTML;
    expect(html).toContain('No projects yet');
    const newBtn = [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'New project');
    expect(newBtn).toBeDefined();
  });

  it('создание проекта: модалка → POST → карточка в сетке', async () => {
    const newBtn = [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'New project');
    await act(async () => {
      newBtn!.click();
    });

    const input = document.querySelector('input[name="projectName"]') as HTMLInputElement | null;
    expect(input).not.toBeNull();
    // Контролируемый input: значение через нативный сеттер + событие input.
    const setValue = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
    await act(async () => {
      setValue.call(input, 'Дело Acme');
      input!.dispatchEvent(new Event('input', { bubbles: true }));
    });

    const createBtn = [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Create');
    expect(createBtn).toBeDefined();
    await act(async () => {
      createBtn!.click();
    });
    await flush();

    expect(mockHttp).toHaveBeenCalledWith('/projects', expect.objectContaining({ method: 'POST', body: { name: 'Дело Acme' } }));
    const html = document.body.innerHTML;
    expect(html).toContain('Дело Acme'); // карточка появилась
    expect(html).toContain('0 contracts'); // счётчик договоров на карточке
  });
});
