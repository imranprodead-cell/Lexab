/**
 * Режимы чата, включаемые командой в начале сообщения:
 *   /plan   — пошаговый план действий по делу;
 *   /slides — презентация по делу (фронт собирает из ответа файл .pptx);
 *   /approve — пользователь одобрил план кнопкой «Одобрить план»: ИИ
 *              приступает к выполнению (документы первых шагов).
 * Обычный чат (без команды) этим модулем не затрагивается: инструкция режима
 * добавляется к системному промпту только когда режим явно выбран.
 */

export type ChatMode = 'plan' | 'slides' | 'approve';

/** «/plan …» → { mode: 'plan', body: '…' }; без команды — { mode: null, body: text }. */
export function parseChatMode(text: string): { mode: ChatMode | null; body: string } {
  const trimmed = text.trim();
  const m = /^\/(plan|slides|approve)(?=\s|$)/i.exec(trimmed);
  if (!m) return { mode: null, body: text };
  return { mode: m[1].toLowerCase() as ChatMode, body: trimmed.slice(m[0].length).trim() };
}

const PLAN_MODE_PROMPT = `MODE: ACTION PLAN (the user typed /plan). Produce a practical, step-by-step action plan for the user's legal matter: what to do, in what order, how exactly, and by when. Ground it in the conversation, the contract (if provided) and the legal context. Use this structure. Write the four section headings in the user's language, never in English unless the user writes in English (for a Russian-speaking user exactly: «Цель», «План действий», «Риски и на что обратить внимание», «Первый шаг сегодня»):
### Goal — one or two sentences: the outcome this plan secures.
### Action plan — a numbered list of 4–8 steps. For each step give: **the action** in bold; how to do it (1–2 concrete sentences: who sends what to whom and in what form); **the deadline or timing** (a statutory deadline must cite its provision); the documents or evidence needed; the legal basis.
### Risks and pitfalls — 2–4 bullets.
### First step today — the single most important next action.
If facts essential for a reliable plan are missing, still build the best plan from what is known, then end with up to 3 clarifying questions in the \`\`\`questions block described above — it must be the very last thing in the reply. If the user asks to revise an existing plan, return the full revised plan in the same structure. Never invent facts, amounts, dates or article numbers. If there is no information about any legal matter at all, reply in one or two sentences asking the user to describe the situation or attach the contract.`;

const SLIDES_MODE_PROMPT = `MODE: PRESENTATION (the user typed /slides). Build a slide deck about the user's legal matter — what the case is about, and what to do and how — for a client or management meeting. Ground every slide in the conversation, the contract (if provided) and the legal context. Output ONLY the deck, in exactly this Markdown format, with nothing before or after it:
# <deck title>
<one-line subtitle>

## <slide title>
- <bullet>
- <bullet>
> <speaker note>

Rules: 7–10 slides, each starting with "## ". 3–5 bullets per slide, each at most about 15 words; no nested bullets, tables, emojis, bold, links or code fences. Suggested flow: case summary; key facts and parties; legal position (cite only provisions from the legal context, with their exact numbers); risks; action plan — what to do and how (split into phases if needed); deadlines; documents and evidence; next steps. A slide may end with one speaker-note line starting with "> ". Write everything in the user's language. If the user added text after /slides, treat it as the focus or the audience of the deck. Never add a clarifying-questions block to a deck. If there is no information about any legal matter at all, do not output a deck — reply in one or two sentences asking the user to describe the case or attach the contract.`;

const APPROVE_MODE_PROMPT = `MODE: PLAN APPROVED (the user pressed "Approve plan"). The user approved the action plan from your previous reply. Start executing it now: draft in full the documents needed for the first steps (for example, the claim letter), with placeholders in square brackets for details you do not know, then give concise, practical instructions for each step of the plan in order. Ground everything in the approved plan, the conversation, the contract (if provided) and the legal context; cite only provisions from the legal context. Do not repeat the plan itself. Write in the user's language.`;

/** Системная инструкция режима — добавляется последним блоком промпта. */
export function modeInstructions(mode: ChatMode): string {
  if (mode === 'plan') return PLAN_MODE_PROMPT;
  if (mode === 'approve') return APPROVE_MODE_PROMPT;
  return SLIDES_MODE_PROMPT;
}

/** Потолок ответа. План и колода длиннее обычного ответа чата, а у
 *  рассуждающей модели Free-тарифа (DeepSeek) в этот потолок входят и её
 *  раздумья: при 4096 план обрывался и уходил на запасную модель (проверено
 *  вживую 24.10). Платится только реально написанное, не потолок. */
export function modeMaxTokens(mode: ChatMode | null | undefined): number {
  return mode ? 8000 : 4096;
}
