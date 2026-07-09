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
import { badRequest, notFound } from '../lib/errors.ts';
import { assertAiAllowance, bumpUsage } from '../lib/limits.ts';
import { resolveAnalysisAccess } from '../lib/teamAccess.ts';
import { toIso } from '../lib/format.ts';
import { newId } from '../lib/ids.ts';
import { openSSE, wantsSSE } from '../lib/sse.ts';
import { asObject, requireString } from '../lib/validate.ts';
import { generateChatReply, generateHistorySummary, type ChatTurn } from '../llm.ts';
import type { ChatMessage, ChatSession } from '../types.ts';

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

/** Contract context for document Q&A: summary + clause text with redline state. */
async function buildAnalysisContext(db: Db, userId: string, analysisId: string): Promise<string | undefined> {
  // Owner or team member with read access to the shared document.
  try {
    await resolveAnalysisAccess(db, userId, analysisId);
  } catch {
    return undefined;
  }
  const res = await db.query<{ user_id: string; file_name: string; summary: string; document_blocks: unknown }>(
    'SELECT user_id, file_name, summary, document_blocks FROM analyses WHERE id = $1',
    [analysisId],
  );
  const row = res.rows[0];
  if (!row) return undefined;

  const redlines = await db.query<{ id: string; del_text: string; ins_text: string; status: string }>(
    'SELECT id, del_text, ins_text, status FROM redlines WHERE analysis_id = $1 ORDER BY ord',
    [analysisId],
  );
  const byId = new Map(redlines.rows.map((r) => [r.id, r]));
  const blocks = (
    typeof row.document_blocks === 'string' ? JSON.parse(row.document_blocks) : row.document_blocks
  ) as { type: string; text?: string; segments?: (string | { redlineId: string })[] }[];

  const clauses = blocks
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

  // Full source text when we still have the uploaded file's extraction.
  const upload = await db.query<{ extracted_text: string | null }>(
    'SELECT extracted_text FROM uploads WHERE user_id = $1 AND file_name = $2 ORDER BY created_at DESC LIMIT 1',
    [row.user_id, row.file_name],
  );
  const fullText = upload.rows[0]?.extracted_text;

  return [
    `File: ${row.file_name}`,
    `AI review summary: ${row.summary}`,
    `Key clauses (with accepted redlines applied):${clauses}`,
    fullText ? `Full contract text:\n${fullText}` : '',
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
}

function toChatMessage(row: MessageRow): ChatMessage {
  return {
    id: row.id,
    role: row.role,
    kind: row.kind,
    ...(row.text !== null ? { text: row.text } : {}),
    ...(row.file_name !== null ? { file: { name: row.file_name, size: row.file_size ?? '' } } : {}),
    ...(row.analysis_id !== null ? { analysisId: row.analysis_id } : {}),
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
    return res.rows.map(toSession);
  });

  app.post('/chats', { preHandler: [app.authenticate] }, async (req, reply): Promise<ChatSession> => {
    const body = asObject(req.body);
    const title = requireString(body, 'title', { min: 1, max: 300 });
    const id = newId('c');
    const res = await db.query<SessionRow>(
      `INSERT INTO chat_sessions (id, user_id, title) VALUES ($1, $2, $3)
       RETURNING id, title, updated_at, pinned, archived`,
      [id, req.currentUser.id, title],
    );
    reply.code(201);
    return toSession(res.rows[0]);
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
      params.push(title.trim().slice(0, 300));
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
    return toSession(res.rows[0]);
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

  app.get('/chats/:id/messages', { preHandler: [app.authenticate] }, async (req): Promise<ChatMessage[]> => {
    const { id } = req.params as { id: string };
    await requireSession(req.currentUser.id, id);
    const res = await db.query<MessageRow>(
      `SELECT id, role, kind, text, file_name, file_size, analysis_id
       FROM chat_messages WHERE session_id = $1 ORDER BY created_at`,
      [id],
    );
    return res.rows.map(toChatMessage);
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
      `SELECT id, role, kind, text, file_name, file_size, analysis_id
       FROM chat_messages WHERE session_id = $1 ORDER BY created_at`,
      [sessionId],
    );
    return res.rows.map(toChatMessage);
  });

  app.post('/chats/:id/messages', { preHandler: [app.authenticateReal] }, async (req, reply) => {
    const { id: sessionId } = req.params as { id: string };
    await requireSession(req.currentUser.id, sessionId);
    const plan = await assertAiAllowance(db, req.currentUser.id);
    const body = asObject(req.body);
    const text = requireString(body, 'text', { min: 1, max: 20_000 });
    // Document Q&A: when the client passes the analysis it is looking at,
    // the reply is grounded in that contract.
    const analysisId = typeof body.analysisId === 'string' ? body.analysisId : undefined;
    const docContext = analysisId ? await buildAnalysisContext(db, req.currentUser.id, analysisId) : undefined;
    // Default legal context from the user's country selector (e.g. "German law").
    const jurisdiction = typeof body.jurisdiction === 'string' ? body.jurisdiction.slice(0, 60) : undefined;

    // Persist the user's message.
    await db.query(
      `INSERT INTO chat_messages (id, session_id, role, kind, text) VALUES ($1, $2, 'user', 'text', $3)`,
      [newId('m'), sessionId, text],
    );

    // Conversation history for the model (text turns only).
    const historyRes = await db.query<{ role: 'user' | 'assistant'; text: string | null }>(
      `SELECT role, text FROM chat_messages
       WHERE session_id = $1 AND kind = 'text' AND text IS NOT NULL
       ORDER BY created_at`,
      [sessionId],
    );
    const turns = historyRes.rows.filter((r) => r.text).map((r): ChatTurn => ({ role: r.role, text: r.text as string }));
    const history = turns.slice(0, -1); // last turn is the message we just stored

    // Context window: the last ~10 turns go to the model verbatim (fewer when
    // they are long); everything older lives in a rolling summary on the
    // session, updated incrementally as turns fall out of the window.
    const { recent, older } = splitHistory(history);
    const sessRow = await db.query<{ context_summary: string | null; summary_covers: number }>(
      'SELECT context_summary, summary_covers FROM chat_sessions WHERE id = $1',
      [sessionId],
    );
    let summary = sessRow.rows[0]?.context_summary ?? null;
    const covers = Number(sessRow.rows[0]?.summary_covers ?? 0);
    if (older.length > covers) {
      summary = await generateHistorySummary(summary, older.slice(covers));
      await db.query('UPDATE chat_sessions SET context_summary = $2, summary_covers = $3 WHERE id = $1', [
        sessionId,
        summary,
        older.length,
      ]);
    }

    const finish = async (replyText: string): Promise<ChatMessage> => {
      const messageId = newId('m');
      await db.query(
        `INSERT INTO chat_messages (id, session_id, role, kind, text) VALUES ($1, $2, 'assistant', 'text', $3)`,
        [messageId, sessionId, replyText],
      );
      await db.query('UPDATE chat_sessions SET updated_at = now() WHERE id = $1', [sessionId]);
      await bumpUsage(db, req.currentUser.id, { ai: 1 });
      return { id: messageId, role: 'assistant', kind: 'text', text: replyText };
    };

    if (wantsSSE(req)) {
      const sse = openSSE(req, reply);
      try {
        const replyText = await generateChatReply(recent, text, (delta) => sse.send('token', { text: delta }), docContext, jurisdiction, plan, summary);
        const message = await finish(replyText);
        sse.send('done', message);
      } catch (err) {
        req.log.error(err, 'chat reply failed');
        sse.send('error', { message: 'Failed to generate a reply' });
      } finally {
        sse.close();
      }
      return reply;
    }

    const replyText = await generateChatReply(recent, text, undefined, docContext, jurisdiction, plan, summary);
    return finish(replyText);
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
