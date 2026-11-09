/**
 * Заголовок чата — один раз (решение владельца 2026-11-09). Раньше заголовком
 * было начало первого сообщения («привет», «/plan Иностранный инвесто…»).
 * Теперь ИИ даёт короткий заголовок по первому СОДЕРЖАТЕЛЬНОМУ вопросу и больше
 * чат не переименовывает:
 *  - приветствие («привет») заголовка не даёт — ждём первый вопрос по делу;
 *  - чат разбора договора остаётся с именем файла;
 *  - ручное переименование тоже ставит titled_at — ИИ его не перепишет;
 *  - ИИ недоступен или ответил пусто — заголовок из начала вопроса.
 * Метка titled_at (миграция 070) ставится атомарно: два параллельных вопроса
 * не дадут два заголовка.
 */
import type { Db } from '../db.ts';
import { generateChatTitle } from '../llm.ts';
import { parseChatMode } from './chatModes.ts';
import { encText } from './docCrypto.ts';
import { isSmallTalk } from './smallTalk.ts';

const MAX_TITLE = 60;

function clipWords(s: string, max: number): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,;:.–—-]+$/u, '')}…`;
}

/** Ответ модели → заголовок: одна строка, без кавычек, Markdown и точки в конце. null — пусто. */
export function cleanTitle(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const line = raw
    .split('\n')
    .map((l) => l.trim())
    .find(Boolean);
  if (!line) return null;
  const t = line
    .replace(/^(?:title|заголовок|sarlavha)\s*:\s*/iu, '')
    .replace(/[*_`#]+/g, '')
    .replace(/[\s.。!]+$/u, '')
    .replace(/^[\s«»"'“”„]+|[\s«»"'“”„]+$/gu, '')
    .replace(/[\s.。!]+$/u, '')
    .replace(/\s+/g, ' ')
    .trim();
  return t.length >= 2 ? clipWords(t, MAX_TITLE) : null;
}

/** Заголовок без ИИ: начало вопроса (без команды /plan), одна строка. */
export function titleFallback(subject: string): string {
  const line = subject.replace(/\s+/g, ' ').trim();
  return clipWords(line.charAt(0).toUpperCase() + line.slice(1), MAX_TITLE);
}

/**
 * Дать чату заголовок, если его ещё нет. Возвращает новый заголовок или null
 * (заголовок уже есть, вопрос — приветствие, чат разбора договора).
 */
export async function autoTitleChat(
  db: Db,
  opts: { sessionId: string; userId: string; text: string; plan?: string | null; log?: (msg: string) => void },
): Promise<string | null> {
  const row = (
    await db.query<{ titled_at: string | null; file_msgs: string }>(
      `SELECT titled_at,
              (SELECT count(*) FROM chat_messages m WHERE m.session_id = s.id AND m.kind <> 'text') AS file_msgs
         FROM chat_sessions s WHERE s.id = $1`,
      [opts.sessionId],
    )
  ).rows[0];
  if (!row || row.titled_at) return null;
  // Чат разбора договора: заголовок — имя файла, его и оставляем.
  if (Number(row.file_msgs) > 0) {
    await db.query('UPDATE chat_sessions SET titled_at = now() WHERE id = $1 AND titled_at IS NULL', [opts.sessionId]);
    return null;
  }
  const { mode, body } = parseChatMode(opts.text);
  const subject = (mode ? body : opts.text).trim();
  if (!subject || isSmallTalk(subject)) return null;

  const title = cleanTitle(await generateChatTitle(subject, opts.plan)) ?? titleFallback(subject);
  const res = await db.query<{ id: string }>(
    'UPDATE chat_sessions SET title = $2, titled_at = now() WHERE id = $1 AND titled_at IS NULL RETURNING id',
    [opts.sessionId, await encText(db, opts.userId, title)],
  );
  return res.rows[0] ? title : null;
}
