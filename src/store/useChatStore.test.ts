// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

// USE_MOCK must be false so loadSession talks to the (mocked) HTTP api layer.
vi.mock('@/api', () => ({
  USE_MOCK: false,
  analysisApi: { get: vi.fn() },
}));
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
vi.mock('@/store/useChatHistoryStore', () => ({
  useChatHistoryStore: { getState: () => ({ load: vi.fn() }) },
}));

import { analysisApi } from '@/api';
import { chatsApi } from '@/api/chats.api';
import { useChatStore } from './useChatStore';

const mockMessages = chatsApi.messages as ReturnType<typeof vi.fn>;
const mockGetAnalysis = analysisApi.get as ReturnType<typeof vi.fn>;

const ANALYZED_CHAT = [
  { id: 'm1', role: 'user', kind: 'file', file: { name: 'NDA.pdf', size: '2 KB' } },
  { id: 'm2', role: 'assistant', kind: 'analysis', analysisId: 'an_1' },
];
const ANALYSIS = { id: 'an_1', fileName: 'NDA.pdf', fileSize: '2 KB', summary: 's', riskScore: 50, riskLevel: 'Elevated', clausesReviewed: 3, findings: [], redlines: [], document: [] };

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('chat store — reopening a saved session', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useChatStore.setState({
      phase: 'idle', messages: [], analysis: null, activeStep: -1, error: null,
      serverSessionId: null, sessionLoading: false, ghost: false,
    });
  });

  it('an analyzed-document chat restores its file message AND analysis card', async () => {
    mockMessages.mockResolvedValue(ANALYZED_CHAT);
    mockGetAnalysis.mockResolvedValue(ANALYSIS);

    const p = useChatStore.getState().loadSession('s1');
    // Instant reaction: loading flag up, canvas cleared, session adopted.
    expect(useChatStore.getState().sessionLoading).toBe(true);
    expect(useChatStore.getState().serverSessionId).toBe('s1');
    await p;
    await flush();

    const s = useChatStore.getState();
    expect(s.sessionLoading).toBe(false);
    expect(s.phase).toBe('analyzed');
    expect(s.messages.map((m) => m.id)).toEqual(['m1', 'm2']);
    expect(s.analysis?.id).toBe('an_1');
  });

  it('reopening from cache paints instantly and revalidates', async () => {
    mockMessages.mockResolvedValue(ANALYZED_CHAT);
    mockGetAnalysis.mockResolvedValue(ANALYSIS);
    await useChatStore.getState().loadSession('s1');
    await flush();

    // Switch away…
    mockMessages.mockResolvedValue([{ id: 't1', role: 'user', kind: 'text', text: 'hi' }]);
    mockGetAnalysis.mockResolvedValue(null);
    await useChatStore.getState().loadSession('s2');
    await flush();
    expect(useChatStore.getState().messages.map((m) => m.id)).toEqual(['t1']);

    // …and back: cache paints the analyzed chat immediately (no loading flag).
    mockMessages.mockResolvedValue(ANALYZED_CHAT);
    mockGetAnalysis.mockResolvedValue(ANALYSIS);
    const p = useChatStore.getState().loadSession('s1');
    const mid = useChatStore.getState();
    expect(mid.sessionLoading).toBe(false);
    expect(mid.messages.map((m) => m.id)).toEqual(['m1', 'm2']);
    expect(mid.analysis?.id).toBe('an_1');
    await p;
    await flush();
    expect(useChatStore.getState().messages.map((m) => m.id)).toEqual(['m1', 'm2']);
    expect(useChatStore.getState().analysis?.id).toBe('an_1');
  });

  it('a failed load falls back to an empty canvas, not a stuck skeleton', async () => {
    mockMessages.mockRejectedValue(new Error('offline'));
    await useChatStore.getState().loadSession('s9');
    await flush();
    const s = useChatStore.getState();
    expect(s.sessionLoading).toBe(false);
    expect(s.phase).toBe('idle');
    expect(s.messages).toEqual([]);
  });
});

describe('chat store — live streaming', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useChatStore.setState({
      phase: 'idle', messages: [], analysis: null, activeStep: -1, error: null,
      serverSessionId: 's_live', sessionLoading: false, ghost: false,
    });
  });

  it('streams tokens live into the bubble and finalizes with the server reply id', async () => {
    const mockSend = chatsApi.sendMessage as ReturnType<typeof vi.fn>;
    mockSend.mockImplementation(async (_sid, _text, _aid, _jur, onToken?: (d: string) => void) => {
      onToken?.('Hel');
      onToken?.('lo');
      return { id: 'srv_1', role: 'assistant', kind: 'text', text: 'Hello' };
    });

    useChatStore.getState().sendMessage('hi');
    // Let the async send + throttled paint (~50ms) settle.
    await new Promise((r) => setTimeout(r, 120));

    const assistant = useChatStore.getState().messages.find((m) => m.role === 'assistant');
    expect(assistant?.id).toBe('srv_1'); // adopted the persisted id (for thumbs rating)
    expect(assistant?.text).toBe('Hello'); // authoritative final text
    expect(assistant?.streaming).toBeFalsy(); // no bubble left stuck streaming
    // The streaming path is taken: an onToken callback is passed through.
    expect(mockSend).toHaveBeenCalledWith('s_live', 'hi', undefined, expect.anything(), expect.any(Function));
  });

  it('a mid-stream failure shows an honest error, not a half-written answer', async () => {
    const mockSend = chatsApi.sendMessage as ReturnType<typeof vi.fn>;
    mockSend.mockImplementation(async (_sid, _text, _aid, _jur, onToken?: (d: string) => void) => {
      onToken?.('Partial legal ans');
      throw new Error('stream broke');
    });

    useChatStore.getState().sendMessage('hi');
    await new Promise((r) => setTimeout(r, 120));

    const assistant = useChatStore.getState().messages.find((m) => m.role === 'assistant');
    // The partial text was replaced by the honest error message (never a
    // half-written legal answer masquerading as complete).
    expect(assistant?.text).not.toContain('Partial legal ans');
  });
});
