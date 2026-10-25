// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { I18nProvider } from '@/i18n/I18nProvider';

vi.mock('@/api', () => ({
  USE_MOCK: false,
  analysisApi: { get: vi.fn() },
  // «Недавние файлы» на приветствии: один договор и один черновик.
  documentsApi: {
    recent: vi.fn().mockResolvedValue([
      { id: 'd1', name: 'Supply_Agreement.pdf', updatedAt: new Date(Date.now() - 3_600_000).toISOString() },
    ]),
  },
  savedDocsApi: {
    list: vi.fn().mockResolvedValue([
      { id: 'st1', title: 'Claim letter draft', content: 'Text', createdAt: new Date(Date.now() - 60_000).toISOString() },
    ]),
  },
}));
vi.mock('@/api/analysis.api', () => ({ analysisApi: { draft: vi.fn() } }));
vi.mock('@/api/chats.api', () => ({
  chatsApi: {
    messages: vi.fn(),
    create: vi.fn(),
    sendMessage: vi.fn(),
    linkAnalysis: vi.fn().mockResolvedValue(undefined),
    setFeedback: vi.fn(),
    getProgress: vi.fn().mockResolvedValue(null),
    saveProgress: vi.fn().mockResolvedValue(null),
  },
}));
vi.mock('@/api/uploads.api', () => ({ uploadsApi: { upload: vi.fn() } }));
vi.mock('@/api/billing.api', () => ({ billingApi: { limits: vi.fn().mockResolvedValue({ plan: 'Free' }) } }));
vi.mock('@/store/useChatHistoryStore', () => ({
  useChatHistoryStore: Object.assign(
    (sel: (s: unknown) => unknown) => sel({ addSession: vi.fn() }),
    { getState: () => ({ load: vi.fn() }) },
  ),
}));

import { analysisApi } from '@/api';
import { chatsApi } from '@/api/chats.api';
import { uploadsApi } from '@/api/uploads.api';
import { useUIStore } from '@/store/useUIStore';
import { useChatStore } from '@/store/useChatStore';
import { ChatPage } from './ChatPage';

const mockMessages = chatsApi.messages as ReturnType<typeof vi.fn>;
const mockGetAnalysis = analysisApi.get as ReturnType<typeof vi.fn>;

const ANALYZED_CHAT = [
  { id: 'm1', role: 'user', kind: 'file', file: { name: 'NDA.pdf', size: '2 KB' } },
  { id: 'm2', role: 'assistant', kind: 'analysis', analysisId: 'an_1' },
];
const ANALYSIS = {
  id: 'an_1', fileName: 'NDA.pdf', fileSize: '2 KB', summary: 'Summary text here.',
  riskScore: 55, riskLevel: 'Elevated', clausesReviewed: 4,
  findings: [{ id: 'f1', severity: 'High', title: 'Unlimited liability', citation: 'UCTA 1977 s.2' }],
  redlines: [], document: [{ type: 'heading', text: '1. Term' }],
};

// jsdom has no scroll APIs — the app calls them in the scroll effect.
Element.prototype.scrollTo = Element.prototype.scrollTo ?? (() => undefined);
// jsdom also lacks matchMedia/IntersectionObserver — the reveal cascade
// (useReveal в приветствии) needs both; stubs keep the render identical.
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

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 20)); });

describe('ChatPage — reopening an analyzed-document chat from the sidebar', () => {
  let root: Root;
  let host: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    useChatStore.setState({
      phase: 'idle', messages: [], analysis: null, activeStep: -1, error: null,
      serverSessionId: null, sessionLoading: false,
    });
    document.body.innerHTML = '';
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  it('renders the file bubble and the analysis summary (not an empty canvas)', async () => {
    mockMessages.mockResolvedValue(ANALYZED_CHAT);
    mockGetAnalysis.mockResolvedValue(ANALYSIS);

    await act(async () => {
      root.render(
        <I18nProvider>
          <MemoryRouter initialEntries={['/chat/s1']}>
            <Routes>
              <Route path="/chat/:sessionId" element={<ChatPage />} />
            </Routes>
          </MemoryRouter>
        </I18nProvider>,
      );
    });
    await flush();
    await flush();

    const html = document.body.innerHTML;
    expect(mockMessages).toHaveBeenCalledWith('s1');
    expect(html).toContain('NDA.pdf'); // file bubble restored
    expect(html).toContain('Unlimited liability'); // findings restored
    expect(html).toContain('55'); // risk gauge restored
    expect(useChatStore.getState().analysis?.id).toBe('an_1');
  });

  // Сохранённый черновик живёт в воркспейсе (adoptDraft: phase 'analyzed', сообщений
  // нет). Возврат в «Чат» должен показать приветствие с подсказками, а не пустоту.
  it('shows the welcome screen after leaving a saved-draft workspace', async () => {
    useChatStore.getState().adoptDraft({ id: 'st_w', title: 'NDA', content: 'Текст соглашения.' });

    await act(async () => {
      root.render(
        <I18nProvider>
          <MemoryRouter initialEntries={['/chat']}>
            <Routes>
              <Route path="/chat" element={<ChatPage />} />
            </Routes>
          </MemoryRouter>
        </I18nProvider>,
      );
    });
    await flush();

    const html = document.body.innerHTML;
    // Приветствие на месте (тестовая локаль — en): вместо трёх карточек —
    // «Недавние файлы», свежий черновик выше договора.
    expect(html).not.toContain('Draft an NDA');
    expect(html).toContain('Recent files');
    expect(html.indexOf('Claim letter draft')).toBeGreaterThan(-1);
    expect(html.indexOf('Claim letter draft')).toBeLessThan(html.indexOf('Supply_Agreement.pdf'));
    expect(useChatStore.getState().analysis?.id).toBe('draft_st_w'); // канвас цел
  });

  // Аудит загрузок 2026-10-18: в чате с двумя разборами пузырёк брался от
  // ПЕРВОГО файла, а карточка — от ПОСЛЕДНЕГО разбора (имя одного договора,
  // разбор другого).
  it('пузырёк файла — того договора, чей разбор показан', async () => {
    mockMessages.mockResolvedValue([
      { id: 'm1', role: 'user', kind: 'file', file: { name: 'Первый-договор.pdf', size: '1 KB' } },
      { id: 'm2', role: 'assistant', kind: 'analysis', analysisId: 'an_first' },
      { id: 'm3', role: 'user', kind: 'file', file: { name: 'Второй-договор.pdf', size: '2 KB' } },
      { id: 'm4', role: 'assistant', kind: 'analysis', analysisId: 'an_second' },
    ]);
    mockGetAnalysis.mockResolvedValue({ ...ANALYSIS, id: 'an_second', fileName: 'Второй-договор.pdf' });

    await act(async () => {
      root.render(
        <I18nProvider>
          <MemoryRouter initialEntries={['/chat/s2']}>
            <Routes>
              <Route path="/chat/:sessionId" element={<ChatPage />} />
            </Routes>
          </MemoryRouter>
        </I18nProvider>,
      );
    });
    await flush();
    await flush();

    expect(mockGetAnalysis).toHaveBeenCalledWith('an_second');
    expect(document.body.innerHTML).toContain('Второй-договор.pdf');
    expect(document.body.innerHTML).not.toContain('Первый-договор.pdf');
  });

  it('новый договор открыл новый чат — адрес страницы переходит на него без перезагрузки', async () => {
    mockMessages.mockResolvedValue(ANALYZED_CHAT);
    mockGetAnalysis.mockResolvedValue(ANALYSIS);
    let path = '';
    function Probe() {
      path = useLocation().pathname;
      return null;
    }

    await act(async () => {
      root.render(
        <I18nProvider>
          <MemoryRouter initialEntries={['/chat/s1']}>
            <Probe />
            <Routes>
              <Route path="/chat/:sessionId" element={<ChatPage />} />
            </Routes>
          </MemoryRouter>
        </I18nProvider>,
      );
    });
    await flush();
    expect(path).toBe('/chat/s1');

    // Стор назначил канвасу чат нового договора (startAnalysis с newSession).
    await act(async () => {
      useChatStore.setState({ serverSessionId: 's_new' });
    });
    await flush();
    expect(path).toBe('/chat/s_new');
    expect(mockMessages).not.toHaveBeenCalledWith('s_new'); // канвас не перезагружался
  });
});

// Вложения (2026-10-25): файл ложится карточкой в поле ввода и ждёт вопроса —
// разбор рисков сам не стартует. С вопросом — ответ по файлам; один договор
// без текста — полный разбор, как раньше; на Free — не больше 2 файлов.
describe('ChatPage — attaching files to the composer', () => {
  let root: Root;
  let host: HTMLDivElement;
  const mockUpload = uploadsApi.upload as ReturnType<typeof vi.fn>;
  const sendSpy = vi.fn();
  const analysisSpy = vi.fn();

  beforeEach(async () => {
    vi.clearAllMocks();
    let seq = 0;
    mockUpload.mockImplementation(async (file: File) => ({ id: `up_${++seq}`, fileName: file.name, fileSize: '48 KB' }));
    useChatStore.setState({
      phase: 'idle', messages: [], analysis: null, activeStep: -1, error: null,
      serverSessionId: null, sessionLoading: false,
      sendMessage: sendSpy, startAnalysis: analysisSpy,
    });
    document.body.innerHTML = '';
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root.render(
        <I18nProvider>
          <MemoryRouter initialEntries={['/chat']}>
            <Routes>
              <Route path="/chat" element={<ChatPage />} />
            </Routes>
          </MemoryRouter>
        </I18nProvider>,
      );
    });
    await flush();
  });

  const attach = async (...names: string[]) => {
    const input = host.querySelector('input[type="file"]') as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: names.map((n) => new File(['x'], n)), configurable: true });
    await act(async () => {
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await flush();
  };
  const type = async (text: string) => {
    const ta = host.querySelector('textarea') as HTMLTextAreaElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    await act(async () => {
      setter?.call(ta, text);
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    });
  };
  const send = async () => {
    await act(async () => {
      (host.querySelector('button[aria-label="Send message"]') as HTMLButtonElement).click();
    });
    await flush();
  };

  it('a file waits for the question; the question goes out with it', async () => {
    await attach('Договор.docx');
    expect(host.textContent).toContain('Договор.docx');
    expect(host.textContent).toContain('Word (.docx) · 48 KB');
    expect(analysisSpy).not.toHaveBeenCalled(); // разбор сам не стартует

    await type('Какая неустойка?');
    await send();
    expect(sendSpy).toHaveBeenCalledWith('Какая неустойка?', [{ uploadId: 'up_1', name: 'Договор.docx', size: '48 KB' }]);
    expect(host.textContent).not.toContain('Word (.docx) · 48 KB'); // карточка ушла с вопросом
  });

  it('one contract sent without text runs the full risk review', async () => {
    await attach('Договор.pdf');
    await send();
    expect(sendSpy).not.toHaveBeenCalled();
    expect(analysisSpy).toHaveBeenCalledWith({ name: 'Договор.pdf', size: '48 KB' }, undefined, { uploadId: 'up_1', newSession: true });
  });

  it('a spreadsheet without text asks what to do instead of a risk review', async () => {
    await attach('Сроки.xlsx');
    expect(host.textContent).toContain('Excel (.xlsx)');
    await send();
    expect(analysisSpy).not.toHaveBeenCalled();
    expect(sendSpy).not.toHaveBeenCalled();
    expect(useUIStore.getState().toasts.slice(-1)[0]?.message).toMatch(/what to do with the files/);
  });

  it('Free plan: no more than 2 files at a time', async () => {
    await attach('a.docx', 'b.pdf', 'c.txt');
    expect(mockUpload).toHaveBeenCalledTimes(2);
    expect(host.querySelectorAll('[data-status]').length).toBe(2);
    await attach('d.docx');
    expect(mockUpload).toHaveBeenCalledTimes(2); // места нет — третий не грузится
  });
});

