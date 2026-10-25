/**
 * Уточняющие вопросы ИИ. Когда ответу не хватает фактов, ИИ заканчивает его
 * блоком (см. CHAT_SYSTEM в server/src/llm.ts):
 *
 *   ```questions
 *   ? Вопрос
 *   - вариант
 *   - вариант
 *   ```
 *
 * Здесь блок вырезается из текста ответа и разбирается для карточки вопросов.
 * Пока ответ печатается, недописанный блок тоже прячется — пользователь не
 * видит служебную разметку ни на миг.
 */

export interface ClarifyQuestion {
  question: string;
  options: string[];
}

export interface ClarifyParts {
  /** Текст ответа без блока вопросов. */
  body: string;
  questions: ClarifyQuestion[];
}

const MAX_QUESTIONS = 3;
const MAX_OPTIONS = 5;

/** Сообщение пользователя — команда /plan (с текстом после неё или без). */
export const isPlanCommand = (text: string | undefined): boolean => /^\s*\/plan(?=\s|$)/i.test(text ?? '');

/** Сообщение «План одобрен» (кнопка «Одобрить план» шлёт /approve …). */
export const isApproveCommand = (text: string | undefined): boolean => /^\s*\/approve(?=\s|$)/i.test(text ?? '');

/** Ответ похож на настоящий план (а не на просьбу описать дело): ≥2 раздела. */
export const looksLikePlan = (text: string): boolean => (text.match(/^#{2,3}\s+\S/gm) ?? []).length >= 2;

function clean(s: string): string {
  return s
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

export function extractQuestions(text: string): ClarifyParts {
  const open = /```[ \t]*questions?\b[^\n]*\n?/gi;
  let start = -1;
  let contentFrom = -1;
  for (let m = open.exec(text); m; m = open.exec(text)) {
    start = m.index;
    contentFrom = m.index + m[0].length;
  }
  if (start < 0) return { body: text, questions: [] };

  const rest = text.slice(contentFrom);
  const close = rest.indexOf('```');
  const inner = close >= 0 ? rest.slice(0, close) : rest;
  const after = close >= 0 ? rest.slice(close + 3) : '';
  const body = `${text.slice(0, start).trimEnd()}${after.trim() ? `\n\n${after.trim()}` : ''}`;

  const questions: ClarifyQuestion[] = [];
  for (const raw of inner.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const q = /^\?\s*(?:\d+[.)]\s*)?(.+)$/.exec(line);
    if (q) {
      questions.push({ question: clean(q[1]), options: [] });
      continue;
    }
    const o = /^(?:[-*•]|\d+[.)])\s+(.+)$/.exec(line);
    if (o && questions.length) {
      const last = questions[questions.length - 1];
      if (last.options.length < MAX_OPTIONS) last.options.push(clean(o[1]));
    }
  }
  return { body, questions: questions.filter((q) => q.question).slice(0, MAX_QUESTIONS) };
}

/** Вопросы обычным списком — там, где интерактивной карточки нет. */
export function questionsAsMarkdown(questions: ClarifyQuestion[]): string {
  return questions
    .map((q) => `**${q.question}**${q.options.length ? `\n${q.options.map((o) => `- ${o}`).join('\n')}` : ''}`)
    .join('\n\n');
}

/** Текст ответа для показа: без служебного блока, вопросы — списком в конце. */
export function displayText(text: string): string {
  const { body, questions } = extractQuestions(text);
  if (!questions.length) return body;
  return [body, questionsAsMarkdown(questions)].filter(Boolean).join('\n\n');
}

/** Сообщение с ответами пользователя на вопросы (пропущенные не включаются). */
export function answersMessage(header: string, answered: { question: string; answer: string }[]): string {
  return [header, ...answered.map((a, i) => `${i + 1}. ${a.question} — ${a.answer}`)].join('\n');
}
