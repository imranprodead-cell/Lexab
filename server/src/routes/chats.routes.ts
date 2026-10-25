/**
 * GET /chats | POST /chats | GET /chats/:id/messages | POST /chats/:id/messages
 *
 * POST …/messages supports two response modes:
 *  - `Accept: text/event-stream` → SSE: `step` events while the server works
 *    (files read, statute search with its queries and hits — ChatStep), then
 *    `token` events with text deltas, then a final `done` event carrying the
 *    persisted assistant ChatMessage.
 *  - otherwise → plain JSON: the full assistant ChatMessage.
 */
import type { FastifyInstance } from 'fastify';
import type { Db } from '../db.ts';
import { badRequest, HttpError, notFound } from '../lib/errors.ts';
import { audit } from '../lib/audit.ts';
import { decJsonFromJsonb, decText, decTextStrict, encText } from '../lib/docCrypto.ts';
import { bumpUsage, planHasFeature, releaseAiRequest, reserveAiRequest } from '../lib/limits.ts';
import { readableUploadText, startScanOcr, type OcrStatus } from '../lib/ocr.ts';
import { resolveAnalysisAccess } from '../lib/teamAccess.ts';
import { toIso } from '../lib/format.ts';
import { newId } from '../lib/ids.ts';
import { openSSE, wantsSSE, type SseChannel } from '../lib/sse.ts';
import { asObject, requireString } from '../lib/validate.ts';
import { generateChatReply, generateHistorySummary, readsScans, type ChatTurn } from '../llm.ts';
import { jurisdictionCode, retrieveLegalContext } from '../rag/retrieve.ts';
import type { ChatMessage, ChatSession, ChatStep } from '../types.ts';
import { parseChatMode } from '../lib/chatModes.ts';
import {
  buildAttachmentsContext,
  loadOwnAttachments,
  parseUploadIds,
  readAttachmentsColumn,
  sessionAttachments,
} from '../lib/chatAttachments.ts';

/** Same per-user throttle as the other AI routes (analysis, compare). */
const RATE_LIMIT = { rateLimit: { max: 10, timeWindow: '1 minute' } };

interface SessionRow {
  id: string;
  title: string;
  updated_at: Date | string;
  pinned?: boolean;
  archived?: boolean;
}

function toSession(r: SessionRow): ChatSession {
  return {
    id: r.id,
    title: r.title,
    updatedAt: toIso(r.updated_at),
    pinned: Boolean(r.pinned),
    archived: Boolean(r.archived),
  };
}

/** The session title is the user's own words (first message / file name), so it
 *  is encrypted at rest like the messages. Decrypt each row for the wire. */
async function toSessionDecrypted(db: Db, userId: string, r: SessionRow): Promise<ChatSession> {
  const title = (await decText(db, userId, r.title)) ?? r.title;
  return toSession({ ...r, title });
}

/** Contract context for document Q&A: summary + clause text with redline state.
 *  Exported for the prompt-equality test (encryption must not change one byte
 *  of what the model receives). `opts.plan` (тариф, по которому идёт чат)
 *  разрешает запустить распознавание старого скана, у которого текста нет. */
export async function buildAnalysisContext(
  db: Db,
  userId: string,
  analysisId: string,
  opts: { plan?: string; log?: (msg: string) => void } = {},
): Promise<string | undefined> {
  // Owner or team member with read access to the shared document.
  try {
    await resolveAnalysisAccess(db, userId, analysisId);
  } catch {
    return undefined;
  }
  const res = await db.query<{ user_id: string; file_name: string; summary: string; document_blocks: unknown; upload_id: string | null }>(
    'SELECT user_id, file_name, summary, document_blocks, upload_id FROM analyses WHERE id = $1',
    [analysisId],
  );
  const row = res.rows[0];
  if (!row) return undefined;
  // Encrypted values are keyed by the analysis OWNER (row.user_id), so shared
  // documents decrypt for teammates too. Decryption happens HERE — before the
  // context string is assembled — so the model input is byte-identical.
  const ownerId = row.user_id;
  const summary = await decText(db, ownerId, row.summary);
  const rawBlocks = (await decJsonFromJsonb(db, ownerId, row.document_blocks)) as
    | { type: string; text?: string; segments?: (string | { redlineId: string } | { text: string })[] }[]
    | null;
  if (summary === null || rawBlocks === null) {
    throw new HttpError(500, 'Document cannot be decrypted — data key mismatch');
  }

  const redlines = await db.query<{ id: string; del_text: string; ins_text: string; status: string }>(
    'SELECT id, del_text, ins_text, status FROM redlines WHERE analysis_id = $1 ORDER BY ord',
    [analysisId],
  );
  const byId = new Map<string, { del_text: string; ins_text: string; status: string }>();
  for (const r of redlines.rows) {
    const delText = await decText(db, ownerId, r.del_text);
    const insText = await decText(db, ownerId, r.ins_text);
    if (delText === null || insText === null) throw new HttpError(500, 'Document cannot be decrypted — data key mismatch');
    byId.set(r.id, { del_text: delText, ins_text: insText, status: r.status });
  }

  const clauses = rawBlocks
    .map((b) => {
      if (b.type === 'heading') return `\n## ${b.text ?? ''}`;
      return (b.segments ?? [])
        .map((seg) => {
          if (typeof seg === 'string') return seg;
          // Оформленный фрагмент ручной правки (жирный, ссылка) — это текст
          // юриста, а не слот правки ИИ: раньше он молча выпадал из контекста.
          if (!('redlineId' in seg)) return seg.text;
          const rl = byId.get(seg.redlineId);
          return rl ? (rl.status === 'accepted' ? rl.ins_text : rl.del_text) : '';
        })
        .join('');
    })
    .join('\n');

  // Full source text when we still have the uploaded file's extraction. Use the
  // EXACT upload this analysis was built from (upload_id) so "translate the whole
  // contract" grounds in the right file even when two uploads share a name; fall
  // back to newest-by-name for legacy analyses without a link.
  // Поиск по имени — только для старых разборов ДОГОВОРА (у них есть правки):
  // у договора, созданного по запросу, файла нет, и одноимённая загрузка
  // подсунула бы чату чужой текст как «полный текст договора».
  const upload = row.upload_id
    ? await db.query<{ id: string; extracted_text: string | null; ocr_status: OcrStatus | null }>(
        'SELECT id, extracted_text, ocr_status FROM uploads WHERE id = $1 AND user_id = $2',
        [row.upload_id, row.user_id],
      )
    : redlines.rows.length
      ? await db.query<{ id: string; extracted_text: string | null; ocr_status: OcrStatus | null }>(
          'SELECT id, extracted_text, ocr_status FROM uploads WHERE user_id = $1 AND file_name = $2 ORDER BY created_at DESC LIMIT 1',
          [row.user_id, row.file_name],
        )
      : { rows: [] as { id: string; extracted_text: string | null; ocr_status: OcrStatus | null }[] };
  // Present-but-undecryptable text must throw, not silently drop the "Full
  // contract text" block from the grounding context.
  const rawFull = upload.rows[0]?.extracted_text ?? null;
  const decryptedFull = rawFull === null ? null : await decTextStrict(db, ownerId, rawFull);
  // Пометки страниц старого многостраничного скана — не текст договора: без
  // этого чат принимал их за «полный текст» и распознавание не запускалось.
  const fullText = upload.rows[0]
    ? await readableUploadText(db, { id: upload.rows[0].id, fileName: row.file_name, stored: rawFull }, decryptedFull)
    : null;
  let ocrStatus = upload.rows[0]?.ocr_status ?? null;
  // Скан, разобранный до появления распознавания (или прошлый сбой): запускаем
  // сейчас — этот ответ ещё без полного текста, следующий уже с ним.
  if (!fullText && row.upload_id && opts.plan && planHasFeature(opts.plan, 'scans') && readsScans(opts.plan)) {
    if (await startScanOcr(db, row.upload_id, { log: opts.log })) ocrStatus = 'pending';
  }

  return [
    `File: ${row.file_name}`,
    `AI review summary: ${summary}`,
    `Key clauses (with accepted redlines applied):${clauses}`,
    // Явный маркер отсутствия полного текста: без него модель на «переведи
    // договор» достраивает недостающие клаузы из головы.
    fullText
      ? ocrStatus === 'done'
        ? // Текст переписан ИИ со скана: ошибка в цифре или фамилии возможна,
          // и человек должен знать это до того, как понесёт цитату дальше.
          `Full contract text — recognized by AI from a scanned or photographed document, so it may contain recognition errors. When you quote it, remind the user to check the quote against the original scan:\n${fullText}`
        : `Full contract text:\n${fullText}`
      : ocrStatus === 'pending'
        ? 'FULL CONTRACT TEXT IS STILL BEING RECOGNIZED FROM THE SCAN — only the reviewed key clauses above are available right now. If the question needs the whole contract, say the full text will be ready in about a minute; never invent missing clauses.'
        : 'FULL CONTRACT TEXT UNAVAILABLE — only the reviewed key clauses above are available. Say so if asked to translate or quote the whole contract; never invent missing clauses.',
  ]
    .filter(Boolean)
    .join('\n\n');
}

interface MessageRow {
  id: string;
  role: 'user' | 'assistant';
  kind: 'file' | 'text' | 'analysis';
  text: string | null;
  file_name: string | null;
  file_size: string | null;
  analysis_id: string | null;
  feedback?: 'up' | 'down' | null;
  attachments?: unknown;
  refs?: unknown;
}

function toChatMessage(row: MessageRow): ChatMessage {
  // Клиенту — только имя и размер: id загрузки нужен лишь серверу.
  const attachments = readAttachmentsColumn(row.attachments).map(({ name, size }) => ({ name, size }));
  const refs = readRefsColumn(row.refs);
  return {
    id: row.id,
    role: row.role,
    kind: row.kind,
    ...(row.text !== null ? { text: row.text } : {}),
    ...(row.file_name !== null ? { file: { name: row.file_name, size: row.file_size ?? '' } } : {}),
    ...(row.analysis_id !== null ? { analysisId: row.analysis_id } : {}),
    ...(row.feedback ? { feedback: row.feedback } : {}),
    ...(attachments.length ? { attachments } : {}),
    ...(refs.length ? { refs } : {}),
  };
}

export function chatRoutes(app: FastifyInstance, db: Db): void {
  app.get('/chats', { preHandler: [app.authenticate] }, async (req): Promise<ChatSession[]> => {
    const { archived } = req.query as { archived?: string };
    const res = await db.query<SessionRow>(
      `SELECT id, title, updated_at, pinned, archived FROM chat_sessions
       WHERE user_id = $1 AND archived = $2
       ORDER BY pinned DESC, updated_at DESC`,
      [req.currentUser.id, archived === 'true'],
    );
    return Promise.all(res.rows.map((r) => toSessionDecrypted(db, req.currentUser.id, r)));
  });

  app.post('/chats', { preHandler: [app.authenticate] }, async (req, reply): Promise<ChatSession> => {
    const body = asObject(req.body);
    const title = requireString(body, 'title', { min: 1, max: 300 });
    const id = newId('c');
    const res = await db.query<SessionRow>(
      `INSERT INTO chat_sessions (id, user_id, title) VALUES ($1, $2, $3)
       RETURNING id, title, updated_at, pinned, archived`,
      [id, req.currentUser.id, await encText(db, req.currentUser.id, title)],
    );
    reply.code(201);
    // RETURNING carries the ciphertext — respond with the plaintext title.
    return toSession({ ...res.rows[0], title });
  });

  // Rename / pin / archive.
  app.patch('/chats/:id', { preHandler: [app.authenticate] }, async (req): Promise<ChatSession> => {
    const { id } = req.params as { id: string };
    await requireSession(req.currentUser.id, id);
    const body = asObject(req.body);

    const sets: string[] = [];
    const params: unknown[] = [id];
    const title = body.title;
    if (title !== undefined) {
      if (typeof title !== 'string' || !title.trim()) throw badRequest('Field "title" must be a non-empty string');
      params.push(await encText(db, req.currentUser.id, title.trim().slice(0, 300)));
      sets.push(`title = $${params.length}`);
    }
    for (const flag of ['pinned', 'archived'] as const) {
      if (body[flag] !== undefined) {
        if (typeof body[flag] !== 'boolean') throw badRequest(`Field "${flag}" must be a boolean`);
        params.push(body[flag]);
        sets.push(`${flag} = $${params.length}`);
      }
    }
    if (!sets.length) throw badRequest('Nothing to update: pass title, pinned or archived');

    const res = await db.query<SessionRow>(
      `UPDATE chat_sessions SET ${sets.join(', ')} WHERE id = $1
       RETURNING id, title, updated_at, pinned, archived`,
      params,
    );
    return toSessionDecrypted(db, req.currentUser.id, res.rows[0]);
  });

  app.delete('/chats/:id', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    await requireSession(req.currentUser.id, id);
    await db.query('DELETE FROM chat_sessions WHERE id = $1', [id]);
    reply.code(204);
  });

  async function requireSession(userId: string, sessionId: string): Promise<SessionRow> {
    const res = await db.query<SessionRow>(
      'SELECT id, title, updated_at FROM chat_sessions WHERE id = $1 AND user_id = $2',
      [sessionId, userId],
    );
    const row = res.rows[0];
    if (!row) throw notFound('Chat session not found');
    return row;
  }

  /** Decrypt stored message texts (session owner's key) for the wire shape. */
  async function decryptMessages(userId: string, rows: MessageRow[]): Promise<ChatMessage[]> {
    const out: ChatMessage[] = [];
    for (const row of rows) {
      const text = await decText(db, userId, row.text);
      if (row.text !== null && text === null) {
        // Undecryptable message: skip it (never serve ciphertext) — loud in logs.
        console.error(`[chats] message ${row.id} cannot be decrypted — skipped`);
        continue;
      }
      out.push(toChatMessage({ ...row, text }));
    }
    return out;
  }

  // Отметки шагов одобренного плана (правая колонка «Progress»): какой ответ
  // ИИ — план и какие его шаги юрист отметил выполненными.
  app.get('/chats/:id/progress', { preHandler: [app.authenticate] }, async (req): Promise<PlanProgress | Record<string, never>> => {
    const { id } = req.params as { id: string };
    await requireSession(req.currentUser.id, id);
    const res = await db.query<{ plan_progress: unknown }>('SELECT plan_progress FROM chat_sessions WHERE id = $1', [id]);
    return readPlanProgress(res.rows[0]?.plan_progress) ?? {};
  });

  app.put('/chats/:id/progress', { preHandler: [app.authenticateReal] }, async (req): Promise<PlanProgress> => {
    const { id } = req.params as { id: string };
    await requireSession(req.currentUser.id, id);
    const body = asObject(req.body);
    const messageId = requireString(body, 'messageId', { min: 1, max: 60 });
    const done = body.done;
    if (!Array.isArray(done) || done.length > 50 || done.some((n) => !Number.isInteger(n) || (n as number) < 0 || (n as number) > 99)) {
      throw badRequest('done must be a list of step numbers (0–99)');
    }
    // Шаг — из ответа ЭТОГО чата: чужой id сохранять незачем.
    const msg = await db.query('SELECT 1 FROM chat_messages WHERE id = $1 AND session_id = $2 AND role = $3', [messageId, id, 'assistant']);
    if (!msg.rows.length) throw badRequest('Plan message not found in this chat');
    const progress: PlanProgress = { messageId, done: [...new Set(done as number[])].sort((a, b) => a - b) };
    await db.query('UPDATE chat_sessions SET plan_progress = $2::jsonb WHERE id = $1', [id, JSON.stringify(progress)]);
    return progress;
  });

  app.get('/chats/:id/messages', { preHandler: [app.authenticate] }, async (req): Promise<ChatMessage[]> => {
    const { id } = req.params as { id: string };
    await requireSession(req.currentUser.id, id);
    const res = await db.query<MessageRow>(
      `SELECT id, role, kind, text, file_name, file_size, analysis_id, feedback, attachments, refs
       FROM chat_messages WHERE session_id = $1 ORDER BY created_at`,
      [id],
    );
    const list = await decryptMessages(req.currentUser.id, res.rows);
    await resolveLegacyRefLinks(db, list).catch((err) => req.log.warn(err, 'legacy ref links failed'));
    return list;
  });

  // Link a finished analysis to the session so the summary card survives a
  // reopen: stores the file + analysis reference messages (no LLM call).
  app.post('/chats/:id/analysis-ref', { preHandler: [app.authenticate] }, async (req, reply): Promise<ChatMessage[]> => {
    const { id: sessionId } = req.params as { id: string };
    await requireSession(req.currentUser.id, sessionId);
    const body = asObject(req.body);
    const analysisId = requireString(body, 'analysisId', { min: 1, max: 60 });
    const a = await db.query<{ id: string; file_name: string; file_size: string }>(
      'SELECT id, file_name, file_size FROM analyses WHERE id = $1 AND user_id = $2',
      [analysisId, req.currentUser.id],
    );
    const analysis = a.rows[0];
    if (!analysis) throw notFound('Analysis not found');
    // Idempotent: the same analysis is linked to a session at most once.
    const existing = await db.query<{ id: string }>(
      `SELECT id FROM chat_messages WHERE session_id = $1 AND analysis_id = $2 LIMIT 1`,
      [sessionId, analysisId],
    );
    if (!existing.rows[0]) {
      await db.query(
        `INSERT INTO chat_messages (id, session_id, role, kind, file_name, file_size)
         VALUES ($1, $2, 'user', 'file', $3, $4)`,
        [newId('m'), sessionId, analysis.file_name, analysis.file_size],
      );
      await db.query(
        `INSERT INTO chat_messages (id, session_id, role, kind, analysis_id)
         VALUES ($1, $2, 'assistant', 'analysis', $3)`,
        [newId('m'), sessionId, analysisId],
      );
      await db.query('UPDATE chat_sessions SET updated_at = now() WHERE id = $1', [sessionId]);
    }
    reply.code(201);
    const res = await db.query<MessageRow>(
      `SELECT id, role, kind, text, file_name, file_size, analysis_id, feedback, attachments, refs
       FROM chat_messages WHERE session_id = $1 ORDER BY created_at`,
      [sessionId],
    );
    return decryptMessages(req.currentUser.id, res.rows);
  });

  // Thumbs rating on an assistant reply; value null clears the rating.
  app.post('/chats/:id/messages/:messageId/feedback', { preHandler: [app.authenticateReal] }, async (req) => {
    const { id: sessionId, messageId } = req.params as { id: string; messageId: string };
    await requireSession(req.currentUser.id, sessionId);
    const body = asObject(req.body);
    const value = body.value === 'up' || body.value === 'down' ? body.value : null;
    const res = await db.query<{ id: string }>(
      `UPDATE chat_messages SET feedback = $3 WHERE id = $1 AND session_id = $2 AND role = 'assistant' RETURNING id`,
      [messageId, sessionId, value],
    );
    if (!res.rows[0]) throw notFound('Message not found');
    return { ok: true, feedback: value };
  });

  // Главный вход в модель — с лимитом RATE_LIMIT. Раньше
  // единственной защитой здесь был общий потолок 300 запросов/мин, а месячного
  // потолка у Pro/Business не было вовсе: один клиент мог сжечь любую сумму
  // (аудит 2026-08-03).
  app.post('/chats/:id/messages', { preHandler: [app.authenticateReal], config: RATE_LIMIT }, async (req, reply) => {
    const { id: sessionId } = req.params as { id: string };
    await requireSession(req.currentUser.id, sessionId);
    // Atomically reserve the AI unit up front (fail fast before persisting the
    // user's message). EVERYTHING after the reservation runs under a guard that
    // gives the unit back on ANY failure — a bad body, a transient DB error, or
    // the model itself — so a failed request never permanently burns allowance.
    const { plan, reserved, quotaUserId } = await reserveAiRequest(db, req.currentUser.id);
    let released = false;
    const release = async () => {
      if (reserved && !released) {
        released = true;
        await releaseAiRequest(db, req.currentUser.id, quotaUserId);
      }
    };

    // Поток ответа (SSE) открывается после проверок — дальше ошибки уходят
    // в него событием error, а не HTTP-статусом.
    let sse: SseChannel | null = null;
    try {
      const body = asObject(req.body);
      const text = requireString(body, 'text', { min: 1, max: 20_000 });
      // Document Q&A: when the client passes the analysis it is looking at,
      // the reply is grounded in that contract.
      const analysisId = typeof body.analysisId === 'string' ? body.analysisId : undefined;
      let docContext = analysisId
        ? await buildAnalysisContext(db, req.currentUser.id, analysisId, { plan, log: (m) => req.log.warn(m) })
        : undefined;
      // Имя договора для шага «Сверяюсь с договором» (первая строка контекста).
      let contractName = docContext ? /^File: (.+)$/m.exec(docContext)?.[1] : undefined;
      // Сохранённый черновик в воркспейсе: серверного анализа ещё нет, но вопросы
      // должны видеть текст документа — клиент шлёт его в draftText.
      if (!docContext) {
        const draftText = typeof body.draftText === 'string' ? body.draftText.trim().slice(0, 100_000) : '';
        if (draftText) {
          const draftTitle = typeof body.draftTitle === 'string' ? body.draftTitle.trim().slice(0, 300) : '';
          docContext = `The user's own DRAFT contract${draftTitle ? ` «${draftTitle}»` : ''} (generated from a template, not analysed yet):\n\n${draftText}`;
          contractName = draftTitle || undefined;
        }
      }
      // Default legal context from the user's country selector (e.g. "German law").
      const jurisdiction = typeof body.jurisdiction === 'string' ? body.jurisdiction.slice(0, 60) : undefined;
      // Файлы, прикреплённые к этому вопросу: только свои загрузки и не больше
      // лимита тарифа (Free — 2, платные — 5). Проверка ДО записи сообщения.
      const attached = await loadOwnAttachments(db, req.currentUser.id, parseUploadIds(body.uploadIds, plan));

      // Шаги работы — клиенту по мере выполнения («Работаю…» вместо трёх
      // точек). Только настоящие: что прочитано, что искали, что нашли.
      sse = wantsSSE(req) ? openSSE(req, reply) : null;
      const channel = sse;
      const step = (s: ChatStep) => channel?.send('step', s);
      step({ id: 'prompt', status: 'done' });
      if (docContext) step({ id: 'contract', status: 'done', ...(contractName ? { data: { name: contractName } } : {}) });

      // Persist the user's message (encrypted at rest; plaintext local `text`
      // is what the model receives — answers unchanged by encryption).
      await db.query(
        `INSERT INTO chat_messages (id, session_id, role, kind, text, attachments) VALUES ($1, $2, 'user', 'text', $3, $4::jsonb)`,
        [newId('m'), sessionId, await encText(db, req.currentUser.id, text), attached.length ? JSON.stringify(attached) : null],
      );

      // Вложения этого вопроса и прежних вопросов чата (новые первыми): модель
      // видит файлы на каждом ходу, пока о них спрашивают. С разбором договора
      // делят общий потолок контекста — вложениям достаётся половина.
      const chatFiles = await sessionAttachments(db, sessionId);
      if (chatFiles.length) {
        const files = chatFiles.map((f) => f.name);
        step({ id: 'files', status: 'active', data: { files } });
        const filesContext = await buildAttachmentsContext(db, req.currentUser.id, chatFiles, {
          plan,
          budget: docContext ? 45_000 : undefined,
          log: (m) => req.log.warn(m),
        });
        if (filesContext) docContext = docContext ? `${filesContext}\n\n${docContext}` : filesContext;
        step({ id: 'files', status: 'done', data: { files } });
      }

      // Conversation history for the model (text turns only) — decrypted BEFORE
      // splitHistory so the model sees the exact original turns. A turn that
      // fails decryption is dropped with a loud log, never sent as ciphertext.
      const historyRes = await db.query<{ role: 'user' | 'assistant'; text: string | null }>(
        `SELECT role, text FROM chat_messages
         WHERE session_id = $1 AND kind = 'text' AND text IS NOT NULL
         ORDER BY created_at`,
        [sessionId],
      );
      const turns: ChatTurn[] = [];
      for (const r of historyRes.rows) {
        if (!r.text) continue;
        const plain = await decText(db, req.currentUser.id, r.text);
        if (plain === null) {
          req.log.error({ sessionId }, 'chat history turn cannot be decrypted — dropped');
          continue;
        }
        turns.push({ role: r.role, text: plain });
      }
      const history = turns.slice(0, -1); // last turn is the message we just stored

      // Context window: the last ~10 turns go to the model verbatim (fewer when
      // they are long); everything older lives in a rolling summary on the
      // session, updated incrementally as turns fall out of the window.
      const { recent, older } = splitHistory(history);
      const sessRow = await db.query<{ context_summary: string | null; summary_covers: number }>(
        'SELECT context_summary, summary_covers FROM chat_sessions WHERE id = $1',
        [sessionId],
      );
      // A summary that fails decryption is treated as absent (it is derivative
      // and rebuilds itself) — logged, never fed to the model as ciphertext.
      let summary = await decText(db, req.currentUser.id, sessRow.rows[0]?.context_summary ?? null);
      if (sessRow.rows[0]?.context_summary != null && summary === null) {
        req.log.error({ sessionId }, 'chat summary cannot be decrypted — rebuilding');
      }
      const covers = Number(sessRow.rows[0]?.summary_covers ?? 0);
      if (older.length > covers) {
        step({ id: 'memory', status: 'active' });
        // Plan passed through: paid-plan chats must summarize on Anthropic only.
        const prior = summary;
        summary = await generateHistorySummary(summary, older.slice(covers), plan);
        // Advance the covered-count ONLY when the summary actually changed. On a
        // transient failure generateHistorySummary returns the previous summary
        // unchanged; advancing anyway would push those dropped turns past both the
        // verbatim window and the summary → the model loses them forever. Leaving
        // covers as-is retries the fold on the next turn.
        if (summary !== prior) {
          await db.query('UPDATE chat_sessions SET context_summary = $2, summary_covers = $3 WHERE id = $1', [
            sessionId,
            summary === null ? null : await encText(db, req.currentUser.id, summary),
            older.length,
          ]);
        }
        step({ id: 'memory', status: 'done' });
      }

      // Statute grounding (RAG): for jurisdictions with a legal corpus, retrieve
      // the provisions most relevant to the question and hand them to the model.
      // Non-fatal: on any failure the chat simply answers without the corpus.
      let legalContext: string | undefined;
      const corpus = jurisdictionCode(jurisdiction);
      // /plan и /slides: ищем нормы по сути дела, а не по слову-команде —
      // текст после команды ВМЕСТЕ с предыдущими вопросами этого чата. Одного
      // текста мало: «/slides для встречи с директором» — это аудитория, а не
      // суть дела (вживую 24.10 колода из-за этого «не нашла» нужных норм).
      const { mode, body: modeBody } = parseChatMode(text);
      const ragQuery = mode
        ? [
            modeBody,
            ...history
              .filter((t) => t.role === 'user')
              .slice(-3)
              .map((t) => parseChatMode(t.text).body),
          ]
            .filter(Boolean)
            .join('\n')
            .slice(0, 2000)
        : text;
      // Статьи, найденные в базе для этого ответа, — сохраняются у ответа
      // (вкладка Sources правой колонки чата).
      let foundRefs: LawRef[] = [];
      if (corpus && ragQuery.trim()) {
        // Запросы — те, по которым реально идёт поиск: переформулировки
        // вопроса (без него самого — его пользователь и так видит).
        let queries: string[] = [];
        const searching = { jurisdiction: corpus };
        step({ id: 'search', status: 'active', data: searching });
        try {
          const hits = await retrieveLegalContext(db, {
            query: ragQuery,
            jurisdiction: corpus,
            topK: 5,
            onQueries: (all) => {
              queries = (all.length > 1 ? all.slice(1) : all).map((q) => clip(q.replace(/\s+/g, ' '), 80));
              step({ id: 'search', status: 'active', data: { ...searching, queries } });
            },
          });
          if (hits.length) {
            legalContext = hits.map((h) => `[${h.unitId}] ${h.breadcrumb}\n${h.body.slice(0, 900)}`).join('\n---\n');
          }
          // Точные адреса статей на официальных сайтах — для ссылок в Sources.
          const links = await unitLinks(db, hits.map((h) => h.unitId)).catch(() => new Map<string, string>());
          foundRefs = hits.map((h) => refOf(h, links)).filter((r) => r.label);
          step({ id: 'search', status: 'done', data: { ...searching, queries, found: hits.length, refs: foundRefs.slice(0, 4) } });
        } catch (err) {
          req.log.warn(err, 'chat RAG retrieval failed');
          step({ id: 'search', status: 'done', data: { ...searching, queries, found: 0, failed: true } });
        }
      }
      if (mode) step({ id: 'mode', status: 'done', data: { mode } });

      const finish = async (replyText: string): Promise<ChatMessage> => {
        const messageId = newId('m');
        await db.query(
          `INSERT INTO chat_messages (id, session_id, role, kind, text, refs) VALUES ($1, $2, 'assistant', 'text', $3, $4::jsonb)`,
          [messageId, sessionId, await encText(db, req.currentUser.id, replyText), foundRefs.length ? JSON.stringify(foundRefs) : null],
        );
        await db.query('UPDATE chat_sessions SET updated_at = now() WHERE id = $1', [sessionId]);
        // Limited plans were already counted by the reservation; count unlimited
        // plans post-hoc for analytics.
        if (!reserved) await bumpUsage(db, quotaUserId, { ai: 1 });
        await audit(db, req, {
          type: 'ai.chat',
          target: { type: 'chat', id: sessionId },
          metadata: { feature: 'chat', ok: true, ...(mode ? { mode } : {}), ...(attached.length ? { attachments: attached.length } : {}) },
        });
        return { id: messageId, role: 'assistant', kind: 'text', text: replyText, ...(foundRefs.length ? { refs: foundRefs } : {}) };
      };

      // «Обдумываю ответ» — до первого слова модели (клиент закрывает шаг сам).
      step({ id: 'answer', status: 'active' });
      const replyText = await generateChatReply(
        recent,
        text,
        channel ? (delta) => channel.send('token', { text: delta }) : undefined,
        docContext,
        jurisdiction,
        plan,
        summary,
        legalContext,
        mode,
      );
      const message = await finish(replyText);
      if (!channel) return message;
      channel.send('done', message);
      channel.close();
      return reply;
    } catch (err) {
      await release(); // any failure after the reservation returns the unit
      if (!sse) throw err;
      // Поток уже открыт — ошибка уходит в него (HTTP-статус не отправить).
      req.log.error(err, 'chat reply failed');
      const message = err instanceof HttpError ? err.message : 'Failed to generate a reply';
      sse.send('error', { message, status: err instanceof HttpError ? err.status : 500 });
      sse.close();
      return reply;
    }
  });
}

interface PlanProgress {
  messageId: string;
  done: number[];
}

function readPlanProgress(value: unknown): PlanProgress | null {
  let v = value;
  if (typeof v === 'string') {
    try {
      v = JSON.parse(v);
    } catch {
      return null;
    }
  }
  if (!v || typeof v !== 'object') return null;
  const { messageId, done } = v as { messageId?: unknown; done?: unknown };
  if (typeof messageId !== 'string' || !Array.isArray(done)) return null;
  return { messageId, done: done.filter((n): n is number => Number.isInteger(n)) };
}

/** Колонка refs (jsonb приходит объектом, иногда строкой) → [{ label, doc, url? }]. */
function readRefsColumn(value: unknown): { label: string; doc: string; url?: string }[] {
  let v = value;
  if (typeof v === 'string') {
    try {
      v = JSON.parse(v);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(v)) return [];
  return v
    .filter((r): r is { label: string; doc: string; url?: unknown } => !!r && typeof r === 'object' && typeof r.label === 'string' && typeof r.doc === 'string')
    .slice(0, 10)
    .map((r) => {
      const url = typeof r.url === 'string' ? safeLink(r.url) : null;
      return { label: r.label, doc: r.doc, ...(url ? { url } : {}) };
    });
}

function clip(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}

/** «UZ / Гражданский кодекс … / Статья 333» → { label: 'Статья 333', doc: 'Гражданский кодекс …' }. */
type LawRef = { label: string; doc: string; url?: string };

function refOf(h: { breadcrumb: string; unitId?: string }, links?: Map<string, string>): LawRef {
  const parts = h.breadcrumb.split(' / ').map((p) => p.trim()).filter(Boolean);
  const url = h.unitId ? links?.get(h.unitId) : undefined;
  return { label: clip(parts[parts.length - 1] ?? '', 40), doc: clip(parts.length > 2 ? parts[1] : '', 60), ...(url ? { url } : {}) };
}

/** Ссылка на официальный сайт — только https (http legislation.gov.uk → https). */
function safeLink(u: string | null | undefined): string | null {
  if (!u) return null;
  try {
    const url = new URL(u.replace(/^http:\/\//i, 'https://'));
    return url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

/** Точные адреса статей на официальных сайтах: lex.uz/…#4739232,
 *  legislation.gov.uk/…/section/12 — official_unit_uri, иначе адрес закона. */
async function unitLinks(db: Db, unitIds: string[]): Promise<Map<string, string>> {
  const links = new Map<string, string>();
  if (!unitIds.length) return links;
  const res = await db.query<{ id: string; official_unit_uri: string | null; source_url: string }>(
    'SELECT id, official_unit_uri, source_url FROM legal_units WHERE id = ANY($1::text[])',
    [unitIds],
  );
  for (const r of res.rows) {
    const link = safeLink(r.official_unit_uri) ?? safeLink(r.source_url);
    if (link) links.set(r.id, link);
  }
  return links;
}

const likeEscape = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/**
 * Ответы, сохранённые до появления ссылок (25.10), знают только подпись
 * статьи и закона. Адрес находим по ним в официальном корпусе: путь статьи
 * «UZ / <закон> / … / <статья>»; длинное имя закона было обрезано «…» —
 * ищем по началу. Не нашли — статья остаётся без ссылки.
 */
async function resolveLegacyRefLinks(db: Db, messages: ChatMessage[]): Promise<void> {
  const cache = new Map<string, string | null>();
  for (const m of messages) {
    if (!m.refs?.some((r) => !r.url)) continue;
    for (const r of m.refs) {
      if (r.url || !r.doc || r.label.endsWith('…')) continue;
      const key = `${r.label}|${r.doc}`;
      if (!cache.has(key)) {
        const doc = r.doc.endsWith('…') ? r.doc.slice(0, -1) : r.doc;
        const res = await db.query<{ official_unit_uri: string | null; source_url: string }>(
          `SELECT official_unit_uri, source_url FROM legal_units
           WHERE breadcrumb LIKE $1 ESCAPE '\\' AND breadcrumb LIKE $2 ESCAPE '\\'
           ORDER BY length(breadcrumb) LIMIT 1`,
          [`%/ ${likeEscape(doc)}%`, `%/ ${likeEscape(r.label)}`],
        );
        const row = res.rows[0];
        cache.set(key, row ? (safeLink(row.official_unit_uri) ?? safeLink(row.source_url)) : null);
      }
      const url = cache.get(key);
      if (url) r.url = url;
    }
  }
}

const HISTORY_MAX_TURNS = 10;
const HISTORY_MAX_CHARS = 16_000;

/** Last N turns verbatim — fewer when they are long. The rest goes to the
 *  rolling summary (see generateHistorySummary). */
function splitHistory(turns: ChatTurn[]): { recent: ChatTurn[]; older: ChatTurn[] } {
  let start = Math.max(0, turns.length - HISTORY_MAX_TURNS);
  let chars = turns.slice(start).reduce((n, t) => n + t.text.length, 0);
  while (start < turns.length - 2 && chars > HISTORY_MAX_CHARS) {
    chars -= turns[start].text.length;
    start += 1;
  }
  return { recent: turns.slice(start), older: turns.slice(0, start) };
}
