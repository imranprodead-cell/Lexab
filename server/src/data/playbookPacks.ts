/**
 * Готовые экспертные наборы позиций (плейбуки) для новых пользователей.
 *
 * Каждый набор — это стандартные договорные позиции клиента для одного типа
 * договора в одной юрисдикции. При анализе договора ИИ сверяет пункты с этими
 * позициями и подсвечивает отклонения. Правила — это ПОЗИЦИИ (проверяемые
 * ожидания к тексту договора), а не пересказ законов и тем более не тексты
 * норм: упоминание акта допустимо только как ориентир.
 *
 * Инварианты:
 *  - rulesRu и rulesEn — точные переводы друг друга (тот же порядок, та же длина);
 *  - каждое правило ≤ 200 символов, конкретное и проверяемое по договору;
 *  - id стабильны (kebab-case) — на них можно ссылаться из БД и UI.
 */
export interface PlaybookPack {
  /** Стабильный идентификатор в kebab-case, напр. 'uk-nda'. */
  id: string;
  /** Юрисдикция: 'UK' | 'UZ' | 'KZ' | 'DE' | 'US' | 'CA' | 'AE'. */
  jurisdiction: string;
  nameRu: string;
  nameEn: string;
  /** Одно предложение: для каких договоров предназначен набор. */
  descRu: string;
  descEn: string;
  /** 8–12 экспертных позиций на русском. */
  rulesRu: string[];
  /** Те же позиции на английском (тот же порядок и количество). */
  rulesEn: string[];
}

export const PLAYBOOK_PACKS: PlaybookPack[] = [
  {
    id: 'uk-nda',
    jurisdiction: 'UK',
    nameRu: 'NDA по праву Англии',
    nameEn: 'NDA under English law',
    descRu:
      'Соглашения о конфиденциальности (NDA) по английскому праву: переговоры, due diligence, обмен коммерческой информацией.',
    descEn:
      'Confidentiality agreements (NDAs) under English law: negotiations, due diligence, exchange of commercial information.',
    rulesRu: [
      'Срок конфиденциальности — не менее 3 лет с даты раскрытия; для торговых секретов — пока информация сохраняет секретность.',
      'Стандартные исключения обязательны: публично доступная информация, независимая разработка, законное получение от третьих лиц, ранее известная информация.',
      'Принудительное раскрытие (суд, регулятор) — только в требуемом объёме и с предварительным уведомлением раскрывающей стороны, где это законно.',
      'Передача информации сотрудникам и советникам — только по принципу need-to-know и под обязательствами не менее строгими, чем по NDA.',
      'Право требовать судебный запрет (injunction) сохраняется за обеими сторонами; оговорки об отказе от обеспечительных мер не принимаются.',
      'Права третьих лиц по Contracts (Rights of Third Parties) Act 1999 исключены.',
      'Возврат или уничтожение информации по первому запросу; хранение архивных копий — только по требованию закона или внутреннего комплаенса.',
      'Раскрытие не передаёт никаких лицензий и прав на интеллектуальную собственность.',
      'NDA не обязывает заключить основную сделку и не создаёт эксклюзивности, партнёрства или агентских отношений.',
      'Уступка прав по NDA — только с предварительного письменного согласия другой стороны.',
      'Применимое право — английское; исключительная юрисдикция судов Англии и Уэльса.',
    ],
    rulesEn: [
      'Confidentiality term of at least 3 years from disclosure; for trade secrets — for as long as the information remains secret.',
      'Standard exclusions are mandatory: publicly available information, independent development, lawful receipt from third parties, previously known information.',
      'Compelled disclosure (court, regulator) — only to the extent required and with prior notice to the disclosing party where lawful.',
      'Sharing with employees and advisers only on a need-to-know basis and under obligations no less strict than the NDA.',
      'Injunctive relief remains available to both parties; clauses waiving equitable remedies are not accepted.',
      'Third-party rights under the Contracts (Rights of Third Parties) Act 1999 are excluded.',
      'Return or destruction of information on first request; archival copies may be kept only where required by law or internal compliance.',
      'Disclosure grants no licences or intellectual property rights.',
      'The NDA creates no obligation to enter the main transaction and no exclusivity, partnership or agency.',
      "Assignment of NDA rights only with the other party's prior written consent.",
      'Governing law — English law; exclusive jurisdiction of the courts of England and Wales.',
    ],
  },
  {
    id: 'uz-supply',
    jurisdiction: 'UZ',
    nameRu: 'Поставка (Узбекистан)',
    nameEn: 'Supply agreement (Uzbekistan)',
    descRu:
      'Договоры поставки товаров по праву Республики Узбекистан — позиции покупателя.',
    descEn:
      'Goods supply agreements under the law of the Republic of Uzbekistan — buyer-side positions.',
    rulesRu: [
      'Цена — в сумах; при валютной оговорке курс фиксируется по ЦБ РУз на дату платежа, порог и порядок пересчёта прописаны явно.',
      'Неустойка — не выше 0,1% в день и не более 10% суммы договора; условия о неустойке зеркальны для поставщика и покупателя.',
      'Обязательный претензионный порядок: письменная претензия, ответ — не более 15 календарных дней, иск — только после истечения этого срока.',
      'Приёмка по количеству и качеству — по акту в течение 10 рабочих дней с даты поставки; скрытые недостатки заявляются в пределах гарантийного срока.',
      'Гарантийный срок — не менее 12 месяцев; замена или устранение недостатков — силами и за счёт поставщика в срок не более 20 дней.',
      'Оплата — после поставки; аванс — не более 30% и только против банковской гарантии или иного обеспечения его возврата.',
      'Одностороннее изменение цены после согласования заказа/спецификации не допускается.',
      'Риск случайной гибели переходит в момент передачи товара покупателю по накладной (перевозчику — только если это прямо согласовано).',
      'Форс-мажор подтверждается документом ТПП Узбекистана; при действии свыше 60 дней любая сторона вправе расторгнуть договор без санкций.',
      'Расторжение при существенном нарушении — письменным уведомлением за 30 дней.',
      'Уступка прав и перевод долга — только с предварительного письменного согласия другой стороны.',
      'Применимое право — Республики Узбекистан; споры после претензионного порядка — в экономическом суде по месту нахождения покупателя.',
    ],
    rulesEn: [
      'Price in UZS; if a currency clause is used, the CBU rate on the payment date applies, with the adjustment threshold and mechanics stated expressly.',
      'Penalties capped at 0.1% per day and 10% of the contract value; penalty terms are mirrored for supplier and buyer.',
      'Mandatory pre-action claim procedure: written claim, response within 15 calendar days, court action only after that period expires.',
      'Acceptance for quantity and quality by signed act within 10 business days of delivery; hidden defects may be claimed within the warranty period.',
      "Warranty period of at least 12 months; replacement or cure of defects at the supplier's cost within 20 days.",
      'Payment after delivery; advance capped at 30% and only against a bank guarantee or other security for its refund.',
      'No unilateral price changes after the order/specification is agreed.',
      'Risk of loss passes when the goods are handed to the buyer against the delivery note (to the carrier — only if expressly agreed).',
      'Force majeure must be certified by the Chamber of Commerce and Industry of Uzbekistan; if it lasts over 60 days, either party may terminate without penalty.',
      "Termination for material breach — by written notice with 30 days' warning.",
      "Assignment of rights or transfer of debt only with the other party's prior written consent.",
      "Governing law — the Republic of Uzbekistan; disputes after the claim procedure go to the economic court at the buyer's location.",
    ],
  },
  {
    id: 'kz-services',
    jurisdiction: 'KZ',
    nameRu: 'Возмездные услуги (Казахстан)',
    nameEn: 'Services agreement (Kazakhstan)',
    descRu:
      'Договоры возмездного оказания услуг по праву Республики Казахстан — позиции заказчика.',
    descEn:
      'Fee-based services agreements under the law of the Republic of Kazakhstan — customer-side positions.',
    rulesRu: [
      'Предмет и объём услуг зафиксированы в техническом задании; изменения — только письменным допсоглашением с ценой и сроками.',
      'Приёмка — по акту оказанных услуг; на мотивированный отказ у заказчика не менее 10 рабочих дней; «молчаливая» приёмка не допускается.',
      'Оплата — постоплата в течение 30 календарных дней после подписания акта; аванс — не более 30%.',
      'Неустойка за просрочку — 0,1% в день, но не более 10% стоимости соответствующего этапа; условия зеркальны для обеих сторон.',
      'Ответственность сторон ограничена стоимостью услуг за 12 месяцев; лимит не действует при умысле, нарушении конфиденциальности и прав ИС.',
      'Исключительные права на результаты услуг переходят заказчику с момента полной оплаты; исполнитель гарантирует отсутствие прав третьих лиц.',
      'Субподряд — только с письменного согласия заказчика; за действия субподрядчиков исполнитель отвечает как за свои.',
      'Заказчик вправе отказаться от договора с уведомлением за 30 дней, оплатив фактически оказанные услуги; штрафы за отказ не допускаются.',
      'Обязательный претензионный порядок: ответ на претензию — 10 рабочих дней; далее — суд по месту нахождения заказчика, право Республики Казахстан.',
      'Цена включает все налоги и расходы исполнителя; НДС выделяется отдельной строкой в счетах-фактурах.',
      'Конфиденциальность — 3 года после прекращения договора; персональные данные обрабатываются по законодательству РК и только по поручению заказчика.',
    ],
    rulesEn: [
      'Scope of services is fixed in the statement of work; changes only by written amendment stating price and deadlines.',
      'Acceptance by signed act; the customer has at least 10 business days for a reasoned rejection; deemed (silent) acceptance is not allowed.',
      'Post-payment within 30 calendar days after the act is signed; advance capped at 30%.',
      'Late-performance penalty of 0.1% per day, capped at 10% of the relevant stage price; mirrored for both parties.',
      "Liability capped at 12 months' service fees; the cap does not apply to wilful misconduct, confidentiality breaches or IP infringement.",
      'Exclusive rights to deliverables pass to the customer upon full payment; the provider warrants they are free of third-party rights.',
      "Subcontracting only with the customer's written consent; the provider is liable for subcontractors' acts as for its own.",
      "The customer may terminate on 30 days' notice, paying for services actually rendered; termination fees are not allowed.",
      "Mandatory pre-action claim procedure: response within 10 business days; then courts at the customer's location, law of the Republic of Kazakhstan.",
      'The price includes all provider taxes and costs; VAT is shown as a separate line in tax invoices.',
      "Confidentiality survives for 3 years after termination; personal data is processed under Kazakhstan law and only on the customer's instructions.",
    ],
  },
  {
    id: 'de-b2b-sale',
    jurisdiction: 'DE',
    nameRu: 'B2B купля-продажа/поставка (Германия)',
    nameEn: 'B2B sale and supply (Germany)',
    descRu:
      'B2B договоры купли-продажи и поставки по германскому праву (контекст BGB/HGB) — позиции покупателя.',
    descEn:
      'B2B sale and supply contracts under German law (BGB/HGB context) — buyer-side positions.',
    rulesRu: [
      'Применяется только согласованный текст договора; стандартные условия (AGB) продавца не действуют, даже без прямого возражения против них.',
      'Срок осмотра и рекламации (§ 377 HGB) — не менее 10 рабочих дней с поставки; для скрытых дефектов — с момента обнаружения.',
      'Срок давности по требованиям о недостатках — не менее 24 месяцев с поставки; сокращение до 12 месяцев не принимается.',
      'Исключения ответственности не должны затрагивать умысел, грубую неосторожность, вред жизни/здоровью и существенные обязанности (Kardinalpflichten).',
      'Косвенные и последующие убытки исключаются взаимно; ответственность ограничена типично предвидимым ущербом.',
      'Оговорка о сохранении права собственности — только простая; расширенный и продлённый Eigentumsvorbehalt не принимается.',
      'Поставка — DAP склад покупателя (Incoterms 2020); риск переходит при передаче в месте назначения.',
      'Просрочка поставки: пеня 0,5% за каждую начатую неделю, максимум 5% стоимости партии; право расторжения после безрезультатного Nachfrist.',
      'Цены фиксированы на срок договора; оговорки об одностороннем повышении или автоматической индексации не принимаются.',
      'Запрет зачёта допустим только для спорных требований; зачёт бесспорных или подтверждённых судом требований должен оставаться возможным.',
      'Применимое право — германское с исключением Венской конвенции (CISG); подсудность — по месту нахождения покупателя.',
    ],
    rulesEn: [
      "Only the negotiated contract text applies; the seller's standard terms (AGB) do not apply even absent an express objection to them.",
      'Inspection and defect-notice period (sec. 377 HGB) of at least 10 business days from delivery; for hidden defects — from discovery.',
      'Limitation period for defect claims of at least 24 months from delivery; a reduction to 12 months is not accepted.',
      'Liability exclusions must not cover intent, gross negligence, injury to life or health, or breach of cardinal obligations (Kardinalpflichten).',
      'Indirect and consequential damages are mutually excluded; liability is limited to typically foreseeable damage.',
      'Retention of title in its simple form only; extended or prolonged retention (erweiterter/verlaengerter Eigentumsvorbehalt) is not accepted.',
      "Delivery DAP buyer's warehouse (Incoterms 2020); risk passes on handover at the destination.",
      'Late delivery: 0.5% per commenced week, capped at 5% of the consignment value; right to terminate after an unsuccessful grace period (Nachfrist).',
      'Prices are fixed for the contract term; unilateral increase or automatic indexation clauses are not accepted.',
      'A set-off ban may cover disputed claims only; set-off of undisputed or finally adjudicated claims must remain possible.',
      "Governing law — German law excluding the CISG; venue at the buyer's seat.",
    ],
  },
  {
    id: 'us-saas-msa',
    jurisdiction: 'US',
    nameRu: 'SaaS / MSA (США)',
    nameEn: 'SaaS / MSA (United States)',
    descRu:
      'Подписки на SaaS и рамочные договоры услуг (MSA) с провайдерами из США — позиции клиента, без привязки к конкретному штату.',
    descEn:
      'SaaS subscriptions and master services agreements (MSA) with US providers — customer-side positions, not tied to a specific state.',
    rulesRu: [
      'SLA доступности — не ниже 99,9% в месяц с сервисными кредитами; при доступности ниже 99% три месяца подряд — право расторжения без штрафа.',
      'Ответственность провайдера ограничена платой за 12 месяцев; для утечки данных и нарушения конфиденциальности — повышенный лимит (не менее 3x).',
      'Косвенные убытки исключены взаимно; исключение не распространяется на индемнити по ИС и нарушение конфиденциальности.',
      'Провайдер возмещает потери по искам третьих лиц о нарушении прав ИС; это обязательство не подпадает под общий лимит ответственности.',
      'Данные клиента — собственность клиента; использование для обучения моделей или иных целей провайдера — только с явного письменного согласия.',
      'При прекращении — не менее 30 дней на выгрузку данных в машиночитаемом формате, затем удаление с письменным подтверждением.',
      'Уведомление об инциденте безопасности, затрагивающем данные клиента, — не позднее 72 часов с момента обнаружения.',
      'Арбитраж по FAA (AAA или JAMS) допустим с изъятием для обеспечительных мер и споров об ИС; применимое право и место прямо зафиксированы в договоре.',
      'Электронные подписи (E-SIGN/UETA) признаются достаточными для договора, заказов и уведомлений.',
      'Автопродление — только с напоминанием провайдера за 60 дней и правом отказа; повышение цены при продлении — не более 5% или CPI (что меньше).',
      'Приостановка сервиса — только при существенном нарушении, после письменного уведомления и 10 рабочих дней на устранение.',
      'Уступка договора — только с согласия; допускается передача аффилиату или правопреемнику при M&A с письменным уведомлением.',
    ],
    rulesEn: [
      'Uptime SLA of at least 99.9% monthly with service credits; availability below 99% for three consecutive months gives a no-penalty termination right.',
      "Provider liability capped at 12 months' fees; data breaches and confidentiality violations carry a higher cap (at least 3x).",
      'Consequential damages mutually excluded; the exclusion does not apply to the IP indemnity or confidentiality breaches.',
      'The provider indemnifies against third-party IP infringement claims; this obligation sits outside the general liability cap.',
      "Customer data remains the customer's property; use for model training or other provider purposes requires express written consent.",
      'On termination, at least 30 days to export data in a machine-readable format, followed by deletion with written confirmation.',
      'Notice of a security incident affecting customer data within 72 hours of discovery.',
      'Arbitration under the FAA (AAA or JAMS) is acceptable with carve-outs for injunctive relief and IP disputes; governing law and venue expressly fixed in the contract.',
      'Electronic signatures (E-SIGN/UETA) are sufficient for the agreement, order forms and notices.',
      'Auto-renewal only with a provider reminder 60 days ahead and an opt-out right; renewal price increases capped at 5% or CPI, whichever is lower.',
      'Service suspension only for material breach, after written notice and a 10-business-day cure period.',
      'No assignment without consent, except to an affiliate or a successor in an M&A transaction with written notice.',
    ],
  },
  {
    id: 'ca-services',
    jurisdiction: 'CA',
    nameRu: 'Услуги (Квебек, Канада)',
    nameEn: 'Services agreement (Quebec, Canada)',
    descRu:
      'Договоры услуг по гражданскому праву Квебека (контекст CCQ) — позиции заказчика.',
    descEn:
      'Services contracts under Quebec civil law (CCQ context) — customer-side positions.',
    rulesRu: [
      'Договор — на французском языке или двуязычный с приоритетом французского текста (требования Хартии французского языка Квебека).',
      'Внешние документы (политики, условия на сайте) связывают, только если переданы заказчику до подписания и прямо им приняты.',
      'Ограничения ответственности не действуют при умышленной или грубой вине; оговорки, покрывающие такую вину, не принимаются.',
      'Ответственность ограничена 100% годовой платы; возмещается только прямой и непосредственный ущерб, косвенные убытки исключены взаимно.',
      'Заказчик вправе расторгнуть договор услуг в любой момент с уведомлением за 30 дней, оплатив фактически оказанное; штрафы за расторжение не допускаются.',
      'Штрафные оговорки (clause penale) — не выше 10% суммы договора; явно несоразмерные штрафы не принимаются.',
      'Права ИС на результаты переходят заказчику после полной оплаты; исполнитель обеспечивает отказ авторов от моральных прав в пользу заказчика.',
      'Субподряд — только с письменного согласия заказчика; исполнитель отвечает за субподрядчиков как за себя.',
      'Персональные данные — по Закону 25 (Квебек): обработка только по инструкциям заказчика, уведомление об инцидентах — не позднее 72 часов.',
      'Оплата — в канадских долларах, постоплата в течение 30 дней после акта/инвойса; автопродление — только с уведомлением за 60 дней.',
      'Применимое право — право провинции Квебек; споры — в судах Квебека по месту нахождения заказчика.',
    ],
    rulesEn: [
      'The contract is in French or bilingual with the French text prevailing (Charter of the French Language requirements in Quebec).',
      'External documents (policies, website terms) bind only if provided to the customer before signing and expressly accepted.',
      'Liability limits must not cover intentional or gross fault; clauses purporting to cover such fault are not accepted.',
      'Liability capped at 100% of annual fees; only direct and immediate damage is recoverable, consequential damages mutually excluded.',
      "The customer may resiliate the services contract at any time on 30 days' notice, paying for work actually done; termination penalties are not allowed.",
      'Penal clauses capped at 10% of the contract value; clearly disproportionate penalties are not accepted.',
      "IP rights in deliverables pass to the customer on full payment; the provider secures waivers of authors' moral rights in the customer's favour.",
      "Subcontracting only with the customer's written consent; the provider remains liable for subcontractors as for itself.",
      "Personal data handled under Quebec's Law 25: processing only on the customer's instructions, incident notice within 72 hours.",
      "Payment in Canadian dollars, net 30 days after acceptance act/invoice; auto-renewal only with 60 days' prior notice.",
      "Governing law — the law of the province of Quebec; disputes go to Quebec courts at the customer's location.",
    ],
  },
  {
    id: 'ae-services',
    jurisdiction: 'AE',
    nameRu: 'Услуги (ОАЭ)',
    nameEn: 'Services agreement (UAE)',
    descRu:
      'Договоры услуг по праву ОАЭ (контекст Civil Transactions Law) — позиции заказчика.',
    descEn:
      'Services contracts under UAE law (Civil Transactions Law context) — customer-side positions.',
    rulesRu: [
      'Заранее оценённые убытки — не выше 10% цены договора и соразмерны ожидаемому ущербу (суд ОАЭ вправе скорректировать согласованную сумму).',
      'Право одностороннего расторжения с уведомлением за 30 дней прямо закреплено в договоре; без него расторжение требует соглашения сторон или суда.',
      'Ответственность ограничена 100% годовой платы; лимит не покрывает умысел и грубую небрежность, а также возмещение по искам третьих лиц об ИС.',
      'Косвенные убытки и упущенная выгода исключаются взаимно.',
      'Оплата — поэтапно по подписанным актам; аванс — не более 20% и только против банковской гарантии.',
      'Валюта платежа — дирхам ОАЭ (AED) или доллар США; курс пересчёта фиксируется на дату счёта.',
      'Права ИС на результаты услуг переходят заказчику после полной оплаты; исполнитель гарантирует чистоту прав.',
      'Субподряд — только с письменного согласия заказчика; ответственность за субподрядчиков несёт исполнитель.',
      'Форс-мажор освобождает от ответственности только на период действия; свыше 60 дней — право любой стороны расторгнуть договор без компенсаций.',
      'Досудебный порядок: письменная претензия и 30 дней на переговоры до начала арбитража или суда.',
      'Споры — арбитраж DIAC (место — Дубай, язык — английский); автоматическая привязка к судам страны исполнителя не принимается.',
      'Конфиденциальность — 3 года после прекращения; персональные данные обрабатываются с учётом закона ОАЭ о защите данных (PDPL).',
    ],
    rulesEn: [
      'Liquidated damages capped at 10% of the contract price and proportionate to the expected loss (UAE courts may adjust the agreed amount).',
      "A unilateral termination right on 30 days' notice must be stated expressly; without it, termination requires mutual consent or a court order.",
      'Liability capped at 100% of annual fees; the cap does not cover wilful misconduct or gross negligence, nor the third-party IP indemnity.',
      'Indirect damages and loss of profit are mutually excluded.',
      'Payment in stages against signed acceptance acts; advance capped at 20% and only against a bank guarantee.',
      'Payment currency — UAE dirham (AED) or US dollar; the conversion rate is fixed at the invoice date.',
      'IP rights in deliverables pass to the customer on full payment; the provider warrants clear title.',
      "Subcontracting only with the customer's written consent; the provider is liable for its subcontractors.",
      'Force majeure excuses performance only while it lasts; beyond 60 days either party may terminate without compensation.',
      'Pre-action step: a written claim and 30 days of negotiations before arbitration or court proceedings.',
      "Disputes go to DIAC arbitration (seat Dubai, English language); default submission to the provider's home courts is not accepted.",
      'Confidentiality survives for 3 years after termination; personal data is handled in line with the UAE data protection law (PDPL).',
    ],
  },
];
