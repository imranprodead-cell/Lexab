// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

// USE_MOCK must be false so loadSession talks to the (mocked) HTTP api layer.
vi.mock('@/api', () => ({
  USE_MOCK: false,
  analysisApi: { get: vi.fn(), saveDocument: vi.fn().mockResolvedValue(undefined), analyze: vi.fn() },
  // Флоу «новый договор в деле»: в этих тестах ключа нет — потребление даёт null,
  // documentsApi не дёргается (adoptDocIntoProject выходит на пустом projectId).
  consumePendingProject: () => null,
  documentsApi: { assignProject: vi.fn().mockResolvedValue(undefined) },
}));
vi.mock('@/api/chats.api', () => ({
  chatsApi: {
    messages: vi.fn(),
    create: vi.fn(),
    sendMessage: vi.fn(),
    sendGhostMessage: vi.fn(),
    linkAnalysis: vi.fn().mockResolvedValue(undefined),
    setFeedback: vi.fn(),
    remove: vi.fn().mockResolvedValue(undefined),
  },
}));
// Загрузка отвечает как сервер — с id: анализ идёт именно по этой загрузке.
vi.mock('@/api/uploads.api', () => ({
  uploadsApi: {
    upload: vi.fn(async (file: File) => ({ id: `up_${file.name}`, fileName: file.name, fileSize: '1 KB' })),
    uploadPhotos: vi.fn(),
  },
}));
// Боковая панель чатов: addSession — «создать чат под новый договор».
const history = vi.hoisted(() => ({ load: vi.fn(), addSession: vi.fn() }));
vi.mock('@/store/useChatHistoryStore', () => ({
  useChatHistoryStore: { getState: () => history },
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
    // rawFile обязателен вне мока: анализ без файла запрещён (фикс «Повторить»)
    void useChatStore.getState().startAnalysis({ name: 'contract.pdf', size: '2 KB' }, new File(['x'], 'contract.pdf'));
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
    void useChatStore.getState().startAnalysis({ name: 'contract.pdf', size: '2 KB' }, new File(['x'], 'contract.pdf'));
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
    void useChatStore.getState().startAnalysis({ name: 'NDA.txt', size: '1 KB' }, new File(['Текст соглашения.'], 'NDA.txt'), { keepCanvas: true });
    const s = useChatStore.getState();
    expect(s.phase).toBe('analyzing');
    expect(s.analysis).not.toBeNull(); // документ НЕ пропал с экрана
    expect(s.analysis?.id).toBe('draft_st_2');
  });
});

describe('chat store — фото страниц договора', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useChatStore.setState({
      phase: 'idle', messages: [], analysis: null, activeStep: -1, error: null,
      serverSessionId: null, sessionLoading: false, ghost: false,
    });
  });

  it('фото уходят одной загрузкой, анализ идёт по её номеру, «Повторить» не грузит снимки второй раз', async () => {
    const { uploadsApi } = await import('@/api/uploads.api');
    const mockPhotos = uploadsApi.uploadPhotos as ReturnType<typeof vi.fn>;
    const mockAnalyze = (analysisApi as unknown as { analyze: ReturnType<typeof vi.fn> }).analyze;
    mockPhotos.mockResolvedValue({ id: 'up_ph1', fileName: 'Фото договора 1.pdf', fileSize: '120 KB' });
    mockAnalyze
      .mockRejectedValueOnce(new Error('model down'))
      .mockResolvedValueOnce({ ...ANALYSIS, id: 'an_ph', fileName: 'Фото договора 1.pdf', scanOcr: 'pending' });
    const photos = [new File(['a'], 'IMG_1.jpg', { type: 'image/jpeg' }), new File(['b'], 'IMG_2.heic')];
    const file = { name: 'Фото договора 1.pdf', size: 'Фото: 2' };

    await useChatStore.getState().startAnalysis(file, undefined, { photos });
    expect(mockPhotos).toHaveBeenCalledWith(photos, 'Фото договора 1.pdf');
    expect(mockAnalyze.mock.calls[0][0]).toMatchObject({ fileName: 'Фото договора 1.pdf', fileSize: '120 KB', uploadId: 'up_ph1' });
    expect(useChatStore.getState().phase).toBe('error');

    // «Повторить» с карточки ошибки приходит без файлов — берётся уже загруженный PDF.
    await useChatStore.getState().startAnalysis(file);
    expect(mockPhotos).toHaveBeenCalledTimes(1);
    expect(mockAnalyze.mock.calls[1][0]).toMatchObject({ uploadId: 'up_ph1' });
    expect(useChatStore.getState().phase).toBe('analyzed');
    expect(useChatStore.getState().analysis?.scanOcr).toBe('pending');
  });

  it('отказ тарифа при загрузке фото показывает настоящую причину, анализ не запускается', async () => {
    const { uploadsApi } = await import('@/api/uploads.api');
    const { ApiError } = await import('@/api/util');
    (uploadsApi.uploadPhotos as ReturnType<typeof vi.fn>).mockRejectedValue(
      new ApiError('…', 402, 'feature_locked', { feature: 'scans', plan: 'Free', plans: 'Standard, Pro и Business' }),
    );
    await useChatStore.getState().startAnalysis({ name: 'Фото 2.pdf', size: 'Фото: 1' }, undefined, { photos: [new File(['a'], 'a.jpg')] });
    const s = useChatStore.getState();
    expect(s.phase).toBe('error');
    expect(s.error).toMatch(/Standard, Pro и Business/);
    expect(analysisApi.analyze).not.toHaveBeenCalled();
  });
});

describe('chat store — файл договора', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useChatStore.setState({
      phase: 'idle', messages: [], analysis: null, activeStep: -1, error: null,
      serverSessionId: null, sessionLoading: false, ghost: false,
    });
  });

  it('анализ идёт по номеру ЭТОЙ загрузки, а «Повторить» не грузит файл второй раз', async () => {
    // Раньше номер загрузки выбрасывался, и сервер брал «последний файл с
    // таким именем» — при двух «Договор.pdf» мог разобрать не тот.
    const { uploadsApi } = await import('@/api/uploads.api');
    const mockUpload = uploadsApi.upload as ReturnType<typeof vi.fn>;
    const mockAnalyze = (analysisApi as unknown as { analyze: ReturnType<typeof vi.fn> }).analyze;
    mockUpload.mockResolvedValueOnce({ id: 'up_dogovor_1', fileName: 'Договор.pdf', fileSize: '2 KB' });
    mockAnalyze.mockRejectedValueOnce(new Error('model down')).mockResolvedValueOnce({ ...ANALYSIS, id: 'an_doc', fileName: 'Договор.pdf' });
    const raw = new File(['%PDF-1.4 contract'], 'Договор.pdf');
    const file = { name: 'Договор.pdf', size: '2 KB' };

    await useChatStore.getState().startAnalysis(file, raw);
    expect(mockUpload).toHaveBeenCalledTimes(1);
    expect(mockAnalyze.mock.calls[0][0]).toMatchObject({ fileName: 'Договор.pdf', uploadId: 'up_dogovor_1' });
    expect(useChatStore.getState().phase).toBe('error');

    // «Повторить» с карточки ошибки — та же загрузка, без новой копии файла.
    await useChatStore.getState().startAnalysis(file);
    expect(mockUpload).toHaveBeenCalledTimes(1);
    expect(mockAnalyze.mock.calls[1][0]).toMatchObject({ uploadId: 'up_dogovor_1' });
    expect(useChatStore.getState().phase).toBe('analyzed');
  });

  it('«Повторить» после ошибки у файла из облака — та же загрузка, а не одноимённый файл с компьютера', async () => {
    const { uploadsApi } = await import('@/api/uploads.api');
    const mockUpload = uploadsApi.upload as ReturnType<typeof vi.fn>;
    const mockAnalyze = (analysisApi as unknown as { analyze: ReturnType<typeof vi.fn> }).analyze;
    // Раньше прикрепляли «Договор.docx» с компьютера (старая версия)…
    mockUpload.mockResolvedValueOnce({ id: 'up_local_old', fileName: 'Договор.docx', fileSize: '1 KB' });
    mockAnalyze.mockResolvedValueOnce({ ...ANALYSIS, id: 'an_local', fileName: 'Договор.docx' });
    await useChatStore.getState().startAnalysis({ name: 'Договор.docx', size: '1 KB' }, new File(['old'], 'Договор.docx'));
    // …теперь — новая версия из Google Drive; её анализ сорвался.
    mockAnalyze.mockRejectedValueOnce(new Error('model down')).mockResolvedValueOnce({ ...ANALYSIS, id: 'an_cloud', fileName: 'Договор.docx' });
    const file = { name: 'Договор.docx', size: '2 KB' };
    await useChatStore.getState().startAnalysis(file, undefined, { uploadId: 'up_cloud_new' });
    expect(useChatStore.getState().phase).toBe('error');
    mockUpload.mockClear();

    await useChatStore.getState().startAnalysis(file); // «Повторить» с карточки ошибки
    expect(mockUpload).not.toHaveBeenCalled(); // старый файл с компьютера не отправлен
    expect(mockAnalyze.mock.calls[mockAnalyze.mock.calls.length - 1][0]).toMatchObject({ uploadId: 'up_cloud_new' });
    expect(useChatStore.getState().analysis?.id).toBe('an_cloud');
  });

  it('сервер отказал по существу (например, .doc под паролем) — человек видит причину, а не общее «не загрузилось»', async () => {
    const { uploadsApi } = await import('@/api/uploads.api');
    const { ApiError } = await import('@/api/util');
    (uploadsApi.upload as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new ApiError('Файл .doc защищён паролем — снимите пароль в Word или сохраните документ без пароля как .docx.', 400),
    );
    await useChatStore.getState().startAnalysis({ name: 'Секретный.doc', size: '20 KB' }, new File(['x'], 'Секретный.doc'));
    expect(useChatStore.getState().phase).toBe('error');
    expect(useChatStore.getState().error).toMatch(/защищён паролем/);
    expect(analysisApi.analyze).not.toHaveBeenCalled();
  });
});

describe('chat store — новый договор в уже открытом чате', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useChatStore.setState({
      phase: 'analyzed',
      // Открыт старый чат со своим договором.
      messages: [{ id: 'old_f', role: 'user', kind: 'file', file: { name: 'Старый.pdf', size: '1 KB' } }],
      analysis: { ...ANALYSIS, id: 'an_old', fileName: 'Старый.pdf' } as AnalysisResult,
      activeStep: -1, error: null, serverSessionId: 's_old', sessionLoading: false, ghost: false,
    });
  });

  it('разбор привязывается к НОВОМУ чату, даже если тот создаётся дольше анализа', async () => {
    // Раньше: анализ брал «текущий» чат (старый), пока новый ещё создавался, —
    // и в старом чате оказывался разбор чужого договора.
    let createSession!: (s: { id: string; title: string; updatedAt: string }) => void;
    history.addSession.mockReturnValueOnce(new Promise((r) => { createSession = r; }));
    const mockAnalyze = (analysisApi as unknown as { analyze: ReturnType<typeof vi.fn> }).analyze;
    mockAnalyze.mockResolvedValueOnce({ ...ANALYSIS, id: 'an_new', fileName: 'Новый.pdf' });

    const run = useChatStore.getState().startAnalysis({ name: 'Новый.pdf', size: '2 KB' }, new File(['x'], 'Новый.pdf'), { newSession: true });
    expect(useChatStore.getState().serverSessionId).toBeNull(); // старый чат больше не «текущий»
    await new Promise((r) => setTimeout(r, 5)); // анализ уже готов, чат ещё создаётся
    createSession({ id: 's_new', title: 'Новый', updatedAt: '' });
    await run;

    const linked = (chatsApi.linkAnalysis as ReturnType<typeof vi.fn>).mock.calls;
    expect(linked.some(([sid]) => sid === 's_old')).toBe(false);
    expect(linked.some(([sid, an]) => sid === 's_new' && an === 'an_new')).toBe(true);
    expect(useChatStore.getState().serverSessionId).toBe('s_new');
    expect(useChatStore.getState().analysis?.id).toBe('an_new');
  });

  it('загрузка сорвалась раньше, чем создан чат, — пустой чат удаляется, а не висит в панели', async () => {
    let createSession!: (s: { id: string; title: string; updatedAt: string }) => void;
    history.addSession.mockReturnValueOnce(new Promise((r) => { createSession = r; }));
    const { uploadsApi } = await import('@/api/uploads.api');
    (uploadsApi.upload as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('offline'));

    const run = useChatStore.getState().startAnalysis({ name: 'Сбой.pdf', size: '2 KB' }, new File(['x'], 'Сбой.pdf'), { newSession: true });
    await new Promise((r) => setTimeout(r, 5));
    createSession({ id: 's_dead', title: 'Сбой', updatedAt: '' });
    await run;

    expect(chatsApi.remove).toHaveBeenCalledWith('s_dead');
    expect(chatsApi.remove).not.toHaveBeenCalledWith('s_old');
    expect(useChatStore.getState().phase).toBe('error');
    expect(useChatStore.getState().serverSessionId).toBeNull();
  });

  it('отмена до того, как чат создан, — чат удаляется, когда появится', async () => {
    let createSession!: (s: { id: string; title: string; updatedAt: string }) => void;
    history.addSession.mockReturnValueOnce(new Promise((r) => { createSession = r; }));
    const mockAnalyze = (analysisApi as unknown as { analyze: ReturnType<typeof vi.fn> }).analyze;
    mockAnalyze.mockReturnValueOnce(new Promise(() => undefined)); // анализ «идёт»

    void useChatStore.getState().startAnalysis({ name: 'Отмена.pdf', size: '2 KB' }, new File(['x'], 'Отмена.pdf'), { newSession: true });
    await new Promise((r) => setTimeout(r, 5));
    useChatStore.getState().cancelAnalysis();
    createSession({ id: 's_cancelled', title: 'Отмена', updatedAt: '' });
    await new Promise((r) => setTimeout(r, 5));

    expect(chatsApi.remove).toHaveBeenCalledWith('s_cancelled');
    expect(useChatStore.getState().serverSessionId).toBeNull();
  });
});

describe('chat store — создание чата повисло в сети', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useChatStore.setState({
      phase: 'idle', messages: [], analysis: null, activeStep: -1, error: null,
      serverSessionId: null, sessionLoading: false, ghost: false,
    });
  });

  it('анализ упал — ошибка видна через 15 с, а не никогда; опоздавший пустой чат удаляется', async () => {
    vi.useFakeTimers();
    try {
      let createSession!: (s: { id: string; title: string; updatedAt: string }) => void;
      history.addSession.mockReturnValueOnce(new Promise((r) => { createSession = r; }));
      const mockAnalyze = (analysisApi as unknown as { analyze: ReturnType<typeof vi.fn> }).analyze;
      mockAnalyze.mockRejectedValueOnce(new Error('model down'));
      const run = useChatStore.getState().startAnalysis({ name: 'Висит.pdf', size: '1 KB' }, new File(['x'], 'Висит.pdf'), { newSession: true });
      await vi.advanceTimersByTimeAsync(15_000);
      await run;
      expect(useChatStore.getState().phase).toBe('error');
      createSession({ id: 's_late', title: 'Висит', updatedAt: '' });
      await vi.advanceTimersByTimeAsync(10);
      expect(chatsApi.remove).toHaveBeenCalledWith('s_late');
    } finally {
      vi.useRealTimers();
    }
  });

  it('анализ удался — результат виден, а привязка к чату — когда тот наконец создан', async () => {
    vi.useFakeTimers();
    try {
      let createSession!: (s: { id: string; title: string; updatedAt: string }) => void;
      history.addSession.mockReturnValueOnce(new Promise((r) => { createSession = r; }));
      const mockAnalyze = (analysisApi as unknown as { analyze: ReturnType<typeof vi.fn> }).analyze;
      mockAnalyze.mockResolvedValueOnce({ ...ANALYSIS, id: 'an_slow_session', fileName: 'Медленно.pdf' });
      const run = useChatStore.getState().startAnalysis({ name: 'Медленно.pdf', size: '1 KB' }, new File(['x'], 'Медленно.pdf'), { newSession: true });
      await vi.advanceTimersByTimeAsync(15_000);
      await run;
      expect(useChatStore.getState().phase).toBe('analyzed');
      expect(useChatStore.getState().analysis?.id).toBe('an_slow_session');
      createSession({ id: 's_slow', title: 'Медленно', updatedAt: '' });
      await vi.advanceTimersByTimeAsync(10);
      const linked = (chatsApi.linkAnalysis as ReturnType<typeof vi.fn>).mock.calls;
      expect(linked.some(([sid, an]) => sid === 's_slow' && an === 'an_slow_session')).toBe(true);
      expect(useChatStore.getState().serverSessionId).toBe('s_slow');
    } finally {
      vi.useRealTimers();
    }
  });
});
