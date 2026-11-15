import type { AnalysisResult, ContractRow, Finding, Redline, Severity } from '@/types/domain';

/**
 * Данные ОБРАЗЦОВ для пустых экранов. Компании вымышлены и везде помечены
 * «Образец». Ссылки на нормы — настоящие unit_id из базы законов: текст статьи
 * приходит с сервера (LawQuote), здесь его нет и быть не должно (правило №1).
 */

const DAY = 86_400_000;
const isoIn = (days: number): string => {
  const now = new Date();
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) + days * DAY).toISOString().slice(0, 10);
};

function contract(id: string, name: string, counterparty: string, daysToEnd: number, notice: number | null, autoRenew: boolean): ContractRow {
  return {
    documentId: `sample-${id}`,
    name,
    counterparty,
    risk: 'Elevated',
    status: 'Reviewed',
    mine: true,
    obligations: [],
    terms: {
      effectiveDate: isoIn(daysToEnd - 365),
      expiryDate: isoIn(daysToEnd),
      daysToExpiry: daysToEnd,
      autoRenew,
      renewalNoticeDays: notice,
      contractValue: null,
      currency: null,
      governingLaw: 'Узбекистан',
      extractedAt: new Date().toISOString(),
    },
  };
}

/** Даты считаются от сегодняшнего дня, чтобы образец не «протухал». */
export function sampleContracts(): ContractRow[] {
  return [
    contract('c1', 'Аренда офиса', 'ООО «Навбахор Офис»', 36, 30, true),
    contract('c2', 'Поставка упаковки', 'ООО «Чорсу Пак»', 46, 30, true),
    contract('c3', 'Уборка помещений', 'ООО «Октепа Клининг»', 61, 30, true),
    contract('c4', 'Обслуживание серверов', 'ООО «Зарафшан Дата»', 105, 60, true),
    contract('c5', 'Лизинг автомобилей', 'АО «Олмазор Лизинг»', 136, null, false),
    contract('c6', 'Рекламное размещение', 'ООО «Сайхун Медиа»', 166, 45, true),
    contract('c7', 'Охрана склада', 'ООО «Бодомзор Секьюрити»', 227, 90, true),
  ];
}

/** Пункты о продлении ВЫМЫШЛЕННЫХ договоров образца (не текст закона). */
export const SAMPLE_CLAUSES: Record<string, string> = {
  'sample-c1': '9.3. Если ни одна из Сторон не менее чем за 30 (тридцать) календарных дней до окончания срока действия Договора не заявит письменно о его прекращении, Договор считается продлённым на тот же срок.',
  'sample-c2': '11.2. Договор продлевается на каждый следующий календарный год, если ни одна из Сторон не уведомит другую о его прекращении не позднее чем за 30 (тридцать) дней до окончания текущего года.',
  'sample-c3': '8.1. При отсутствии письменного уведомления о прекращении, направленного не менее чем за 30 (тридцать) дней до окончания срока, Договор продлевается на 6 (шесть) месяцев.',
  'sample-c4': '12.4. Сторона, не желающая продлевать Договор, уведомляет об этом другую Сторону не позднее чем за 60 (шестьдесят) дней до окончания срока его действия. В противном случае Договор продлевается на 1 (один) год.',
  'sample-c6': '7.5. Если за 45 (сорок пять) дней до окончания срока ни одна из Сторон не направит уведомление о прекращении, Договор продлевается на 1 (один) год.',
  'sample-c7': '10.1. Договор продлевается на 1 (один) год, если Заказчик не уведомит Исполнителя об отказе от продления не позднее чем за 90 (девяносто) дней до окончания срока.',
};

/* ------------------------- массовый разбор: образец ------------------------- */

const UNIT = {
  L25: 'lu_uz_10872_st-25',
  L382: 'lu_uz_111181_st-382',
  L33: 'lu_uz_3523895_st-33',
} as const;
const CITE = {
  L25: 'ст. 25 Закона «О договорно-правовой базе деятельности хозяйствующих субъектов»',
  L382: 'ст. 382 ГК РУз',
  L33: 'ст. 33 ЭПК РУз',
} as const;

type F = {
  sev: Severity;
  title: string;
  del: string;
  ins: string;
  law?: keyof typeof UNIT;
  check?: boolean;
  topic: NonNullable<Finding['topic']>;
  /** Противоречие образца: цитаты из ВЫМЫШЛЕННОГО договора образца. */
  conflict?: { a: string; b: string };
};

function analysis(id: string, fileName: string, score: number, items: F[]): AnalysisResult {
  const findings: Finding[] = [];
  const redlines: Redline[] = [];
  items.forEach((it, i) => {
    const rid = `${id}-r${i}`;
    redlines.push({ id: rid, delText: it.del, insText: it.ins, severity: it.sev, status: 'pending' });
    findings.push({
      id: `${id}-f${i}`,
      severity: it.sev,
      title: it.title,
      citation: it.law ? CITE[it.law] : '',
      unitId: it.law && !it.check ? UNIT[it.law] : null,
      redlineId: rid,
      unverified: it.check ?? false,
      topic: it.topic,
      conflict: it.conflict ?? null,
    });
  });
  return {
    id: `sample-${id}`,
    fileName,
    fileSize: '—',
    summary: '',
    riskScore: score,
    riskLevel: score >= 70 ? 'High' : score >= 40 ? 'Elevated' : 'Low',
    clausesReviewed: 30,
    findings,
    redlines,
    document: [],
    canEdit: false,
  };
}

export interface SampleBatchRow {
  key: string;
  name: string;
  analysis: AnalysisResult;
}

export function sampleBatch(): SampleBatchRow[] {
  return [
    {
      key: 'b1',
      name: 'Поставка, Чорсу Текстиль № 14/2026',
      analysis: analysis('b1', 'Поставка_Чорсу_Текстиль.docx', 72, [
        { sev: 'High', topic: 'penalty', title: 'Пеня 1% в день за просрочку поставки, без верхнего предела', del: 'пеню в размере 1 (одного) процента от стоимости непоставленного Товара за каждый день просрочки', ins: 'пеню в размере 0,5 процента за каждый день просрочки, но не более 50 процентов стоимости непоставленного Товара', law: 'L25' },
        { sev: 'High', topic: 'termination', title: 'Односторонний отказ от исполнения договора есть только у Покупателя', del: 'Покупатель вправе в одностороннем порядке отказаться от исполнения Договора, письменно уведомив Поставщика за 10 (десять) календарных дней.', ins: 'Каждая из Сторон вправе в одностороннем порядке отказаться от исполнения Договора, письменно уведомив другую Сторону за 30 (тридцать) календарных дней.', law: 'L382' },
        { sev: 'Medium', topic: 'disputes', title: 'Споры рассматривает суд по месту Покупателя', del: 'в экономическом суде по месту нахождения Покупателя', ins: 'в экономическом суде по месту нахождения ответчика', law: 'L33' },
        { sev: 'Medium', topic: 'payment', title: 'Оплата через 60 банковских дней после поставки', del: 'в течение 60 (шестидесяти) банковских дней', ins: 'в течение 30 (тридцати) календарных дней' },
        {
          sev: 'High',
          topic: 'payment',
          title: 'Сумма договора: цифрами 150 000 000, прописью «сто миллионов» (п. 2.1)',
          del: '150 000 000 (сто миллионов) сум',
          ins: '150 000 000 (сто пятьдесят миллионов) сум',
          conflict: { a: '150 000 000', b: 'сто миллионов' },
        },
      ]),
    },
    {
      key: 'b2',
      name: 'Поставка, Андижан Агро № 3/2026',
      analysis: analysis('b2', 'Поставка_Андижан_Агро.pdf', 31, [
        { sev: 'Low', topic: 'acceptance', title: 'Срок приёмки товара по качеству не указан', del: 'в порядке, согласованном Сторонами', ins: 'в течение 3 (трёх) рабочих дней с даты поставки' },
      ]),
    },
    {
      key: 'b3',
      name: 'Поставка, Бухоро Ипак № 21/2026',
      analysis: analysis('b3', 'Поставка_Бухоро_Ипак.docx', 58, [
        { sev: 'Medium', topic: 'penalty', title: 'Пеня 0,5% в день без общего предела', del: 'пеню в размере 0,5 процента неисполненной части обязательства за каждый день просрочки', ins: 'пеню в размере 0,5 процента за каждый день просрочки, но не более 50 процентов стоимости', law: 'L25' },
        { sev: 'High', topic: 'payment', title: 'Оплата через 90 дней после поставки', del: 'в течение 90 (девяноста) дней после поставки', ins: 'в течение 30 (тридцати) дней после поставки' },
      ]),
    },
    {
      key: 'b4',
      name: 'Поставка, Наманган Мева № 7/2026',
      analysis: analysis('b4', 'Поставка_Наманган_Мева.docx', 22, [
        { sev: 'Low', topic: 'termination', title: 'Порядок одностороннего отказа от договора не прописан', del: 'Договор может быть расторгнут в порядке, предусмотренном законодательством.', ins: 'Каждая из Сторон вправе отказаться от исполнения Договора, уведомив другую Сторону за 30 (тридцать) дней.', law: 'L382', check: true },
      ]),
    },
    {
      key: 'b5',
      name: 'Поставка, Хоразм Пахта № 11/2026',
      analysis: analysis('b5', 'Поставка_Хоразм_Пахта.pdf', 69, [
        { sev: 'High', topic: 'penalty', title: 'Пеня 2% в день за просрочку поставки', del: 'пеню в размере 2 (двух) процентов от стоимости партии', ins: 'пеню в размере 0,5 процента, но не более 50 процентов стоимости партии', law: 'L25' },
        { sev: 'Medium', topic: 'disputes', title: 'Споры только в суде по месту Покупателя', del: 'по месту нахождения Покупателя', ins: 'по месту нахождения ответчика', law: 'L33' },
      ]),
    },
    {
      key: 'b6',
      name: 'Поставка, Термиз Савдо № 2/2026',
      analysis: analysis('b6', 'Поставка_Термиз_Савдо.docx', 40, [
        { sev: 'Medium', topic: 'payment', title: 'Оплата через 45 банковских дней', del: 'в течение 45 (сорока пяти) банковских дней', ins: 'в течение 30 (тридцати) календарных дней' },
        { sev: 'Low', topic: 'acceptance', title: 'Нет пункта о приёмке товара по качеству', del: '', ins: 'Покупатель принимает Товар по качеству в течение 3 (трёх) рабочих дней с даты поставки.' },
      ]),
    },
  ];
}
