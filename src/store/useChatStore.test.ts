// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

// USE_MOCK must be false so loadSession talks to the (mocked) HTTP api layer.
vi.mock('@/api', () => ({
  USE_MOCK: false,
  analysisApi: { get: vi.fn(), saveDocument: vi.fn().mockResolvedValue(undefined), analyze: vi.fn() },
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
import type { AnalysisResult, DocBlock } from '@/types/domain';
import { draftBlocksToText, useChatStore } from './useChatStore';

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
    expect(mockSend).toHaveBeenCalledWith('s_live', 'hi', undefined, expect.anything(), expect.any(Function), undefined);
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

describe('chat store — editor toggles & document undo/redo', () => {
  const baseDoc: DocBlock[] = [{ type: 'paragraph', segments: ['original'] }];
  const analysisWith = (doc: DocBlock[]): AnalysisResult => ({
    id: 'an_ed', fileName: 'D.pdf', fileSize: '1 KB', summary: '', riskScore: 10, riskLevel: 'Low',
    clausesReviewed: 1, findings: [], redlines: [], document: doc, canEdit: true,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    useChatStore.setState({
      phase: 'analyzed', messages: [], analysis: analysisWith(baseDoc), activeStep: -1, error: null,
      serverSessionId: null, sessionLoading: false, ghost: false, showEdits: true, docUndo: [], docRedo: [],
    });
  });

  it('toggleShowEdits flips the flag', () => {
    expect(useChatStore.getState().showEdits).toBe(true);
    useChatStore.getState().toggleShowEdits();
    expect(useChatStore.getState().showEdits).toBe(false);
  });

  it('updateDocument records an undo snapshot; undo/redo restore the blocks', () => {
    const edited = [{ type: 'paragraph' as const, segments: ['edited'] }];
    useChatStore.getState().updateDocument(edited);
    expect(useChatStore.getState().analysis?.document).toEqual(edited);
    expect(useChatStore.getState().docUndo.length).toBe(1);
    expect(useChatStore.getState().docRedo.length).toBe(0);

    useChatStore.getState().undoDocument();
    expect(useChatStore.getState().analysis?.document).toEqual(baseDoc);
    expect(useChatStore.getState().docUndo.length).toBe(0);
    expect(useChatStore.getState().docRedo.length).toBe(1);

    useChatStore.getState().redoDocument();
    expect(useChatStore.getState().analysis?.document).toEqual(edited);
    expect(useChatStore.getState().docRedo.length).toBe(0);
  });

  it('retires a pending redline only when its slot is gone; a bold run is not a slot', () => {
    const withRedline = () => ({
      ...analysisWith(baseDoc),
      redlines: [{ id: 'r1', delText: 'a', insText: 'b', severity: 'Low' as const, status: 'pending' as const }],
    });
    // Edit KEEPS the slot (plus a bold run) → r1 stays. The run must not be
    // treated as a slot (it has no redlineId).
    useChatStore.setState({ analysis: withRedline(), docUndo: [], docRedo: [] });
    useChatStore.getState().updateDocument([
      { type: 'paragraph', segments: [{ text: 'bold', marks: ['b'] }, { redlineId: 'r1' }] },
    ]);
    expect(useChatStore.getState().analysis?.redlines.find((r) => r.id === 'r1')).toBeTruthy();

    // Edit DROPS the slot (only a bold run remains) → r1 is retired.
    useChatStore.setState({ analysis: withRedline(), docUndo: [], docRedo: [] });
    useChatStore.getState().updateDocument([{ type: 'paragraph', segments: [{ text: 'bold', marks: ['b'] }] }]);
    expect(useChatStore.getState().analysis?.redlines.find((r) => r.id === 'r1')).toBeFalsy();
  });

  it('undo restores BOTH the blocks and the redlines (no resurrected dangling slot)', () => {
    // A doc with a pending redline r1 referenced by a slot.
    const docWithSlot: DocBlock[] = [{ type: 'paragraph', segments: ['Term: ', { redlineId: 'r1' }, '.'] }];
    useChatStore.setState({
      analysis: {
        ...analysisWith(docWithSlot),
        redlines: [{ id: 'r1', delText: '30 days', insText: '60 days', severity: 'Low', status: 'pending' }],
      },
      docUndo: [], docRedo: [],
    });
    // Edit removes the slot → r1 is retired from redlines.
    useChatStore.getState().updateDocument([{ type: 'paragraph', segments: ['Term: 30 days.'] }]);
    expect(useChatStore.getState().analysis?.redlines.length).toBe(0);
    // Undo must bring BACK r1 alongside the slot — not leave a dangling slot.
    useChatStore.getState().undoDocument();
    const s = useChatStore.getState();
    expect(s.analysis?.document).toEqual(docWithSlot);
    expect(s.analysis?.redlines.find((r) => r.id === 'r1')).toBeTruthy();
  });
});

describe('chat store — template draft in the workspace', () => {
  it('adoptDraft opens an editable draft with heading/paragraph blocks and no findings', () => {
    useChatStore.getState().adoptDraft({
      id: 'st_1',
      title: 'Договор поставки',
      content: 'ДОГОВОР ПОСТАВКИ\n\n1. Предмет договора\n\nПоставщик обязуется поставить товар в срок.',
    });
    const s = useChatStore.getState();
    expect(s.draftSource?.savedTemplateId).toBe('st_1');
    expect(s.analysis?.canEdit).toBe(true); // правки сохраняются в сам шаблон
    expect(s.analysis?.findings).toEqual([]);
    const types = (s.analysis?.document ?? []).map((b) => b.type);
    expect(types).toEqual(['heading', 'heading', 'paragraph']); // CAPS + «1. …» → заголовки
  });

  it('draftBlocksToText round-trips the draft text and flattens inline formatting', () => {
    const content = 'ДОГОВОР ПОСТАВКИ\n\n1. Предмет договора\n\nПоставщик обязуется поставить товар в срок.';
    useChatStore.getState().adoptDraft({ id: 'st_rt', title: 'Договор', content });
    const doc = useChatStore.getState().analysis!.document;
    expect(draftBlocksToText(doc)).toBe(content); // блоки ↔ текст без потерь
    // Жирный TextRun сплющивается в обычный текст (шаблон хранится как plain text).
    expect(draftBlocksToText([{ type: 'paragraph', segments: ['Срок: ', { text: '30 дней', marks: ['b'] }] }]))
      .toBe('Срок: 30 дней');
  });

  it('a background-finished analysis restores its file bubble instead of hiding behind the welcome screen', async () => {
    // Гонка: анализ в полёте → пользователь ушёл в другой чат и вернулся
    // (loadSession стёр локальный пузырёк — сервер ещё не знает об анализе) →
    // анализ завершился. Раньше: analyzed без сообщений → приветствие прячет результат.
    const mockAnalyze = (analysisApi as unknown as { analyze: ReturnType<typeof vi.fn> }).analyze;
    let resolveAnalyze!: (v: unknown) => void;
    mockAnalyze.mockReturnValue(new Promise((r) => { resolveAnalyze = r; }));
    (chatsApi.messages as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    useChatStore.setState({ serverSessionId: 's1' });
    void useChatStore.getState().startAnalysis({ name: 'contract.pdf', size: '2 KB' });
    await new Promise((r) => setTimeout(r, 5));
    expect(useChatStore.getState().phase).toBe('analyzing');

    await useChatStore.getState().loadSession('s2'); // ушёл в другой чат
    await useChatStore.getState().loadSession('s1'); // вернулся; сервер отдал 0 сообщений
    expect(useChatStore.getState().messages).toEqual([]); // пузырёк стёрт — фон гонки

    resolveAnalyze({ id: 'an_bg', fileName: 'contract.pdf', fileSize: '2 KB', summary: 's',
      riskScore: 40, riskLevel: 'Low', clausesReviewed: 1, findings: [], redlines: [], document: [] });
    await new Promise((r) => setTimeout(r, 20));
    const s = useChatStore.getState();
    expect(s.phase).toBe('analyzed');
    expect(s.analysis?.id).toBe('an_bg'); // результат усыновлён
    expect(s.messages.some((m) => m.kind === 'file')).toBe(true); // пузырёк вернулся — не приветствие
  });

  it('reverse ordering: a late stage-1 response does not wipe the adopted analysis canvas', async () => {
    // Усыновление успело вернуть пузырёк ДО того, как сервер ответил «сообщений
    // нет» (linkAnalysis ещё в пути) — пустой список не должен стереть канвас.
    const mockAnalyze = (analysisApi as unknown as { analyze: ReturnType<typeof vi.fn> }).analyze;
    let resolveAnalyze!: (v: unknown) => void;
    mockAnalyze.mockReturnValue(new Promise((r) => { resolveAnalyze = r; }));
    let resolveS1!: (v: unknown) => void;
    (chatsApi.messages as ReturnType<typeof vi.fn>).mockImplementation((sid: string) =>
      sid === 's1' ? new Promise((r) => { resolveS1 = r; }) : Promise.resolve([]));

    useChatStore.setState({ serverSessionId: 's1' });
    void useChatStore.getState().startAnalysis({ name: 'contract.pdf', size: '2 KB' });
    await new Promise((r) => setTimeout(r, 5));
    await useChatStore.getState().loadSession('s2'); // ушёл
    const returning = useChatStore.getState().loadSession('s1'); // вернулся; ответ сервера завис
    await new Promise((r) => setTimeout(r, 5));
    resolveAnalyze({ id: 'an_rev', fileName: 'contract.pdf', fileSize: '2 KB', summary: 's',
      riskScore: 40, riskLevel: 'Low', clausesReviewed: 1, findings: [], redlines: [], document: [] });
    await new Promise((r) => setTimeout(r, 10));
    resolveS1([]); // сервер наконец ответил: пусто
    await returning;
    const s = useChatStore.getState();
    expect(s.analysis?.id).toBe('an_rev');
    expect(s.messages.some((m) => m.kind === 'file')).toBe(true); // канвас не стёрт
    expect(s.phase).toBe('analyzed');
  });

  it('enterGhost over a half-loaded chat does not resurrect the stale session id', () => {
    // Скелетон ещё ждал сообщений — его fetch убьёт смена эпохи; восстановленный
    // id вёл бы в «невидимую» сессию (сообщения уходят в чат, которого не видно).
    useChatStore.setState({ serverSessionId: 's_half', sessionLoading: true, phase: 'idle', messages: [] });
    useChatStore.getState().enterGhost();
    useChatStore.getState().exitGhost();
    const s = useChatStore.getState();
    expect(s.serverSessionId).toBeNull();
    expect(s.sessionLoading).toBe(false);
  });

  it('ghost mode round-trip preserves the template-draft canvas and error text', () => {
    useChatStore.getState().adoptDraft({ id: 'st_g', title: 'NDA', content: 'Текст соглашения.' });
    useChatStore.setState({ phase: 'error', error: 'Понятная ошибка' });
    useChatStore.getState().enterGhost();
    expect(useChatStore.getState().draftSource).toBeNull(); // в госте канвас чистый
    useChatStore.getState().exitGhost();
    const s = useChatStore.getState();
    expect(s.draftSource?.savedTemplateId).toBe('st_g'); // кнопки черновика вернулись
    expect(s.analysis?.id).toBe('draft_st_g');
    expect(s.error).toBe('Понятная ошибка'); // текст ошибки не деградировал
  });

  it('sendMessage grounds a draft question in the template text, not a phantom analysis id', async () => {
    const mockCreate = chatsApi.create as ReturnType<typeof vi.fn>;
    const mockSend = chatsApi.sendMessage as ReturnType<typeof vi.fn>;
    mockCreate.mockResolvedValue({ id: 's_draft' });
    mockSend.mockResolvedValue({ id: 'm_reply', role: 'assistant', kind: 'text', text: 'Срок — 30 дней.' });
    useChatStore.getState().adoptDraft({ id: 'st_q', title: 'NDA', content: 'Пункт 2. Срок — 30 дней.' });
    useChatStore.getState().sendMessage('Какой срок в пункте 2?');
    await new Promise((r) => setTimeout(r, 20));
    const call = mockSend.mock.calls[0];
    expect(call[2]).toBeUndefined(); // id draft_… на сервер не едет
    expect(call[5]).toEqual({ title: 'NDA', content: 'Пункт 2. Срок — 30 дней.' }); // едет сам текст
  });

  it('adoptDraft clears a stuck sessionLoading from an abandoned loadSession', () => {
    // Гонка: открыли несохранённый чат (скелетон), не дождались и открыли шаблон.
    useChatStore.setState({ sessionLoading: true });
    useChatStore.getState().adoptDraft({ id: 'st_race', title: 'NDA', content: 'Текст.' });
    expect(useChatStore.getState().sessionLoading).toBe(false); // не вечный скелетон
  });

  it('updateDraftContent keeps download/copy/analyze in sync with edits', () => {
    useChatStore.getState().adoptDraft({ id: 'st_upd', title: 'NDA', content: 'Старый текст.' });
    useChatStore.getState().updateDraftContent('Новый текст.');
    expect(useChatStore.getState().draftSource?.content).toBe('Новый текст.');
  });

  it('startAnalysis with keepCanvas keeps the draft on screen while analyzing', async () => {
    useChatStore.getState().adoptDraft({ id: 'st_2', title: 'NDA', content: 'Текст соглашения.' });
    // Реальный анализ подменён вечным промисом — ловим состояние «в процессе».
    const { analysisApi: api } = (await vi.importMock('@/api')) as { analysisApi: Record<string, ReturnType<typeof vi.fn>> };
    api.analyze = vi.fn().mockReturnValue(new Promise(() => undefined));
    void useChatStore.getState().startAnalysis({ name: 'NDA.txt', size: '1 KB' }, undefined, { keepCanvas: true });
    const s = useChatStore.getState();
    expect(s.phase).toBe('analyzing');
    expect(s.analysis).not.toBeNull(); // документ НЕ пропал с экрана
    expect(s.analysis?.id).toBe('draft_st_2');
  });
});
