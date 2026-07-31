// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { I18nProvider } from '@/i18n/I18nProvider';

vi.mock('@/api', () => ({ USE_MOCK: false, analysisApi: { get: vi.fn() } }));
vi.mock('@/api/analysis.api', () => ({ analysisApi: { draft: vi.fn() } }));
vi.mock('@/api/chats.api', () => ({
  chatsApi: {
    messages: vi.fn(),
    create: vi.fn(),
    sendMessage: vi.fn(),
    sendGhostMessage: vi.fn(),
    linkAnalysis: vi.fn().mockResolvedValue(undefined),
    setFeedback: vi.fn(),
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
      serverSessionId: null, sessionLoading: false, ghost: false,
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

  // Черновик шаблона живёт в воркспейсе (adoptDraft: phase 'analyzed', сообщений
  // нет). Возврат в «Чат» должен показать приветствие с подсказками, а не пустоту.
  it('shows the welcome screen after leaving a template-draft workspace', async () => {
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
    expect(html).toContain('Draft an NDA'); // подсказки приветствия на месте (тестовая локаль — en)
    expect(useChatStore.getState().analysis?.id).toBe('draft_st_w'); // канвас цел
  });
});
