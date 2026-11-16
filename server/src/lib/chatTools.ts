/**
 * Инструменты агента чата (решение владельца 2026-10-30, первый блок):
 *   search_law      — поиск по проверенной базе законов (7 стран);
 *   get_provision   — полный текст нормы по id или по ссылке «ст. 356 ГК»;
 *   verify_citation — проверка ссылки до ответа: есть ли такая норма и про то ли она;
 *   read_contract   — перечитать договор и файлы чата целиком, а не обрезок;
 *   calculate       — арифметика и даты кодом, а не «в уме» модели.
 *
 * Правила продукта, которые здесь держит КОД:
 *  - тексты законов только из legal_units (официальные источники, правило №1);
 *  - инструменты только читают: ничего не меняют и никуда не отправляют;
 *  - вход модели — недоверенный: каждое поле проверяется, ошибка уходит модели
 *    текстом с is_error, а не исключением (она поправит вызов сама).
 */
import type Anthropic from '@anthropic-ai/sdk';
import type { Db } from '../db.ts';
import { parseRuCitation, parseUzDecreeCitation, parseUzPlenumCitation, resolveCitationText, retrieveLegalContext } from '../rag/retrieve.ts';
import { contextLine } from '../rag/context.ts';
import type { JurisdictionCode } from '../rag/types.ts';
import { judgeProvision } from '../rag/validate-citations.ts';
import type { ChatStep, ChatToolName } from '../types.ts';
import { docHeader, loadFirmMemory, scorePassages, searchMemory, stemsOf, type MemoryDoc } from './firmMemory.ts';
import { buildDocGraph, relatedLines } from './docGraph.ts';
import { excerpt, fetchOfficial, lexDocId, officialActRef, officialUrl, pageText, parseLexPage, searchLexUz, shortActName, type OfficialActRef } from './officialWeb.ts';
import { checkProposal, reviewEditsText, reviewSourceText, type EditProposal, type EditTarget, type ReminderProposal } from './chatActions.ts';
import { planFor, planHasFeature } from './limits.ts';
import { MAX_VISUALS, normalizeChart, normalizeSteps, normalizeTimeline, numbersIn, unverifiedValues, VISUAL_TOOL_NAMES, visualMarker, VisualInputError, visualsOn, type Visual } from './chatVisuals.ts';
import { loadActivePlaybook, resolvePlaybookOwner } from './playbook.ts';
import { canEdit, resolveDocumentAccess } from './teamAccess.ts';
import { diffClauses, formatChanges } from './textDiff.ts';
import { SPECIALIST_IDS, SPECIALISTS, renderGuide, specialistById, specialistsOn } from './specialists.ts';

const JURISDICTIONS: JurisdictionCode[] = ['UK', 'UZ', 'KZ', 'DE', 'US', 'CA', 'AE'];

export type LawRef = { label: string; doc: string; url?: string };

export interface ChatDocument {
  name: string;
  text: string;
  /** Чистый текст файла (вложение) — в отличие от контекста разбора (итог + пункты + текст). */
  pure?: boolean;
}

export interface ChatToolContext {
  db: Db;
  /** Кто спрашивает — для «памяти фирмы» (его документы и общие командные).
   *  Нет — инструмент search_documents недоступен (служебные агенты). */
  userId?: string;
  /** База законов по умолчанию — страна, выбранная в чате; null — не выбрана. */
  jurisdiction: JurisdictionCode | null;
  /** Полные тексты договора и файлов чата (для read_contract). */
  documents: ChatDocument[];
  /** Тариф (с учётом команды) — сроки, плейбуки и сравнение есть не на всех. */
  plan?: string;
  /** Разбор, о котором этот чат (чтение) — для get_review_edits, сроков и сравнения. */
  review?: { analysisId: string; ownerId: string; documentId?: string | null; documentName?: string };
  /** Предложенный срок → карточка «Добавить напоминание» под ответом. */
  onReminder?: (reminder: ReminderProposal) => void;
  /** Разбор, который пользователь может ПРАВИТЬ, — для propose_edit. */
  editTarget?: EditTarget;
  /** Предложенная правка → карточка «Было → Станет» с кнопкой «Принять» под ответом. */
  onProposal?: (proposal: EditProposal) => void;
  onStep?: (step: ChatStep) => void;
  /** Нормы → подписи и ссылки на официальный сайт (адреса знает маршрут чата). */
  toRefs: (units: { unitId: string; breadcrumb: string }[]) => Promise<LawRef[]>;
  /** Нормы для вкладки Sources: used — агент открыл или подтвердил (идут
   *  всегда); found — только всплыли в поиске (идут, если ответ на них ссылается). */
  onRefs?: (refs: LawRef[], kind: 'used' | 'found') => void;
  /** Агент брал сведения с официального сайта (хост) — маршрут чата добавит
   *  в конец ответа строку «не из проверенной базы Lexab» (lib/officialWeb.ts). */
  onOfficialSource?: (host: string) => void;
  /** Акты с официальных сайтов для вкладки Sources и ссылок в конце ответа:
   *  read — агент открыл страницу (идут всегда); found — действующие акты из
   *  поиска lex.uz (идут, если ответ называет их номер или ссылку). */
  onOfficialActs?: (acts: OfficialActRef[], kind: 'read' | 'found') => void;
  /** Вопрос пользователя — числа из него можно рисовать на графике. */
  question?: string;
  /** Наглядный блок (план, сроки, норма, график) → в ответ на место метки. */
  onVisual?: (visual: Visual) => void;
}

export interface ToolCall {
  id: string;
  name: string;
  input: unknown;
}

export interface ToolOutcome {
  content: string;
  isError?: boolean;
  /** Что принёс вызов — id норм, адреса страниц, документы. По ним цикл агента
   *  решает, продвигается ли поиск (добавочные шаги — agentSteps в llm.ts):
   *  пустой список — ничего не нашлось; поля нет — инструмент не поисковый,
   *  удавшийся вызов считается продвижением. */
  keys?: string[];
}

const JURISDICTION_PROP = {
  type: 'string',
  enum: JURISDICTIONS,
  description:
    'Law database: UK, UZ (Uzbekistan), KZ (Kazakhstan), DE (Germany), US (federal), CA (Québec), AE (UAE). Omit to use the jurisdiction of this conversation.',
} as const;

/** Описания — когда ВЫЗЫВАТЬ, а не только что делает (модель решает по ним). */
/**
 * Подписи кнопок и раздела — ровно как в интерфейсе (src/i18n/messages.ts и
 * translations/*). Агент называет их на языке своего ответа: спросили
 * по-русски — «Принять правку», по-английски — «Accept edit». Раньше в
 * подсказках стояли только английские названия, и в русском ответе агент
 * отсылал к кнопке «Add reminder», которой на экране нет.
 */
export const UI_LABELS = {
  acceptEdit: { Russian: 'Принять правку', English: 'Accept edit', Uzbek: 'Tuzatishni qabul qilish', Kazakh: 'Түзетуді қабылдау', German: 'Änderung annehmen', Arabic: 'قبول التعديل' },
  addReminder: { Russian: 'Добавить напоминание', English: 'Add reminder', Uzbek: 'Eslatma qoʻshish', Kazakh: 'Еске салуды қосу', German: 'Erinnerung hinzufügen', Arabic: 'إضافة تذكير' },
  deadlinesSection: { Russian: 'Сроки и обязательства', English: 'Key dates & obligations', Uzbek: 'Muddatlar va majburiyatlar', Kazakh: 'Мерзімдер мен міндеттемелер', German: 'Fristen und Pflichten', Arabic: 'المواعيد والالتزامات' },
} as const;

/** «Принять правку» (Russian), «Accept edit» (English), … — для подсказок агенту. */
export const uiLabel = (key: keyof typeof UI_LABELS): string =>
  Object.entries(UI_LABELS[key]).map(([lang, label]) => `«${label}» (${lang})`).join(', ');

const LABEL_RULE = 'When you mention a button or section, use its label in the language of your answer.';

export const CHAT_TOOLS: Anthropic.Beta.BetaTool[] = [
  {
    name: 'search_law',
    description:
      "Search Lexab's verified statute database (official sources only): statutes and codes of the listed jurisdictions and, for Uzbekistan, also the Constitution, presidential decrees and resolutions, and Supreme Court Plenum resolutions (the courts' guidance on applying statutes). It holds no individual court decisions or commentary — do not search for those. Call it when the answer depends on a legal rule — a right, obligation, deadline, penalty, formality or prohibition — that the provisions already in the legal context do not cover. One focused query per legal question; search again with other wording, or for another act, only when the results miss. Returns provisions with their [unit id]; open one in full with get_provision before quoting details.",
    eager_input_streaming: true,
    input_schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        query: {
          type: 'string',
          description: 'What to look for, in the language of the database (Russian for UZ/KZ, German for DE, English otherwise), e.g. «неустойка за просрочку поставки».',
        },
        jurisdiction: JURISDICTION_PROP,
        limit: { type: 'integer', minimum: 1, maximum: 8, description: 'How many provisions to return (default 5).' },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_provision',
    description:
      'Open the full official text of one provision, with its source link and retrieval date. Call it before you quote a provision or rely on its exact wording, numbers or conditions. Pass the [unit id] from search results or the legal context, or a citation such as «ст. 356 ГК», «п. 5 УП-6079», «п. 6 постановления Пленума ВХС № 163 от 15.06.2007», «§ 433 BGB», «s.14 Sale of Goods Act 1979».',
    eager_input_streaming: true,
    input_schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        unit_id: { type: 'string', description: 'The provision id shown in square brackets, e.g. lu_uz_180550_st-356.' },
        citation: { type: 'string', description: 'A citation, used when there is no unit id.' },
        jurisdiction: JURISDICTION_PROP,
      },
    },
  },
  {
    name: 'verify_citation',
    description:
      'Check a citation before you give it to the user: does this provision exist in the database, and does it govern the point you use it for? Call it only for articles, sections, decree or Plenum points you cite that no tool and no legal context in this conversation returned with a [unit id] — provisions you found or opened need no check. NOT_FOUND or NOT_SUPPORTED means: find the right provision with search_law, or drop the citation.',
    eager_input_streaming: true,
    input_schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        citation: { type: 'string', description: 'The citation as you would write it, e.g. «ст. 32 Закона о договорно-правовой базе».' },
        claim: { type: 'string', description: 'In one sentence, what you use this provision to support.' },
        unit_id: { type: 'string', description: 'The provision id, if you have it.' },
        jurisdiction: JURISDICTION_PROP,
      },
      required: ['citation', 'claim'],
    },
  },
  {
    name: 'read_contract',
    description:
      "Reread the user's contract and the files attached to this conversation, in full. Call it to find the clause a question is about, to check the exact wording before quoting it, or to read a part that the context above cuts off. Search by meaning with `query`, or read on from a position with `from_char`.",
    eager_input_streaming: true,
    input_schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        query: { type: 'string', description: 'Words to find, e.g. «неустойка просрочка оплаты» or «termination notice».' },
        document: { type: 'string', description: 'Part of the file name to search in; omit to search all documents.' },
        from_char: { type: 'integer', minimum: 0, description: 'Read about 6000 characters starting at this position.' },
      },
    },
  },
  {
    name: 'propose_edit',
    description:
      'Propose a change to one clause of the contract under review. The user sees a card «was → becomes» with a button labelled ' + uiLabel('acceptEdit') + ' under your answer; only their click changes the document. ' + LABEL_RULE + ' Call it when the user asks you to fix, rewrite, soften or delete a clause, or agrees to a change you suggested — one call per clause. `clause` is the exact current wording copied from the contract (find it with read_contract); `new_text` is the full replacement wording (empty to delete the clause); `reason` is one sentence. Do not repeat the new wording in your answer — the card shows it.',
    eager_input_streaming: true,
    input_schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        clause: { type: 'string', description: 'The clause exactly as it stands in the contract now.' },
        new_text: { type: 'string', description: 'The full new wording of the clause.' },
        reason: { type: 'string', description: 'One sentence: why the change is needed.' },
      },
      required: ['clause', 'new_text', 'reason'],
    },
  },
  {
    name: 'get_review_edits',
    description:
      "List the proposed edits and findings of the contract review in this conversation: each edit's id and status (pending/accepted/rejected), the contract wording, the proposed wording and the reason. Call it to build a protocol of disagreements or a summary of changes for the counterparty, or to refer to a specific edit.",
    eager_input_streaming: true,
    input_schema: { type: 'object', additionalProperties: false, properties: {} },
  },
  {
    name: 'search_documents',
    description:
      "Search the user's own earlier documents — contracts and reviews in their Vault, documents saved from chat — and the documents their team shares with them. Call it when the user mentions an earlier contract, a counterparty or a past deal, asks how they usually word or handle something, or when a past contract with the same counterparty could change your advice. Returns the best-matching documents with passages and their [document id]; pass document_id to read one further (with query, or from_char). Name the document you rely on.",
    eager_input_streaming: true,
    input_schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        query: { type: 'string', description: 'What to find: a counterparty, a clause topic or words, e.g. «Нур Маркет неустойка» or «limitation of liability».' },
        document_id: { type: 'string', description: 'A document id from earlier results, to read that document further.' },
        from_char: { type: 'integer', minimum: 0, description: 'With document_id: read about 6000 characters from this position.' },
        limit: { type: 'integer', minimum: 1, maximum: 8, description: 'How many documents to return (default 5).' },
      },
    },
  },
  {
    name: 'propose_reminder',
    description:
      'Offer to track a deadline the user must meet under a contract — a payment, delivery, notice, claim response or renewal date — with an email reminder before it. The user sees a card with the date and a button labelled ' + uiLabel('addReminder') + '; only their click adds it to the section ' + uiLabel('deadlinesSection') + '. ' + LABEL_RULE + ' One call per deadline; compute the exact date with calculate first. Defaults to the contract under review; for another contract pass its document_id from search_documents.',
    eager_input_streaming: true,
    input_schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        what: { type: 'string', description: 'What must be done, short: «Оплатить 240 000 000 сум по договору поставки».' },
        due_date: { type: 'string', description: 'The deadline, YYYY-MM-DD or DD.MM.YYYY.' },
        remind_days_before: { type: 'integer', minimum: 0, maximum: 60, description: 'How many days before to email the user (default 3).' },
        document_id: { type: 'string', description: 'Another contract from search_documents; omit for the contract under review.' },
      },
      required: ['what', 'due_date'],
    },
  },
  {
    name: 'get_playbook',
    description:
      "Read the firm's playbook — the team's standard positions on contract clauses (penalties, liability caps, payment terms, governing law…). Call it when the user asks what the firm's / their standard position is, or before advising how to negotiate a clause, so the advice follows the firm's rules. Optionally narrow it with a topic.",
    eager_input_streaming: true,
    input_schema: {
      type: 'object',
      additionalProperties: false,
      properties: { topic: { type: 'string', description: 'A clause topic to narrow the list, e.g. «неустойка».' } },
    },
  },
  {
    name: 'compare_versions',
    description:
      "Compare two versions of a contract clause by clause — for example the counterparty's new draft against the previous one. The code finds every changed, added and removed clause; you explain what each change means for the user. `old` and `new` are a document id from search_documents or the name of a file attached to this chat; `new` defaults to the contract under review.",
    eager_input_streaming: true,
    input_schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        old: { type: 'string', description: 'The earlier version: a document id or an attached file name.' },
        new: { type: 'string', description: 'The newer version; omit for the contract under review.' },
      },
      required: ['old'],
    },
  },
  {
    name: 'calculate',
    description:
      'Exact arithmetic and calendar dates. Use it for every computation in your answer — penalties, interest, totals, percentages, caps, deadlines, days between dates — instead of calculating yourself. evaluate: an expression with + - * / ^ and parentheses, functions min, max, round(x, digits), floor, ceil, abs; write percentages as /100 (5% → *5/100). days_between: from_date → to_date. add_period: date plus years/months/days (negative values go back). Dates as YYYY-MM-DD or DD.MM.YYYY; calendar days only, holidays are not excluded.',
    eager_input_streaming: true,
    input_schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        operation: { type: 'string', enum: ['evaluate', 'days_between', 'add_period'] },
        expression: { type: 'string', description: 'evaluate: e.g. 240000000 * 0.5/100 * 30' },
        from_date: { type: 'string', description: 'days_between: start date' },
        to_date: { type: 'string', description: 'days_between: end date' },
        date: { type: 'string', description: 'add_period: the starting date' },
        years: { type: 'integer' },
        months: { type: 'integer' },
        days: { type: 'integer' },
      },
      required: ['operation'],
    },
  },
  {
    name: 'show_steps',
    description:
      "Show the user an action plan as a card: numbered steps, each with what to do, by when, who acts and which documents are needed. Call it when your answer tells the user to do several things in order (3–10 steps) — recovering a debt, terminating a contract, registering a company, dismissing an employee. Compute exact dates with calculate first. Returns a marker like [[lexab:1]] — put it on its own line in your answer where the card belongs, and do not repeat the card's content in text.",
    eager_input_streaming: true,
    input_schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        title: { type: 'string', description: 'Short heading, e.g. «Как взыскать долг по договору поставки».' },
        steps: {
          type: 'array',
          minItems: 2,
          maxItems: 10,
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              title: { type: 'string', description: 'The action, short: «Направить претензию покупателю».' },
              detail: { type: 'string', description: 'One or two sentences: how exactly, what to include.' },
              when: { type: 'string', description: 'The deadline in words, e.g. «в течение 30 дней после претензии».' },
              date: { type: 'string', description: 'The exact date, if known (from calculate): YYYY-MM-DD or DD.MM.YYYY.' },
              who: { type: 'string', description: 'Who acts: «вы», «юрист», «суд»…' },
              docs: { type: 'array', maxItems: 6, items: { type: 'string' }, description: 'Documents needed for this step.' },
            },
            required: ['title'],
          },
        },
      },
      required: ['steps'],
    },
  },
  {
    name: 'show_timeline',
    description:
      "Show key dates as a timeline card — in date order, with today marked and the days left to each. Call it when the answer turns on 3 or more dates or deadlines: signing, payment due, delay, claim and its response period, limitation period. Give each event either a `date`, or `after` (the number, from 1, of an EARLIER event in the list) plus years/months/days — the code computes the date in calendar days, so do not compute it yourself. Returns a marker like [[lexab:1]] — put it on its own line in your answer where the card belongs, and do not repeat the card's content in text.",
    eager_input_streaming: true,
    input_schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        title: { type: 'string', description: 'Short heading, e.g. «Сроки по договору поставки № 14».' },
        events: {
          type: 'array',
          minItems: 2,
          maxItems: 12,
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              label: { type: 'string', description: 'What happens: «Срок оплаты», «Последний день для иска».' },
              date: { type: 'string', description: 'A known date: YYYY-MM-DD or DD.MM.YYYY.' },
              after: { type: 'integer', minimum: 1, description: 'Instead of date: the number of an earlier event this one counts from.' },
              years: { type: 'integer' },
              months: { type: 'integer' },
              days: { type: 'integer' },
              note: { type: 'string', description: 'Optional short note: the basis (contract clause or article) or what to do.' },
            },
            required: ['label'],
          },
        },
      },
      required: ['events'],
    },
  },
  {
    name: 'show_law',
    description:
      "Show the exact official text of a provision as a card with its source link — instead of quoting the statute yourself. Call it for the one or two key provisions the answer rests on, not for every citation. Pass the [unit id] or a citation; a provision that is not in the verified database is not shown. Returns a marker like [[lexab:1]] — put it on its own line in your answer where the card belongs, and do not repeat the card's content in text.",
    eager_input_streaming: true,
    input_schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        unit_id: { type: 'string', description: 'The provision id from square brackets, e.g. lu_uz_180550_st-356.' },
        citation: { type: 'string', description: 'A citation, used when there is no unit id: «ст. 333 ГК».' },
        note: { type: 'string', description: 'One sentence: why this provision matters for the user here (your words, not the law).' },
        jurisdiction: JURISDICTION_PROP,
      },
    },
  },
  {
    name: 'show_chart',
    description:
      "Draw a chart when numbers are clearer as a picture: how a penalty, interest or debt grows over time (line), or how amounts compare — by month, by counterparty, option A against option B (bar). Every value must come from calculate in this answer, from the user's message or from documents you read — the code checks it, so compute the values first and pass them exactly as calculate returned them (the chart abbreviates large numbers itself). bar: one series; line: up to 3 series. Returns a marker like [[lexab:1]] — put it on its own line in your answer where the card belongs, and do not repeat the card's content in text.",
    eager_input_streaming: true,
    input_schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        title: { type: 'string', description: 'What the chart shows, e.g. «Пеня по дням просрочки, сум».' },
        kind: { type: 'string', enum: ['bar', 'line'] },
        unit: { type: 'string', description: 'Unit of the values: «сум», «$», «%», «дней».' },
        labels: { type: 'array', minItems: 2, maxItems: 24, items: { type: 'string' }, description: 'X-axis labels: months, dates, counterparties, options.' },
        series: {
          type: 'array',
          minItems: 1,
          maxItems: 3,
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              name: { type: 'string', description: 'Series name (needed when there are several).' },
              values: { type: 'array', items: { type: 'number' }, description: 'One value per label.' },
            },
            required: ['values'],
          },
        },
      },
      required: ['title', 'kind', 'labels', 'series'],
    },
  },
  {
    name: 'search_official',
    description:
      "Search Uzbekistan's official legislation portal lex.uz for an act that Lexab's verified database does not have — Cabinet of Ministers resolutions, Central Bank and ministry acts, very new laws. Call it only after search_law found nothing that answers the point. Returns acts with their type, date and number, whether they are in force, and a link to read with read_official. Write the query in Russian, as the act would be titled.",
    eager_input_streaming: true,
    input_schema: {
      type: 'object',
      additionalProperties: false,
      properties: { query: { type: 'string', description: 'e.g. «порядок государственной регистрации транспортных средств»' } },
      required: ['query'],
    },
  },
  {
    name: 'read_official',
    description:
      'Read a page of an official source: an act on lex.uz, a page of an Uzbek government site (gov.uz, cbu.uz, soliq.uz, mf.uz, adliya.uz and other *.gov.uz) or the official law portal of another supported country. Pass the URL (from search_official, or one you know on these sites) and a query to get the relevant part of a long act. Text from these sites is NOT from Lexab\'s verified database.',
    eager_input_streaming: true,
    input_schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        url: { type: 'string', description: 'https://lex.uz/ru/docs/… or a page of an allowed official site' },
        query: { type: 'string', description: 'What to find in the page (recommended for long acts).' },
      },
      required: ['url'],
    },
  },
];

/**
 * Где лежат «простые» цифры Узбекистана (замечание владельца 2026-11-09:
 * «сколько сумов 1 БРВ?» — агент исчерпал шаги, не найдя указ). Поиск lex.uz
 * полнотекстовый и сначала новые: по слову «базовая расчетная величина» он
 * выдаёт акты, где БРВ лишь упоминается, а нужного указа среди них нет.
 * Поэтому подсказка называет, КАКОЙ акт или страницу открыть, — без цифр
 * (цифры меняются; текст норм — только из инструментов, правило 1).
 * Каждый пункт проверен 09.11.2026: УП-115 от 23.06.2026 п. 3 (БРВ, МРОТ,
 * базовая величина пенсии); главная cbu.uz (основная ставка, курсы); JSON
 * курсов на дату; НК ст. 258/337/381 и ЗРУ-600 «О государственной пошлине»
 * (с таблицей ставок в конце) — в нашей базе; КоАО — в базе.
 */
const UZ_WHERE_TO_LOOK = `- WHERE UZBEK FIGURES LIVE — go straight there; a lex.uz search by the term itself returns acts that merely mention it, newest first, and wastes your steps:
  • Base calculation value (БРВ; bazaviy hisoblash miqdori, BHM), minimum wage (МРОТ; mehnatga haq to'lashning eng kam miqdori) and the base pension amount are set by the yearly presidential decree «О повышении размеров заработной платы, пенсий, стипендий и пособий». Call search_official with exactly that title, read_official the newest decree with a query such as «базовую расчетную величину», and give the amount with the date it applies from; before that date the previous decree's amount applies.
  • Administrative fines are set in multiples of БРВ: take the multiple from the Code of Administrative Responsibility (search_law), the current БРВ from that decree, and multiply with calculate.
  • The Central Bank's main rate («основная ставка», often called the refinancing rate) and today's official exchange rates: read_official https://cbu.uz/ru/ with the query «основная ставка курсы валют» (without a query you get only the site menu) — the main page shows both with their dates. An exchange rate on a past date: read_official https://cbu.uz/ru/arkhiv-kursov-valyut/json/USD/YYYY-MM-DD/ (EUR, RUB and other codes work the same way).
  • Tax rates (VAT, profit tax, personal income tax and others) are in the Tax Code, and state duty rates in the Law «О государственной пошлине» (ЗРУ-600, rate table at its end) — both are in the verified database: use search_law, not the internet.`;

/** Инструкция агенту — часть системного промпта (стабильная, кэшируется). */
export const CHAT_AGENT_INSTRUCTIONS = `TOOLS. You have tools for Lexab's verified statute database and the user's documents: search_law, get_provision, verify_citation, read_contract, search_documents, calculate; and, when the database lacks an act, official sites: search_official, read_official.
- Plan before you call: name the legal questions the answer turns on, check which of them the legal context above already covers, and search only for the rest — one focused query per question. Do not search for background the user did not ask about.
- Request independent calls together in ONE step — several searches, several provisions, several calculations at once — instead of one call per step: every step makes the user wait.
- The database holds statutes and codes and, for Uzbekistan, the Constitution, presidential decrees and resolutions, and Supreme Court Plenum resolutions: no individual court decisions or commentary, so do not search for them. A Plenum point explains how courts apply a statute — rely on it alongside the statute, never present it as a law.
- Use search_law and get_provision to check specifics that may differ from your training — what the law allows, requires, forbids or charges, and its deadlines — even when you feel confident. Statute text comes only from these tools or the legal context: never quote a law from memory.
- Before you finish, run verify_citation — all in one step — on the articles, sections, decree or Plenum points you cite that no tool and no legal context returned, and fix or drop a citation that comes back NOT_FOUND or NOT_SUPPORTED.
- When the verified database has no act that answers the point (often Cabinet of Ministers resolutions, Central Bank or ministry acts, very new laws), look on the official sites: search_official (lex.uz), then read_official. In the answer, name the act with its number and date, give its lex.uz link, and say plainly that this text comes from the official site and is not from Lexab's verified database. Do not rely on an act the search marks as NOT in force; if lex.uz warns that the page holds an old version or a text in another language, say so.
${UZ_WHERE_TO_LOOK}
- Use read_contract to find and quote the user's clauses exactly, and to read parts of long files that the context cuts off.
- Use search_documents for the user's earlier documents and the team's shared ones: past contracts with this counterparty, how they usually word a clause, earlier reviews. Name the document you rely on; never present a past document's terms as the current contract's.
- Do every computation that appears in your answer (penalties, interest, totals, deadlines, days between dates) with calculate.
- To change the contract under review, use propose_edit — one call per clause, with the clause copied exactly from the contract. The document changes only when the user presses the card's button (${uiLabel('acceptEdit')}), so never say it has already changed. ${LABEL_RULE}
- When the user asks for a document — a claim letter, supplementary agreement, notice, reply to a claim — take the parties, contract number and date, amounts and deadlines from the contract (read_contract) and their earlier documents (search_documents), compute sums with calculate, cite only verified provisions, leave [square brackets] for anything unknown, and put the whole document in ONE fenced block (\`\`\`) so the user can edit it, save it to Vault and export it.
- When the contract or the conversation sets a deadline the user must meet (payment, delivery, notice, claim response, renewal), offer to track it with propose_reminder — one call per deadline, with the exact date from calculate. It is added only when the user presses the button.
- For the firm's standard positions, call get_playbook and follow them in your advice; say which position you rely on.
- To compare two versions of a contract, call compare_versions and explain what each difference means for the user; never add or drop differences it did not return.
- For a protocol of disagreements, call get_review_edits and write the whole protocol as ONE fenced document: its heading (protocol of disagreements to contract № … of …, the parties), then a markdown table with the columns № | Clause | Contract wording | Our wording | Reason (column names in the user's language; <br> for a line break inside a cell), then signature lines for both parties. The user downloads it as a Word file with a real table.
- VISUALS — show, don't only tell, when it really helps: show_steps for an action plan of 3 or more steps; show_timeline when the answer turns on 3 or more dates; show_law for the one or two provisions the answer rests on; show_chart for computed numbers that are clearer as a picture. Each returns a marker such as [[lexab:1]]: put it on its own line where the card belongs and do not repeat its content in text. No visuals for greetings, short answers or simple questions; at most 3 per answer.
- The user sees each tool step in a progress panel, so do not narrate tool calls in text: call the tools you need, then write one complete answer. Do not use tools for greetings or for questions the context above already answers.`;

/**
 * Памятки задач — «специалисты» агента (lib/specialists.ts, решение владельца
 * 2026-11-14). Отдельно от CHAT_TOOLS: инструмент и строка инструкции есть
 * только в чатах по праву Узбекистана (specialistsOn) — карта привязана к
 * нормам корпуса УЗ. Памятка — карта норм, а не текст закона.
 */
export const TASK_GUIDE_TOOL: Anthropic.Beta.BetaTool = {
  name: 'task_guide',
  description:
    'Get the task guide for a common practical task under Uzbek law: what the answer depends on, a map of the provisions in the verified database that govern each sub-question (with unit ids for get_provision), and a checklist of points that are easy to miss. It is a map, not the law: it holds no rules or figures. Call it FIRST, before searching, when the user needs practical help with one of these tasks:\n' +
    SPECIALISTS.map((s) => `• ${s.id} — ${s.when}`).join('\n') +
    '\nNot for a greeting, a question about one known article, a definition or a single figure, or a task outside this list.',
  eager_input_streaming: true,
  input_schema: {
    type: 'object',
    additionalProperties: false,
    properties: { task: { type: 'string', enum: [...SPECIALIST_IDS], description: 'The task that best fits the question.' } },
    required: ['task'],
  },
};

export const TASK_GUIDE_INSTRUCTIONS = `- TASK GUIDES (Uzbek law). When the user needs practical help with a lease, a supply or sale of goods, employment or dismissal, collecting a debt or penalty (claim letter, court), works or services, or a limited liability company, call task_guide FIRST: it returns what the answer depends on, a map of the governing provisions with their ids, and a checklist. Then open the provisions the question turns on with get_provision — all in one step — and answer from their text. The guide is a map, not law: never cite or mention it, and never state a rule, figure or deadline you have not read in a provision or the legal context. A question that spans two tasks may take two guides in one step. Skip the guide for a greeting, a question about one known article, a definition or a single figure, a task outside these kinds, and a follow-up on a task whose guide you already have.`;

/* ── мелкие проверки входа ─────────────────────────────────────────────── */

class InputError extends Error {}

function record(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new InputError('input must be an object');
  return input as Record<string, unknown>;
}

function optString(o: Record<string, unknown>, key: string, max: number): string | undefined {
  const v = o[key];
  if (v === undefined || v === null || v === '') return undefined;
  if (typeof v !== 'string') throw new InputError(`${key} must be a string`);
  const s = v.trim();
  if (!s) return undefined;
  if (s.length > max) throw new InputError(`${key} is longer than ${max} characters`);
  return s;
}

function reqString(o: Record<string, unknown>, key: string, max: number): string {
  const s = optString(o, key, max);
  if (!s) throw new InputError(`${key} is required`);
  return s;
}

function optInt(o: Record<string, unknown>, key: string, min: number, max: number): number | undefined {
  const v = o[key];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) {
    throw new InputError(`${key} must be an integer from ${min} to ${max}`);
  }
  return v;
}

function jurisdictionOf(o: Record<string, unknown>, ctx: ChatToolContext): JurisdictionCode {
  const v = o.jurisdiction;
  if (v !== undefined && v !== null && v !== '') {
    if (typeof v !== 'string' || !JURISDICTIONS.includes(v as JurisdictionCode)) {
      throw new InputError(`jurisdiction must be one of ${JURISDICTIONS.join(', ')}`);
    }
    return v as JurisdictionCode;
  }
  if (!ctx.jurisdiction) throw new InputError('this conversation has no jurisdiction selected — pass jurisdiction');
  return ctx.jurisdiction;
}

export const UNIT_ID_RE = /^lu_[A-Za-z0-9_.-]{1,190}$/;

/* ── нормы из базы ─────────────────────────────────────────────────────── */

export interface UnitRow {
  id: string;
  breadcrumb: string;
  text: string;
  source_url: string;
  official_unit_uri: string | null;
  retrieved_at: string | Date;
  jurisdiction: string;
}

const today = () => new Date().toISOString().slice(0, 10);

/** Норма, действующая сегодня, + её части (у британских законов подпункты — отдельные строки). */
export async function loadUnit(db: Db, unitId: string): Promise<UnitRow | null> {
  const res = await db.query<UnitRow>(
    `SELECT u.id, u.breadcrumb, u.text, u.source_url, u.official_unit_uri, u.retrieved_at, d.jurisdiction
     FROM legal_units u JOIN legal_documents d ON d.id = u.document_id
     WHERE u.id = $1
       AND (u.valid_from IS NULL OR u.valid_from <= $2::date)
       AND (u.valid_to   IS NULL OR u.valid_to   >= $2::date)`,
    [unitId, today()],
  );
  const row = res.rows[0];
  if (!row) return null;
  const kids = await db.query<{ text: string }>(
    `SELECT text FROM legal_units
     WHERE parent_id = $1 AND text <> ''
       AND (valid_from IS NULL OR valid_from <= $2::date)
       AND (valid_to   IS NULL OR valid_to   >= $2::date)
     ORDER BY ord ASC, id ASC LIMIT 60`,
    [unitId, today()],
  );
  const extra = kids.rows.map((k) => k.text.trim()).filter((t) => t && !row.text.includes(t.slice(0, 80)));
  if (extra.length) row.text = [row.text.trim(), ...extra].filter(Boolean).join('\n');
  return row;
}

function unitHeader(u: UnitRow): string {
  const link = u.official_unit_uri || u.source_url;
  const at = new Date(u.retrieved_at);
  const when = Number.isNaN(at.getTime()) ? '' : `, retrieved ${at.toISOString().slice(0, 10)}`;
  return `[${u.id}] ${u.breadcrumb}\nOfficial source: ${link}${when}`;
}

/* ── калькулятор: свой разбор выражения, без eval ──────────────────────── */

type Tok = { t: 'num'; v: number } | { t: 'id'; v: string } | { t: 'op'; v: string };

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    const num = /^(\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?/.exec(src.slice(i));
    if (num) {
      out.push({ t: 'num', v: Number(num[0]) });
      i += num[0].length;
      continue;
    }
    const id = /^[a-z]+/i.exec(src.slice(i));
    if (id) {
      out.push({ t: 'id', v: id[0].toLowerCase() });
      i += id[0].length;
      continue;
    }
    if ('+-*/^(),'.includes(c)) {
      out.push({ t: 'op', v: c });
      i++;
      continue;
    }
    throw new InputError(`unexpected character «${c}» in the expression`);
  }
  return out;
}

const FUNCS: Record<string, (args: number[]) => number> = {
  min: (a) => (a.length ? Math.min(...a) : NaN),
  max: (a) => (a.length ? Math.max(...a) : NaN),
  abs: (a) => (a.length === 1 ? Math.abs(a[0]) : NaN),
  floor: (a) => (a.length === 1 ? Math.floor(a[0]) : NaN),
  ceil: (a) => (a.length === 1 ? Math.ceil(a[0]) : NaN),
  round: (a) => {
    if (a.length < 1 || a.length > 2) return NaN;
    const d = a[1] ?? 0;
    if (!Number.isInteger(d) || d < 0 || d > 10) return NaN;
    const f = 10 ** d;
    return Math.round(a[0] * f) / f;
  },
};

/** Арифметика модели — только числа, + - * / ^, скобки и несколько функций. */
export function evaluateExpression(src: string): number {
  if (src.length > 500) throw new InputError('expression is too long');
  const toks = tokenize(src);
  let p = 0;
  let depth = 0;
  const peek = () => toks[p];
  const isOp = (v: string) => peek()?.t === 'op' && peek()?.v === v;
  const expect = (v: string) => {
    if (!isOp(v)) throw new InputError(`expected «${v}»`);
    p++;
  };
  const guard = () => {
    if (++depth > 100) throw new InputError('expression is nested too deeply');
  };
  const expr = (): number => {
    guard();
    let v = term();
    while (isOp('+') || isOp('-')) {
      const op = (toks[p++] as { v: string }).v;
      const r = term();
      v = op === '+' ? v + r : v - r;
    }
    depth--;
    return v;
  };
  const term = (): number => {
    let v = power();
    while (isOp('*') || isOp('/')) {
      const op = (toks[p++] as { v: string }).v;
      const r = power();
      if (op === '/' && r === 0) throw new InputError('division by zero');
      v = op === '*' ? v * r : v / r;
    }
    return v;
  };
  const power = (): number => {
    const base = unary();
    if (isOp('^')) {
      p++;
      return base ** power();
    }
    return base;
  };
  const unary = (): number => {
    if (isOp('-')) {
      p++;
      guard();
      const v = -unary();
      depth--;
      return v;
    }
    if (isOp('+')) {
      p++;
      return unary();
    }
    return primary();
  };
  const primary = (): number => {
    const tok = peek();
    if (!tok) throw new InputError('the expression ends too early');
    if (tok.t === 'num') {
      p++;
      return tok.v;
    }
    if (tok.t === 'id') {
      const fn = FUNCS[tok.v];
      if (!fn) throw new InputError(`unknown function «${tok.v}»`);
      p++;
      expect('(');
      const args: number[] = [];
      if (!isOp(')')) {
        args.push(expr());
        while (isOp(',')) {
          p++;
          args.push(expr());
        }
      }
      expect(')');
      const v = fn(args);
      if (Number.isNaN(v)) throw new InputError(`wrong arguments for ${tok.v}()`);
      return v;
    }
    if (tok.v === '(') {
      p++;
      const v = expr();
      expect(')');
      return v;
    }
    throw new InputError(`unexpected «${tok.v}»`);
  };
  const result = expr();
  if (p !== toks.length) throw new InputError('unexpected text after the expression');
  if (!Number.isFinite(result)) throw new InputError('the result is not a finite number');
  return result;
}

function formatNumber(n: number): string {
  const rounded = Math.abs(n) >= 1e15 ? n : Number(n.toFixed(6));
  const grouped = rounded.toLocaleString('en-US', { maximumFractionDigits: 6 }).replace(/,/g, ' ');
  return `${rounded} (${grouped})`;
}

/** YYYY-MM-DD или DD.MM.YYYY → дата UTC; несуществующая дата — ошибка. */
export function parseDate(s: string): Date {
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.trim());
  const ru = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(s.trim());
  const [y, m, d] = iso ? [+iso[1], +iso[2], +iso[3]] : ru ? [+ru[3], +ru[2], +ru[1]] : [NaN, NaN, NaN];
  const date = new Date(Date.UTC(y, m - 1, d));
  if (Number.isNaN(date.getTime()) || date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) {
    throw new InputError(`«${s}» is not a valid date (use YYYY-MM-DD or DD.MM.YYYY)`);
  }
  return date;
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
function showDate(d: Date): string {
  const iso = d.toISOString().slice(0, 10);
  const [y, m, day] = iso.split('-');
  return `${iso} (${day}.${m}.${y}, ${WEEKDAYS[d.getUTCDay()]})`;
}

/** Дата + годы/месяцы/дни; 31 января + 1 месяц = последний день февраля. */
export function addPeriod(start: Date, years = 0, months = 0, days = 0): Date {
  const totalMonths = start.getUTCFullYear() * 12 + start.getUTCMonth() + years * 12 + months;
  const y = Math.floor(totalMonths / 12);
  const m = totalMonths - y * 12;
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const shifted = new Date(Date.UTC(y, m, Math.min(start.getUTCDate(), lastDay)));
  return new Date(shifted.getTime() + days * 86_400_000);
}

/* ── поиск по тексту договора ──────────────────────────────────────────── */

/** Основы слов запроса: русская морфология режется до 6 букв («неустойки» → «неусто»). */
function queryStems(q: string): string[] {
  const words = q.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? [];
  return [...new Set(words.map((w) => (w.length > 6 ? w.slice(0, 6) : w)))].slice(0, 12);
}

interface Passage {
  doc: string;
  start: number;
  end: number;
  text: string;
  score: number;
}

/** Документ → куски по ~800 символов по границам строк. */
function passages(doc: ChatDocument): Passage[] {
  const out: Passage[] = [];
  let start = 0;
  let buf = '';
  let pos = 0;
  for (const line of doc.text.split('\n')) {
    if (buf && buf.length + line.length > 800) {
      out.push({ doc: doc.name, start, end: start + buf.length, text: buf, score: 0 });
      start = pos;
      buf = '';
    }
    buf += (buf ? '\n' : '') + line;
    pos += line.length + 1;
  }
  if (buf.trim()) out.push({ doc: doc.name, start, end: start + buf.length, text: buf, score: 0 });
  return out;
}

/* ── какие нормы ответ действительно цитирует (для вкладки Sources) ─────── */

/** Номер нормы из подписи: «ст.261» → 261, «§ 312g» → 312g, «п.5» → 5, «Article 125» → 125. */
const SUPERSCRIPT: Record<string, string> = { '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9' };

/** «175⁴» → «175-4»: так lex.uz пишет статьи с индексом, в базе они «175-4». */
function normalizeSuperscripts(text: string): string {
  return text.replace(/(\d)([⁰¹²³⁴⁵⁶⁷⁸⁹]+)/gu, (_m, d: string, sup: string) => `${d}-${[...sup].map((c) => SUPERSCRIPT[c]).join('')}`);
}

/**
 * Номера из перечня после слова-указателя: «260, 261 и 263» → 260, 261, 263.
 * «175-4» (без пробелов, второе число не больше первого) — одна статья с
 * индексом (КоАО ст. 175-4, ГК ст. 1-1), а не статьи 175 и 4: раньше номер
 * распадался, и проверка ссылок не узнавала такие статьи (вопрос о штрафе,
 * 09.11). «10-15» — может быть диапазоном: и «10-15», и 10, 15.
 */
function provisionNumbers(list: string): string[] {
  const out: string[] = [];
  for (const m of normalizeSuperscripts(list).toLowerCase().matchAll(/(\d+[a-zа-я]?)(?:-(\d+[a-zа-я]?))?/gu)) {
    if (!m[2]) {
      out.push(m[1]);
      continue;
    }
    out.push(`${m[1]}-${m[2]}`);
    if (parseInt(m[2], 10) > parseInt(m[1], 10)) out.push(m[1], m[2]);
  }
  return out;
}

export function refNumber(label: string): string | null {
  const all = provisionNumbers(label);
  return all.length ? all[all.length - 1] : null;
}

/**
 * Номера норм, на которые ссылается текст ответа: «ст. 326 ГК», «статьи 260, 261 и 263»,
 * «§ 433 BGB», «s.14», «Article 125», «п. 5 УП-6079», «п. 6 постановления Пленума ВХС № 163». Голые числа (суммы, дни)
 * не считаются — только после слова-указателя нормы.
 */
export function citedProvisionNumbers(text: string): Set<string> {
  const out = new Set<string>();
  const re =
    /(?<!\p{L})(?:ст\.|ст(?=\s)|стать[а-яё]*|§§?|ss?\.|sections?|art\.|articles?|п\.|пункт[а-яё]*|modda[a-z]*)\s*(\d+[a-zа-я]?(?:\s*(?:,|и|and|va|–|-)\s*\d+[a-zа-я]?)*)/giu;
  for (const m of normalizeSuperscripts(text).toLowerCase().matchAll(re)) {
    for (const n of provisionNumbers(m[1])) out.add(n);
  }
  return out;
}

/** Шаблон ILIKE («%О залоге%», «Гражданский кодекс%») → совпадает ли строка. */
function likeMatches(pattern: string, value: string): boolean {
  // Как ILIKE в базе: «%» — любые символы, «_» — один любой (им в шаблоне
  // стоит «ё» из кавычек: «учёте» совпадает с «учете»).
  const body = pattern
    .split('%')
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/_/g, '.'))
    .join('.*');
  return new RegExp(`^${body}$`, 'isu').test(value);
}

/**
 * Назван ли рядом с номером нормы тот же акт: «ст. 333 ГК» → Гражданский
 * кодекс, «п. 4 постановления Пленума ВХС № 163» → Пленум ВХС № 163,
 * «п. 5 УП-6079» → указ УП-6079. Акт не назван или страна без таблицы
 * алиасов → 'unknown' (решает прежнее правило — по номеру).
 */
function actAgrees(window: string, actTitle: string, jurisdiction: string, isPoint: boolean): 'match' | 'mismatch' | 'unknown' {
  if (isPoint && jurisdiction === 'UZ') {
    const pl = parseUzPlenumCitation(window);
    if (pl) {
      const court = pl.court === 'ВС+ВХС' ? '(ВС и ВХС)' : `(${pl.court})`;
      const num = new RegExp(`№ ${pl.actNumber.replace('/', '\\/')}(?![\\d/])`, 'u');
      return actTitle.includes(court) && num.test(actTitle) ? 'match' : 'mismatch';
    }
    const dec = parseUzDecreeCitation(window);
    if (dec) return new RegExp(`(?<![А-ЯA-Z])${dec.docNumber}(?!\\d)`, 'u').test(actTitle) ? 'match' : 'mismatch';
  }
  const ru = parseRuCitation(window, jurisdiction);
  if (ru) return likeMatches(ru.titlePattern, actTitle) || (ru.fallbackPattern !== undefined && likeMatches(ru.fallbackPattern, actTitle)) ? 'match' : 'mismatch';
  return 'unknown';
}

/**
 * Цитирует ли ответ ИМЕННО эту норму, а не одноимённый номер другого акта.
 * Раньше источник попадал в Sources по одному номеру: «ст. 333 ГК» в тексте
 * подтягивала найденную по ходу ст. 333 Трудового кодекса. Теперь рядом с
 * номером должен стоять тот же акт; если акт возле номера не назван —
 * прежнее правило (номер совпал — источник показываем).
 */
export function citesProvision(text: string, number: string, actTitle: string, jurisdiction: string): boolean {
  const re =
    /(?<!\p{L})(ст\.|ст(?=\s)|стать[а-яё]*|§§?|ss?\.|sections?|art\.|articles?|п\.|пункт[а-яё]*|modda[a-z]*)\s*(\d+[a-zа-я]?(?:\s*(?:,|и|and|va|–|-)\s*\d+[a-zа-я]?)*)/giu;
  const want = number.toLowerCase();
  let unknown = false;
  const norm = normalizeSuperscripts(text);
  for (const m of norm.matchAll(re)) {
    const nums = provisionNumbers(m[2]);
    if (!nums.includes(want)) continue;
    const end = (m.index ?? 0) + m[0].length;
    const tail = norm.slice(end, end + 90).split('\n')[0];
    const verdict = actAgrees(`${m[1]} ${number}${tail}`, actTitle, jurisdiction, /^п/iu.test(m[1]));
    if (verdict === 'match') return true;
    if (verdict === 'unknown') unknown = true;
  }
  return unknown;
}

/* ── сами инструменты ──────────────────────────────────────────────────── */

const MAX_RESULT_CHARS = 9000;
const clipResult = (s: string) => (s.length > MAX_RESULT_CHARS ? `${s.slice(0, MAX_RESULT_CHARS)}\n[…cut]` : s);
const clipText = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/**
 * Исполнитель инструментов на один ответ. Нумерует шаги tool-1, tool-2, …
 * Никогда не бросает: любая ошибка возвращается модели текстом с isError.
 */
export function createChatToolRunner(ctx: ChatToolContext): {
  tools: Anthropic.Beta.BetaTool[];
  run: (call: ToolCall) => Promise<ToolOutcome>;
  /** Инструкция агенту под этот набор инструментов (с памятками — только УЗ). */
  instructions: string;
} {
  let n = 0;
  // Памятки задач («специалисты») — только чаты по праву Узбекистана.
  const guides = specialistsOn(ctx.jurisdiction);
  // VISUALS=off — без наглядных блоков (замер «до / после», быстрый откат).
  const visualsEnabled = visualsOn();
  const base = visualsEnabled ? CHAT_TOOLS : CHAT_TOOLS.filter((t) => !VISUAL_TOOL_NAMES.includes(t.name));
  const tools = guides ? [...base, TASK_GUIDE_TOOL] : base;
  const agentInstructions = visualsEnabled
    ? CHAT_AGENT_INSTRUCTIONS
    : CHAT_AGENT_INSTRUCTIONS.split('\n').filter((l) => !l.startsWith('- VISUALS')).join('\n');
  // Документы пользователя грузятся (и расшифровываются) один раз на ответ.
  let memory: Promise<MemoryDoc[]> | null = null;
  // Предложенные в этом ответе правки: без дублей и не больше пяти.
  const proposed = new Set<string>();
  const reminded = new Set<string>();
  // Наглядные блоки этого ответа и числа, которые можно рисовать на графике:
  // из вопроса, документов чата и результатов инструментов (калькулятор!).
  let visuals = 0;
  const known: number[] = [];
  let knownSeeded = false;
  const knownNumbers = (): number[] => {
    if (!knownSeeded) {
      knownSeeded = true;
      known.push(...numbersIn(ctx.question ?? ''));
      for (const d of ctx.documents) known.push(...numbersIn(d.text.slice(0, 200_000)));
    }
    return known;
  };
  const addVisual = (v: Visual): string => {
    visuals += 1;
    ctx.onVisual?.(v);
    return visualMarker(visuals);
  };
  // Акты из поиска lex.uz этого ответа (по id страницы) — чтобы открытая потом
  // страница получила в Sources ту же подпись «ПКМ № 428 от 31.08.2023».
  const lexActs = new Map<string, OfficialActRef>();
  const plan = ctx.plan;
  const lockedFor = (feature: 'clm' | 'playbooks' | 'compare', what: string) =>
    plan && !planHasFeature(plan, feature) ? `NOT_AVAILABLE: ${what} are on the Pro and Business plans (the user is on ${plan}). Tell the user, and help in text instead.` : null;
  const firmMemory = () => (memory ??= loadFirmMemory(ctx.db, ctx.userId as string));
  // Граф документов (lib/docGraph.ts): допсоглашения, приложения, версии — один
  // раз на ответ, по тем же документам, что видит «память фирмы».
  let graph: { g: ReturnType<typeof buildDocGraph>; byId: Map<string, MemoryDoc> } | undefined;
  const related = async (docId: string): Promise<string[]> => {
    if (!graph) {
      const docs = await firmMemory();
      graph = { g: buildDocGraph(docs), byId: new Map(docs.map((d) => [d.id, d])) };
    }
    return relatedLines(docId, graph.g, graph.byId);
  };
  const relatedBlock = (lines: string[], indent = '') => (lines.length ? `\n${indent}Related documents (from their headings): ${lines.join(' | ')}` : '');

  const run = async (call: ToolCall): Promise<ToolOutcome> => {
    const name = call.name as ChatToolName;
    const id = `tool-${++n}` as const;
    let shown = false; // шаг уже показан — при ошибке его надо закрыть
    const step = (status: ChatStep['status'], data: NonNullable<ChatStep['data']>) => {
      shown = true;
      ctx.onStep?.({ id, status, data: { tool: name, ...data } });
    };
    try {
      const o = record(call.input);
      switch (name) {
        case 'search_law': {
          const query = reqString(o, 'query', 500);
          const jurisdiction = jurisdictionOf(o, ctx);
          const limit = optInt(o, 'limit', 1, 8) ?? 5;
          step('active', { jurisdiction, queries: [query] });
          const hits = await retrieveLegalContext(ctx.db, { query, jurisdiction, topK: limit });
          const refs = await ctx.toRefs(hits.map((h) => ({ unitId: h.unitId, breadcrumb: h.breadcrumb })));
          ctx.onRefs?.(refs, 'found');
          step('done', { jurisdiction, queries: [query], found: hits.length, refs: refs.slice(0, 4) });
          if (!hits.length) return { content: `NO_RESULTS in the ${jurisdiction} database for «${query}». Try other wording or another act.`, keys: [] };
          return {
            content: clipResult(
              hits.map((h) => contextLine(h, 1200)).join('\n---\n') +
                '\n\nOpen a provision with get_provision before quoting its details.',
            ),
            keys: hits.map((h) => h.unitId),
          };
        }

        case 'get_provision': {
          const unitIdIn = optString(o, 'unit_id', 200);
          const citation = optString(o, 'citation', 300);
          if (!unitIdIn && !citation) throw new InputError('pass unit_id or citation');
          if (unitIdIn && !UNIT_ID_RE.test(unitIdIn)) throw new InputError('unit_id looks wrong — copy it from the square brackets');
          step('active', { citation: citation ?? unitIdIn });
          const unitId = unitIdIn ?? (await resolveCitationText(ctx.db, citation as string, jurisdictionOf(o, ctx)));
          const unit = unitId ? await loadUnit(ctx.db, unitId) : null;
          if (!unit) {
            step('done', { citation: citation ?? unitIdIn, found: 0 });
            return {
              content: `NOT_FOUND: no provision «${citation ?? unitIdIn}» in force in the Lexab database. Do not cite it; search for the right one with search_law.`,
              keys: [],
            };
          }
          const refs = await ctx.toRefs([{ unitId: unit.id, breadcrumb: unit.breadcrumb }]);
          ctx.onRefs?.(refs, 'used');
          step('done', { citation: citation ?? refs[0]?.label ?? unit.id, found: 1, refs });
          return { content: clipResult(`${unitHeader(unit)}\n\n${unit.text}`) };
        }

        case 'verify_citation': {
          const citation = reqString(o, 'citation', 300);
          const claim = reqString(o, 'claim', 600);
          const unitIdIn = optString(o, 'unit_id', 200);
          if (unitIdIn && !UNIT_ID_RE.test(unitIdIn)) throw new InputError('unit_id looks wrong — copy it from the square brackets');
          step('active', { citation });
          const unitId = unitIdIn ?? (await resolveCitationText(ctx.db, citation, jurisdictionOf(o, ctx)));
          const unit = unitId ? await loadUnit(ctx.db, unitId) : null;
          if (!unit) {
            step('done', { citation, verdict: 'not_found' });
            return {
              content: `NOT_FOUND: «${citation}» does not resolve to a provision in force in the Lexab database (wrong number, wrong act, or the act is not in the database). Find the right provision with search_law, or do not cite it.`,
              keys: [],
            };
          }
          const verdict = await judgeProvision(unit.text, unit.breadcrumb, { title: claim, citation });
          const refs = await ctx.toRefs([{ unitId: unit.id, breadcrumb: unit.breadcrumb }]);
          const label = verdict === true ? 'supported' : verdict === false ? 'not_supported' : 'unchecked';
          if (verdict === true) ctx.onRefs?.(refs, 'used');
          step('done', { citation, verdict: label, refs });
          const text = unit.text.slice(0, 1500);
          if (verdict === true) return { content: `SUPPORTED: ${unitHeader(unit)}\nThe provision governs this point.\n\n${text}` };
          if (verdict === false) {
            return {
              content: `NOT_SUPPORTED: ${unitHeader(unit)}\nThis provision is about something else. Search for the provision that governs «${claim}», or drop the citation.\n\n${text}`,
            };
          }
          return { content: `FOUND (not semantically checked — the checker is unavailable): ${unitHeader(unit)}\nRead it and decide yourself.\n\n${text}` };
        }

        case 'read_contract': {
          const query = optString(o, 'query', 300);
          const docName = optString(o, 'document', 200);
          const from = optInt(o, 'from_char', 0, 50_000_000);
          if (!ctx.documents.length) {
            step('done', {});
            return { content: 'NO_DOCUMENTS: no contract or file is attached to this conversation.', keys: [] };
          }
          const docs = docName ? ctx.documents.filter((d) => d.name.toLowerCase().includes(docName.toLowerCase())) : ctx.documents;
          const names = ctx.documents.map((d) => `«${d.name}» (${d.text.length} chars)`).join(', ');
          if (!docs.length) return { content: `NOT_FOUND: no document matches «${docName}». Documents: ${names}.`, isError: true };
          step('active', { files: docs.map((d) => d.name), ...(query ? { queries: [query] } : {}) });
          let content: string;
          if (from !== undefined) {
            const d = docs[0];
            const part = d.text.slice(from, from + 6000);
            content = part
              ? `«${d.name}», chars ${from}–${from + part.length} of ${d.text.length}:\n${part}`
              : `«${d.name}» has only ${d.text.length} characters.`;
          } else if (query) {
            const stems = queryStems(query);
            const scored = docs
              .flatMap(passages)
              .map((p) => {
                const low = p.text.toLowerCase();
                return { ...p, score: stems.reduce((s, w) => s + (low.split(w).length - 1), 0) };
              })
              .filter((p) => p.score > 0)
              .sort((a, b) => b.score - a.score)
              .slice(0, 5)
              .sort((a, b) => (a.doc === b.doc ? a.start - b.start : a.doc.localeCompare(b.doc)));
            content = scored.length
              ? scored.map((p) => `[«${p.doc}», chars ${p.start}–${p.end}]\n${p.text}`).join('\n---\n')
              : `NO_MATCH for «${query}». Try other words, or read by position with from_char. Documents: ${names}.`;
          } else {
            content = `Documents: ${names}.\n\n` + docs.map((d) => `«${d.name}», chars 0–${Math.min(3000, d.text.length)}:\n${d.text.slice(0, 3000)}`).join('\n---\n');
          }
          step('done', { files: docs.map((d) => d.name), ...(query ? { queries: [query] } : {}) });
          return { content: clipResult(content) };
        }

        case 'propose_edit': {
          if (!ctx.editTarget) {
            return {
              content: 'NOT_AVAILABLE: no contract review the user can edit is open in this conversation. Give the new wording in text instead.',
              isError: true,
            };
          }
          const clause = reqString(o, 'clause', 4000);
          const v = o.new_text;
          if (typeof v !== 'string') throw new InputError('new_text must be a string (empty to delete the clause)');
          if (v.length > 4000) throw new InputError('new_text is longer than 4000 characters');
          const reason = optString(o, 'reason', 500) ?? '';
          const problem = checkProposal(ctx.editTarget, clause, v);
          if (problem) return { content: `ERROR: ${problem}`, isError: true };
          const key = `${clause.replace(/\s+/g, ' ').trim()}\u0000${v.replace(/\s+/g, ' ').trim()}`;
          if (!proposed.has(key)) {
            if (proposed.size >= 5) return { content: 'ERROR: at most 5 edits per answer — the user can ask for more next.', isError: true };
            proposed.add(key);
            ctx.onProposal?.({ analysisId: ctx.editTarget.analysisId, delText: clause.trim(), insText: v.trim(), reason });
          }
          step('done', { citation: clause.replace(/\s+/g, ' ').slice(0, 80) });
          return {
            content: `PROPOSED: the user sees this edit as a card with a button labelled ${uiLabel('acceptEdit')} under your answer. Say in one sentence what it changes; do not repeat the new wording. ${LABEL_RULE}`,
          };
        }

        case 'get_review_edits': {
          if (!ctx.review) return { content: 'NO_REVIEW: no contract review is open in this conversation.', isError: true };
          step('active', {});
          const text = await reviewEditsText(ctx.db, ctx.review.ownerId, ctx.review.analysisId);
          step('done', {});
          return { content: clipResult(text) };
        }

        case 'search_documents': {
          if (!ctx.userId) throw new InputError('the user\'s documents are not available here');
          const query = optString(o, 'query', 300);
          const docId = optString(o, 'document_id', 100);
          const from = optInt(o, 'from_char', 0, 50_000_000);
          const limit = optInt(o, 'limit', 1, 8) ?? 5;
          if (!query && !docId) throw new InputError('pass query or document_id');
          step('active', query ? { queries: [query] } : {});
          const docs = await firmMemory();
          if (docId) {
            // Открыть можно только документ из доступного набора — чужой id = «не найден».
            const doc = docs.find((d) => d.id === docId);
            if (!doc) {
              step('done', { found: 0 });
              return { content: `NOT_FOUND: no document [${docId}] among the user's documents.`, isError: true };
            }
            let body: string;
            if (from !== undefined) {
              const part = doc.text.slice(from, from + 6000);
              body = part ? `chars ${from}–${from + part.length} of ${doc.text.length}:\n${part}` : `The document has only ${doc.text.length} characters.`;
            } else if (query) {
              const top = scorePassages(doc.text, stemsOf(query))
                .filter((p) => p.score > 0)
                .sort((a, b) => b.score - a.score)
                .slice(0, 5)
                .sort((a, b) => a.start - b.start);
              body = top.length ? top.map((p) => `[chars ${p.start}–${p.end}]\n${p.text}`).join('\n---\n') : `NO_MATCH for «${query}» in this document.`;
            } else {
              body = `chars 0–${Math.min(3000, doc.text.length)}:\n${doc.text.slice(0, 3000)}`;
            }
            step('done', { files: [doc.name], found: 1, ...(query ? { queries: [query] } : {}) });
            const summary = doc.summary ? `Review summary: ${doc.summary.slice(0, 600)}\n` : '';
            const links = await related(doc.id);
            // Связи — ДО текста: обрезка длинного результата их не съест.
            return { content: clipResult(`${docHeader(doc)}${relatedBlock(links)}${links.length ? '\nAmendments can change the terms of the contract — when the question is about current terms, check them and say which document a term comes from.' : ''}\n${summary}\n${body}`) };
          }
          const hits = searchMemory(docs, query as string, limit);
          step('done', { queries: [query as string], found: hits.length, files: hits.slice(0, 4).map((h) => h.doc.name) });
          if (!hits.length) {
            return {
              content: docs.length
                ? `NO_MATCH among the user's ${docs.length} documents for «${query}». Try other words (a counterparty name, a clause topic).`
                : 'NO_DOCUMENTS: the user has no saved documents yet.',
              keys: [],
            };
          }
          const hitLinks = await Promise.all(hits.map((h) => related(h.doc.id)));
          return {
            content: clipResult(
              hits
                .map(
                  (h, i) =>
                    `${docHeader(h.doc)}${relatedBlock(hitLinks[i])}\n${h.doc.summary ? `Summary: ${h.doc.summary.slice(0, 300)}\n` : ''}` +
                    h.passages.map((p) => `[chars ${p.start}–${p.end}] ${p.text.slice(0, 700)}`).join('\n…\n'),
                )
                .join('\n---\n') + '\n\nRead one further with document_id.',
            ),
          };
        }

        case 'propose_reminder': {
          if (!ctx.userId) throw new InputError('reminders are not available here');
          const locked = lockedFor('clm', `deadline reminders (section ${uiLabel('deadlinesSection')})`);
          if (locked) return { content: locked, isError: true };
          const what = reqString(o, 'what', 300);
          const due = parseDate(reqString(o, 'due_date', 20)).toISOString().slice(0, 10);
          if (due < new Date().toISOString().slice(0, 10)) throw new InputError('the deadline is in the past');
          const days = optInt(o, 'remind_days_before', 0, 60) ?? 3;
          const docIdIn = optString(o, 'document_id', 100);
          let documentId: string | null = null;
          let documentName = '';
          if (docIdIn) {
            const doc = (await firmMemory()).find((d) => d.id === docIdIn && d.kind === 'contract');
            if (!doc) return { content: `NOT_FOUND: no contract [${docIdIn}] among the user's documents.`, isError: true };
            documentId = doc.id;
            documentName = doc.name;
          } else if (ctx.review?.documentId) {
            documentId = ctx.review.documentId;
            documentName = ctx.review.documentName ?? '';
          }
          if (!documentId) {
            return { content: 'NO_DOCUMENT: no contract is open in this conversation — find it with search_documents and pass its document_id, or give the date in text.', isError: true };
          }
          const access = await resolveDocumentAccess(ctx.db, ctx.userId, documentId).catch(() => null);
          if (!access || !canEdit(access.access)) {
            return { content: 'NOT_ALLOWED: the user cannot add deadlines to this contract (view-only). Give the date in text.', isError: true };
          }
          const key = `${documentId}\u0000${due}\u0000${what.toLowerCase()}`;
          if (!reminded.has(key)) {
            if (reminded.size >= 5) return { content: 'ERROR: at most 5 reminders per answer.', isError: true };
            reminded.add(key);
            ctx.onReminder?.({ documentId, documentName: documentName || access.doc.name, text: what, dueDate: due, remindDaysBefore: days });
          }
          const [y, m, d] = due.split('-');
          step('done', { citation: `${d}.${m}.${y} — ${what.slice(0, 60)}` });
          return {
            content: `PROPOSED: the user sees a card «${what}» due ${d}.${m}.${y} with a button labelled ${uiLabel('addReminder')}; after they press it, the deadline goes to ${uiLabel('deadlinesSection')} and an email comes ${days} day(s) before. Mention it in one sentence. ${LABEL_RULE}`,
          };
        }

        case 'get_playbook': {
          if (!ctx.userId) throw new InputError('the playbook is not available here');
          const ownerId = await resolvePlaybookOwner(ctx.db, ctx.userId);
          const ownerPlan = ownerId === ctx.userId ? plan : await planFor(ctx.db, ownerId).catch(() => plan);
          if (plan && !planHasFeature(plan, 'playbooks') && !(ownerPlan && planHasFeature(ownerPlan, 'playbooks'))) {
            return { content: lockedFor('playbooks', 'playbooks') as string, isError: true };
          }
          step('active', {});
          const text = await loadActivePlaybook(ctx.db, ownerId, ctx.jurisdiction);
          step('done', { found: text ? 1 : 0 });
          if (!text) return { content: 'NO_PLAYBOOK: the team has no active playbook for this jurisdiction. Say so; the user can set one up in Playbooks.', keys: [] };
          const topic = optString(o, 'topic', 200);
          if (topic) {
            const stems = stemsOf(topic);
            const [head, ...rules] = text.split('\n');
            const hits = rules.filter((r) => stems.some((w) => r.toLowerCase().includes(w)));
            if (hits.length) return { content: clipResult(`${head}\n${hits.join('\n')}\n(${rules.length - hits.length} other rules omitted — call without topic for all)`) };
          }
          return { content: clipResult(text) };
        }

        case 'compare_versions': {
          if (!ctx.userId) throw new InputError('comparison is not available here');
          const locked = lockedFor('compare', 'version comparisons');
          if (locked) return { content: locked, isError: true };
          const oldRef = reqString(o, 'old', 300);
          const newRef = optString(o, 'new', 300);
          const resolve = async (ref: string): Promise<ChatDocument | null> => {
            const mem = (await firmMemory()).find((d) => d.id === ref);
            if (mem) return { name: mem.name, text: mem.text, pure: true };
            const low = ref.toLowerCase();
            return ctx.documents.find((d) => d.pure && d.name.toLowerCase().includes(low)) ?? null;
          };
          const before = await resolve(oldRef);
          if (!before?.text.trim()) return { content: `NOT_FOUND: no document or attached file «${oldRef}» with readable text.`, isError: true };
          let after: ChatDocument | null = null;
          if (newRef) after = await resolve(newRef);
          else if (ctx.review) {
            after = { name: ctx.review.documentName || 'contract under review', text: await reviewSourceText(ctx.db, ctx.review.ownerId, ctx.review.analysisId), pure: true };
          } else after = ctx.documents.find((d) => d.pure && d.name !== before.name) ?? null;
          if (!after?.text.trim()) return { content: 'NOT_FOUND: no newer version to compare with — attach it or pass `new`.', isError: true };
          step('active', { files: [before.name, after.name] });
          const { changes, truncated } = diffClauses(before.text, after.text);
          step('done', { files: [before.name, after.name], found: changes.length });
          return {
            content: clipResult(
              `«${before.name}» (older) → «${after.name}» (newer)\n${formatChanges(changes)}${truncated ? '\nNote: very long documents — only the first 1500 clauses of each were compared.' : ''}`,
            ),
          };
        }

        case 'calculate': {
          const op = reqString(o, 'operation', 20);
          if (op === 'evaluate') {
            const expression = reqString(o, 'expression', 500);
            const v = evaluateExpression(expression);
            const result = formatNumber(v);
            step('done', { expression, result });
            return { content: `${expression} = ${result}` };
          }
          if (op === 'days_between') {
            const from = parseDate(reqString(o, 'from_date', 20));
            const to = parseDate(reqString(o, 'to_date', 20));
            const diff = Math.round((to.getTime() - from.getTime()) / 86_400_000);
            const expression = `${showDate(from)} → ${showDate(to)}`;
            const result = `${diff} days`;
            step('done', { expression, result });
            return {
              content: `From ${showDate(from)} to ${showDate(to)}: ${diff} calendar days (end minus start). Counting both the first and the last day: ${diff + (diff >= 0 ? 1 : -1)}.`,
            };
          }
          if (op === 'add_period') {
            const start = parseDate(reqString(o, 'date', 20));
            const years = optInt(o, 'years', -200, 200) ?? 0;
            const months = optInt(o, 'months', -2400, 2400) ?? 0;
            const days = optInt(o, 'days', -100_000, 100_000) ?? 0;
            const end = addPeriod(start, years, months, days);
            const parts = [years && `${years} y`, months && `${months} mo`, days && `${days} d`].filter(Boolean).join(' ') || '0 d';
            const expression = `${showDate(start)} + ${parts}`;
            step('done', { expression, result: showDate(end) });
            return { content: `${showDate(start)} + ${parts} = ${showDate(end)}. Calendar days; holidays and weekends are not excluded.` };
          }
          throw new InputError('operation must be evaluate, days_between or add_period');
        }

        case 'show_steps': {
          if (visuals >= MAX_VISUALS) return { content: `ERROR: at most ${MAX_VISUALS} visuals per answer — write the rest as text.`, isError: true };
          const data = normalizeSteps(o, (d) => parseDate(d).toISOString().slice(0, 10));
          const marker = addVisual({ kind: 'steps', data });
          step('done', { citation: data.title ?? data.steps[0].title });
          return { content: `SHOWN: the user sees a plan card with ${data.steps.length} steps. Put ${marker} on its own line where the plan belongs; do not list the steps again in text.` };
        }

        case 'show_timeline': {
          if (visuals >= MAX_VISUALS) return { content: `ERROR: at most ${MAX_VISUALS} visuals per answer — write the rest as text.`, isError: true };
          const data = normalizeTimeline(o, parseDate, addPeriod);
          const marker = addVisual({ kind: 'timeline', data });
          step('done', { citation: data.title ?? data.events[0].label });
          const dates = data.events.map((e) => `${e.date.split('-').reverse().join('.')} — ${e.label}`).join('; ');
          return { content: `SHOWN: timeline card with the computed dates: ${dates}. Use exactly these dates in your text. Put ${marker} on its own line where it belongs.` };
        }

        case 'show_law': {
          if (visuals >= MAX_VISUALS) return { content: `ERROR: at most ${MAX_VISUALS} visuals per answer.`, isError: true };
          const unitIdIn = optString(o, 'unit_id', 200);
          const citation = optString(o, 'citation', 300);
          const note = optString(o, 'note', 300);
          if (!unitIdIn && !citation) throw new InputError('pass unit_id or citation');
          if (unitIdIn && !UNIT_ID_RE.test(unitIdIn)) throw new InputError('unit_id looks wrong — copy it from the square brackets');
          const unitId = unitIdIn ?? (await resolveCitationText(ctx.db, citation as string, jurisdictionOf(o, ctx)));
          const unit = unitId ? await loadUnit(ctx.db, unitId) : null;
          if (!unit) {
            return { content: `NOT_FOUND: no provision «${citation ?? unitIdIn}» in force in the Lexab database — it cannot be shown. Find the right one with search_law, or cite it in text without the card.`, isError: true, keys: [] };
          }
          const refs = await ctx.toRefs([{ unitId: unit.id, breadcrumb: unit.breadcrumb }]);
          ctx.onRefs?.(refs, 'used');
          const label = refs[0]?.label ?? unit.breadcrumb;
          const marker = addVisual({ kind: 'law', data: { unitId: unit.id, label, ...(note ? { note } : {}) } });
          step('done', { citation: label, found: 1, refs });
          return { content: `SHOWN: the user sees the official text of ${label} with its source link. Put ${marker} on its own line where it belongs; do not quote the same text again.` };
        }

        case 'show_chart': {
          if (visuals >= MAX_VISUALS) return { content: `ERROR: at most ${MAX_VISUALS} visuals per answer.`, isError: true };
          const data = normalizeChart(o);
          const bad = unverifiedValues(data.series.flatMap((x) => x.values), knownNumbers());
          if (bad.length) {
            return {
              content: `NUMBERS_UNVERIFIED: ${bad.slice(0, 6).join(', ')} did not come from calculate, the user's message or the documents. Compute every value with calculate first, then call show_chart again.`,
              isError: true,
            };
          }
          const marker = addVisual({ kind: 'chart', data });
          step('done', { citation: data.title });
          return { content: `SHOWN: chart «${data.title}». Put ${marker} on its own line where it belongs; mention only the key figure in text.` };
        }

        case 'search_official': {
          const query = reqString(o, 'query', 300);
          step('active', { queries: [query] });
          const hits = await searchLexUz(query, 8);
          step('done', { queries: [query], found: hits.length });
          if (hits.length) ctx.onOfficialSource?.('lex.uz');
          for (const h of hits) {
            const id = lexDocId(h.url);
            if (id) lexActs.set(id, officialActRef(h));
          }
          ctx.onOfficialActs?.(hits.filter((h) => h.inForce).map(officialActRef), 'found');
          if (!hits.length) return { content: `NO_RESULTS on lex.uz for «${query}». Try the act's likely title words.`, keys: [] };
          return {
            content: clipResult(
              `lex.uz search — OFFICIAL SITE, not Lexab's verified database:\n` +
                hits.map((h, i) => `${i + 1}. ${h.act || 'act'} — «${h.title}» — ${h.inForce ? 'in force' : 'NOT in force'} — ${h.url}`).join('\n') +
                '\n\nRead one with read_official (pass a query for long acts).',
            ),
            keys: hits.map((h) => h.url),
          };
        }

        case 'read_official': {
          const raw = reqString(o, 'url', 500);
          const query = optString(o, 'query', 300);
          const target = officialUrl(raw);
          if (!target) throw new InputError('only official law portals and government sites from the allowed list can be read (lex.uz, gov.uz, cbu.uz, soliq.uz, mf.uz, adliya.uz, …)');
          step('active', { citation: target.hostname, ...(query ? { queries: [query] } : {}) });
          let { url, html } = await fetchOfficial(target.toString());
          let title = '';
          let notes: string[] = [];
          let text = '';
          let pageAct = '';
          if (/(^|\.)lex\.uz$/i.test(new URL(url).hostname)) {
            let page = parseLexPage(html);
            notes = page.warnings;
            // Русского текста нет — читаем официальный оригинал (на узбекском).
            if (page.text.length < 1500 && page.originalUrl) {
              const orig = await fetchOfficial(page.originalUrl);
              const p2 = parseLexPage(orig.html);
              if (p2.text.length > page.text.length) {
                url = orig.url;
                html = orig.html;
                page = { ...p2, warnings: [...page.warnings, 'Russian text not available — showing the official original (Uzbek).'] };
                notes = page.warnings;
              }
            }
            title = page.title;
            text = page.text;
            pageAct = page.act;
          } else {
            const p = pageText(html);
            title = p.title;
            text = p.text;
          }
          if (!text.trim()) {
            step('done', { citation: target.hostname, found: 0 });
            return { content: `NO_TEXT: could not read text from ${url}.`, isError: true };
          }
          const host = new URL(url).hostname.replace(/^www\./, '');
          // Подпись в Sources: акт из поиска lex.uz → как в поиске; страница
          // lex.uz → по её шапке («ПКМ № 428 от …» + название); прочие сайты —
          // заголовок страницы и сайт.
          const known = lexActs.get(lexDocId(target.toString()) ?? '') ?? lexActs.get(lexDocId(url) ?? '');
          const fromPage = pageAct ? shortActName(pageAct) : null;
          const act: OfficialActRef = known
            ? { ...known, url }
            : fromPage
              ? { label: fromPage.label, doc: clipText(title || host, 60), url, number: fromPage.number }
              : { label: clipText(title || host, 40), doc: host, url, number: null };
          const refs = [{ label: act.label, doc: act.doc, url }];
          ctx.onOfficialActs?.([act], 'read');
          ctx.onOfficialSource?.(host);
          step('done', { citation: clipText(title || new URL(url).hostname, 80), found: 1, refs });
          return {
            content: clipResult(
              `SOURCE: ${url} — OFFICIAL SITE, NOT Lexab's verified database. Say so when you rely on it.\n` +
                (title ? `Title: ${title}\n` : '') +
                (notes.length ? `Site notes: ${notes.join(' | ')}\n` : '') +
                `\n${excerpt(text, query, 7000)}`,
            ),
          };
        }

        case 'task_guide': {
          // Нет памяток в этом чате — инструмента «нет» (как неизвестного).
          if (!guides) return { content: `Unknown tool «${call.name}». Available: ${tools.map((t) => t.name).join(', ')}.`, isError: true };
          const task = reqString(o, 'task', 40);
          const spec = specialistById(task);
          if (!spec) throw new InputError(`task must be one of ${SPECIALIST_IDS.join(', ')}`);
          step('active', { citation: spec.title, task: spec.id });
          const guide = await renderGuide(ctx.db, spec);
          // Нормы карты — «найденные»: в Sources пойдут только те, на которые
          // ответ сошлётся (номер + акт), со ссылкой на официальный сайт.
          if (guide.units.length) ctx.onRefs?.(await ctx.toRefs(guide.units), 'found');
          step('done', { citation: spec.title, task: spec.id, found: guide.units.length });
          // Без clipResult: памятка короче MAX_GUIDE_CHARS (specialists-check).
          return { content: guide.text };
        }

        default:
          return { content: `Unknown tool «${call.name}». Available: ${tools.map((t) => t.name).join(', ')}.`, isError: true };
      }
    } catch (err) {
      const message = err instanceof InputError || err instanceof VisualInputError ? err.message : 'the tool failed — try again or answer without it';
      if (!(err instanceof InputError) && !(err instanceof VisualInputError)) console.warn(`[chat-agent] ${call.name} failed: ${(err as Error).message}`);
      if (shown) step('done', {});
      return { content: `ERROR: ${message}`, isError: true };
    }
  };

  const runAndLearn = async (call: ToolCall): Promise<ToolOutcome> => {
    const out = await run(call);
    if (!out.isError && call.name !== 'show_chart') knownNumbers().push(...numbersIn(out.content));
    return out;
  };

  return { tools, run: runAndLearn, instructions: guides ? `${agentInstructions}\n${TASK_GUIDE_INSTRUCTIONS}` : agentInstructions };
}
