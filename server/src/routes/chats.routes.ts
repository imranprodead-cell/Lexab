/**
 * GET /chats | POST /chats | GET /chats/:id/messages | POST /chats/:id/messages
 *
 * POST …/messages supports two response modes:
 *  - `Accept: text/event-stream` → SSE: `token` events with text deltas, then
 *    a final `done` event carrying the persisted assistant ChatMessage.
 *  - otherwise → plain JSON: the full assistant ChatMessage.
 */
import type { FastifyInstance } from 'fastify';
import type { Db } from '../db.ts';
import { badRequest, HttpError, notFound } from '../lib/errors.ts';
import { audit } from '../lib/audit.ts';
import { decJsonFromJsonb, decText, decTextStrict, encText } from '../lib/docCrypto.ts';
import { bumpUsage, releaseAiRequest, reserveAiRequest, withAiRequest } from '../lib/limits.ts';
import { resolveAnalysisAccess } from '../lib/teamAccess.ts';
import { toIso } from '../lib/format.ts';
import { newId } from '../lib/ids.ts';
import { openSSE, wantsSSE } from '../lib/sse.ts';
import { asObject, requireString } from '../lib/validate.ts';
import { generateChatReply, generateHistorySummary, type ChatTurn } from '../llm.ts';
import { jurisdictionCode, retrieveLegalContext } from '../rag/retrieve.ts';
import type { ChatMessage, ChatSession } from '../types.ts';

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
 *  of what the model receives). */
export async function buildAnalysisContext(db: Db, userId: string, analysisId: string): Promise<string | undefined> {
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
    | { type: string; text?: string; segments?: (string | { redlineId: string })[] }[]
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
  const upload = row.upload_id
    ? await db.query<{ extracted_text: string | null }>('SELECT extracted_text FROM uploads WHERE id = $1 AND user_id = $2', [
        row.upload_id,
        row.user_id,
      ])
    : await db.query<{ extracted_text: string | null }>(
        'SELECT extracted_text FROM uploads WHERE user_id = $1 AND file_name = $2 ORDER BY created_at DESC LIMIT 1',
        [row.user_id, row.file_name],
      );
  // Present-but-undecryptable text must throw, not silently drop the "Full
  // contract text" block from the grounding context.
  const rawFull = upload.rows[0]?.extracted_text ?? null;
  const fullText = rawFull === null ? null : await decTextStrict(db, ownerId, rawFull);

  return [
    `File: ${row.file_name}`,
    `AI review summary: ${summary}`,
    `Key clauses (with accepted redlines applied):${clauses}`,
    // Явный маркер отсутствия полного текста: без него модель на «переведи
    // договор» достраивает недостающие клаузы из головы.
    fullText
      ? `Full contract text:\n${fullText}`
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
}

function toChatMessage(row: MessageRow): ChatMessage {
  return {
    id: row.id,
    role: row.role,
    kind: row.kind,
    ...(row.text !== null ? { text: row.text } : {}),
    ...(row.file_name !== null ? { file: { name: row.file_name, size: row.file_size ?? '' } } : {}),
    ...(row.analysis_id !== null ? { analysisId: row.analysis_id } : {}),
    ...(row.feedback ? { feedback: row.feedback } : {}),
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

  app.get('/chats/:id/messages', { preHandler: [app.authenticate] }, async (req): Promise<ChatMessage[]> => {
    const { id } = req.params as { id: string };
    await requireSession(req.currentUser.id, id);
    const res = await db.query<MessageRow>(
      `SELECT id, role, kind, text, file_name, file_size, analysis_id, feedback
       FROM chat_messages WHERE session_id = $1 ORDER BY created_at`,
      [id],
    );
    return decryptMessages(req.currentUser.id, res.rows);
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
      `SELECT id, role, kind, text, file_name, file_size, analysis_id, feedback
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

  /**
   * Ghost (incognito) chat: the AI answers exactly like the normal chat —
   * same per-plan model, same RAG grounding, same plan limits and usage
   * counters — but NOTHING is written to the database. The client keeps the
   * conversation in memory and sends the recent turns with every request.
   * (Static "ghost" segment wins over the parametric /chats/:id/messages.)
   */
  app.post('/chats/ghost/messages', { preHandler: [app.authenticateReal], config: RATE_LIMIT }, async (req, reply) => {
    const body = asObject(req.body);
    const text = requireString(body, 'text', { min: 1, max: 20_000 });
    const jurisdiction = typeof body.jurisdiction === 'string' ? body.jurisdiction.slice(0, 60) : undefined;

    // Client-held history (never persisted): validate shape and cap size.
    const rawHistory = Array.isArray(body.history) ? body.history.slice(-HISTORY_MAX_TURNS) : [];
    const turns: ChatTurn[] = [];
    for (const item of rawHistory) {
      if (typeof item !== 'object' || item === null) continue;
      const { role, text: turnText } = item as { role?: unknown; text?: unknown };
      if ((role === 'user' || role === 'assistant') && typeof turnText === 'string' && turnText.trim()) {
        turns.push({ role, text: turnText.slice(0, 20_000) });
      }
    }
    const { recent } = splitHistory(turns);

    // Same statute grounding as the normal chat (non-fatal on failure).
    let legalContext: string | undefined;
    const ghostCorpus = jurisdictionCode(jurisdiction);
    if (ghostCorpus) {
      try {
        const hits = await retrieveLegalContext(db, { query: text, jurisdiction: ghostCorpus, topK: 5 });
        if (hits.length) {
          legalContext = hits.map((h) => `[${h.unitId}] ${h.breadcrumb}\n${h.body.slice(0, 900)}`).join('\n---\n');
        }
      } catch (err) {
        req.log.warn(err, 'ghost chat RAG retrieval failed');
      }
    }

    // Ghost writes nothing to the DB, but AI limits still apply: the atomic
    // reservation (in withAiRequest) is released if the model fails.
    const finishGhost = (replyText: string): ChatMessage => ({
      id: newId('gm'),
      role: 'assistant',
      kind: 'text',
      text: replyText,
    });

    if (wantsSSE(req)) {
      const sse = openSSE(req, reply);
      try {
        const msg = await withAiRequest(db, req.currentUser.id, (plan) =>
          generateChatReply(recent, text, (delta) => sse.send('token', { text: delta }), undefined, jurisdiction, plan, null, legalContext).then(finishGhost),
        );
        sse.send('done', msg);
      } catch (err) {
        req.log.error(err, 'ghost chat reply failed');
        // Carry the status so the client can show the right message — a 402
        // limit-reached looks different to the user than a generic failure.
        sse.send('error', {
          message: err instanceof HttpError ? err.message : 'Failed to generate a reply',
          status: err instanceof HttpError ? err.status : 500,
        });
      } finally {
        sse.close();
      }
      return reply;
    }

    return withAiRequest(db, req.currentUser.id, (plan) =>
      generateChatReply(recent, text, undefined, undefined, jurisdiction, plan, null, legalContext).then(finishGhost),
    );
  });

  app.post('/chats/:id/messages', { preHandler: [app.authenticateReal] }, async (req, reply) => {
    const { id: sessionId } = req.params as { id: string };
    await requireSession(req.currentUser.id, sessionId);
    // Atomically reserve the AI unit up front (fail fast before persisting the
    // user's message). EVERYTHING after the reservation runs under a guard that
    // gives the unit back on ANY failure — a bad body, a transient DB error, or
    // the model itself — so a failed request never permanently burns allowance.
    const { plan, reserved } = await reserveAiRequest(db, req.currentUser.id);
    let released = false;
    const release = async () => {
      if (reserved && !released) {
        released = true;
        await releaseAiRequest(db, req.currentUser.id);
      }
    };

    try {
      const body = asObject(req.body);
      const text = requireString(body, 'text', { min: 1, max: 20_000 });
      // Document Q&A: when the client passes the analysis it is looking at,
      // the reply is grounded in that contract.
      const analysisId = typeof body.analysisId === 'string' ? body.analysisId : undefined;
      let docContext = analysisId ? await buildAnalysisContext(db, req.currentUser.id, analysisId) : undefined;
      // Черновик шаблона в воркспейсе: серверного анализа ещё нет, но вопросы
      // должны видеть текст документа — клиент шлёт его в draftText.
      if (!docContext) {
        const draftText = typeof body.draftText === 'string' ? body.draftText.trim().slice(0, 100_000) : '';
        if (draftText) {
          const draftTitle = typeof body.draftTitle === 'string' ? body.draftTitle.trim().slice(0, 300) : '';
          docContext = `The user's own DRAFT contract${draftTitle ? ` «${draftTitle}»` : ''} (generated from a template, not analysed yet):\n\n${draftText}`;
        }
      }
      // Default legal context from the user's country selector (e.g. "German law").
      const jurisdiction = typeof body.jurisdiction === 'string' ? body.jurisdiction.slice(0, 60) : undefined;

      // Persist the user's message (encrypted at rest; plaintext local `text`
      // is what the model receives — answers unchanged by encryption).
      await db.query(
        `INSERT INTO chat_messages (id, session_id, role, kind, text) VALUES ($1, $2, 'user', 'text', $3)`,
        [newId('m'), sessionId, await encText(db, req.currentUser.id, text)],
      );

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
      }

      // Statute grounding (RAG): for jurisdictions with a legal corpus, retrieve
      // the provisions most relevant to the question and hand them to the model.
      // Non-fatal: on any failure the chat simply answers without the corpus.
      let legalContext: string | undefined;
      const corpus = jurisdictionCode(jurisdiction);
      if (corpus) {
        try {
          const hits = await retrieveLegalContext(db, { query: text, jurisdiction: corpus, topK: 5 });
          if (hits.length) {
            legalContext = hits.map((h) => `[${h.unitId}] ${h.breadcrumb}\n${h.body.slice(0, 900)}`).join('\n---\n');
          }
        } catch (err) {
          req.log.warn(err, 'chat RAG retrieval failed');
        }
      }

      const finish = async (replyText: string): Promise<ChatMessage> => {
        const messageId = newId('m');
        await db.query(
          `INSERT INTO chat_messages (id, session_id, role, kind, text) VALUES ($1, $2, 'assistant', 'text', $3)`,
          [messageId, sessionId, await encText(db, req.currentUser.id, replyText)],
        );
        await db.query('UPDATE chat_sessions SET updated_at = now() WHERE id = $1', [sessionId]);
        // Limited plans were already counted by the reservation; count unlimited
        // plans post-hoc for analytics.
        if (!reserved) await bumpUsage(db, req.currentUser.id, { ai: 1 });
        await audit(db, req, { type: 'ai.chat', target: { type: 'chat', id: sessionId }, metadata: { feature: 'chat', ok: true } });
        return { id: messageId, role: 'assistant', kind: 'text', text: replyText };
      };

      if (wantsSSE(req)) {
        const sse = openSSE(req, reply);
        try {
          const replyText = await generateChatReply(recent, text, (delta) => sse.send('token', { text: delta }), docContext, jurisdiction, plan, summary, legalContext);
          const message = await finish(replyText);
          sse.send('done', message);
        } catch (err) {
          await release(); // model/DB failed — give the unit back
          req.log.error(err, 'chat reply failed');
          const message = err instanceof HttpError ? err.message : 'Failed to generate a reply';
          sse.send('error', { message, status: err instanceof HttpError ? err.status : 500 });
        } finally {
          sse.close();
        }
        return reply;
      }

      const replyText = await generateChatReply(recent, text, undefined, docContext, jurisdiction, plan, summary, legalContext);
      return await finish(replyText);
    } catch (err) {
      await release(); // any failure after the reservation returns the unit
      throw err;
    }
  });
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
