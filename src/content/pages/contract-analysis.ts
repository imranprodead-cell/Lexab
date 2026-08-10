/**
 * Публичная страница «Анализ договора».
 *
 * Все числа — из реестра фактов (выверены 2026-08-05 по коду и живому запросу
 * к базе). Ни одного утверждения, которого нет в коде: ни сроков разбора, ни
 * процентов точности, ни упоминания электронной подписи (раздел выключен).
 *
 * ССЫЛКИ ЭТАПА 1: /login и якорь тарифов на главной — страниц /pricing и
 * /legal-base ещё нет, ссылка в никуда хуже её отсутствия. Переключить на
 * этапах 5-6 (отмечено пометкой TODO-ЭТАП-5 рядом с каждой такой ссылкой).
 */
import type { PageContent } from '../types';

export const contractAnalysis: PageContent = {
  slug: 'contract-analysis',
  pageTitle: {
    ru: 'Анализ договора — Lexab',
    en: 'Contract review — Lexab',
    de: 'Vertragsprüfung — Lexab',
    ar: 'مراجعة العقود — Lexab',
    kk: 'Шартты талдау — Lexab',
    uz: 'Shartnoma tahlili — Lexab',
  },
  blocks: [
    {
      kind: 'hero',
      title: {
        ru: 'Анализ договора со ссылками на закон',
        en: 'Contract review with statutory citations',
        de: 'Vertragsprüfung mit Gesetzesverweisen',
        ar: 'مراجعة العقد مع الإحالة إلى النصوص القانونية',
        kk: 'Заңға сілтемелері бар шартты талдау',
        uz: 'Qonunga havolalar bilan shartnoma tahlili',
      },
      lead: {
        ru: 'Загружаете договор в PDF, DOCX или текстом — получаете список рисков по пунктам, готовые правки и цитату нормы с адресом официального источника. Каждая ссылка проверяется кодом: неподтверждённая помечается «не проверено», а не выдаётся за факт.',
        en: 'Upload a contract as PDF, DOCX or plain text and get a clause-by-clause list of risks, ready-made redlines and a quotation of the provision with a link to its official source. Every citation is validated in code: an unconfirmed one is flagged “unverified” rather than presented as fact.',
        de: 'Laden Sie einen Vertrag als PDF, DOCX oder Text hoch und erhalten Sie eine klauselweise Risikoliste, fertige Änderungsvorschläge und das Zitat der Norm mit Verweis auf die amtliche Quelle. Jede Fundstelle wird im Code geprüft: eine unbestätigte wird als „nicht geprüft“ markiert statt als Tatsache ausgegeben.',
        ar: 'ارفع العقد بصيغة PDF أو DOCX أو نصًا، واحصل على قائمة مخاطر بندًا بندًا، وتعديلات جاهزة، واقتباس النص القانوني مع رابط مصدره الرسمي. كل إحالة تُتحقَّق منها برمجيًا: وغير المؤكدة تُوسم بـ«غير مُتحقَّق منها» بدلًا من تقديمها كحقيقة.',
        kk: 'Шартты PDF, DOCX немесе мәтін түрінде жүктейсіз — тармақ бойынша тәуекелдер тізімін, дайын түзетулерді және ресми дереккөзге сілтемесі бар норма дәйексөзін аласыз. Әрбір сілтеме кодпен тексеріледі: расталмағаны «тексерілмеген» деп белгіленеді, факт ретінде берілмейді.',
        uz: 'Shartnomani PDF, DOCX yoki matn koʻrinishida yuklaysiz — band boʻyicha xavflar roʻyxatini, tayyor tuzatishlarni va rasmiy manbaga havolasi bor norma iqtibosini olasiz. Har bir havola kod bilan tekshiriladi: tasdiqlanmagani «tekshirilmagan» deb belgilanadi, fakt sifatida berilmaydi.',
      },
      planNote: {
        ru: 'Доступно на всех тарифах, включая бесплатный: 20 разборов и 3 документа в месяц.',
        en: 'Available on every plan, including the free one: 20 AI requests and 3 documents per month.',
        de: 'In allen Tarifen enthalten, auch im kostenlosen: 20 KI-Anfragen und 3 Dokumente pro Monat.',
        ar: 'متاحة في جميع الباقات، بما فيها المجانية: 20 طلبًا و3 مستندات شهريًا.',
        kk: 'Барлық тарифтерде, тегінін қоса: айына 20 сұрау және 3 құжат.',
        uz: 'Barcha tariflarda, bepulini ham qoʻshib: oyiga 20 ta soʻrov va 3 ta hujjat.',
      },
      cta: [
        {
          label: {
            ru: 'Разобрать первый договор',
            en: 'Review your first contract',
            de: 'Ersten Vertrag prüfen',
            ar: 'راجع عقدك الأول',
            kk: 'Бірінші шартты талдау',
            uz: 'Birinchi shartnomani tahlil qilish',
          },
          to: '/login',
          variant: 'primary',
        },
        {
          label: {
            ru: 'На чём основаны выводы',
            en: 'What the conclusions rest on',
            de: 'Worauf die Aussagen beruhen',
            ar: 'على ماذا تستند الاستنتاجات',
            kk: 'Тұжырымдар неге негізделген',
            uz: 'Xulosalar nimaga asoslanadi',
          },
          to: '/legal-base',
          variant: 'secondary',
        },
      ],
    },

    {
      kind: 'facts',
      items: [
        {
          value: { ru: '17 248', en: '17,248', de: '17.248', ar: '17 248', kk: '17 248', uz: '17 248' },
          label: {
            ru: 'норм в корпусе',
            en: 'provisions in the corpus',
            de: 'Normen im Korpus',
            ar: 'نصًا في القاعدة',
            kk: 'норма корпуста',
            uz: 'norma korpusda',
          },
          proof: {
            ru: 'из 100 официальных актов по 7 юрисдикциям, данные на 5 августа 2026',
            en: 'from 100 official acts across 7 jurisdictions, as of 5 August 2026',
            de: 'aus 100 amtlichen Rechtsakten in 7 Jurisdiktionen, Stand 5. August 2026',
            ar: 'من 100 نص رسمي في 7 ولايات قضائية، بتاريخ 5 أغسطس 2026',
            kk: '7 юрисдикция бойынша 100 ресми актіден, 2026 жылғы 5 тамыздағы дерек',
            uz: '7 yurisdiksiya boʻyicha 100 ta rasmiy hujjatdan, 2026-yil 5-avgust holatiga',
          },
        },
        {
          value: { ru: '7', en: '7', de: '7', ar: '7', kk: '7', uz: '7' },
          label: {
            ru: 'официальных источников',
            en: 'official sources',
            de: 'amtliche Quellen',
            ar: 'مصادر رسمية',
            kk: 'ресми дереккөз',
            uz: 'rasmiy manba',
          },
          proof: {
            ru: 'государственные правовые порталы — и больше ниоткуда',
            en: 'state legal portals — and nowhere else',
            de: 'staatliche Rechtsportale — und sonst nichts',
            ar: 'بوابات قانونية حكومية — ولا شيء سواها',
            kk: 'мемлекеттік құқықтық порталдар — басқа еш жерден',
            uz: 'davlat huquqiy portallari — boshqa hech qayerdan',
          },
        },
        {
          value: {
            ru: 'sha256',
            en: 'sha256',
            de: 'sha256',
            ar: 'sha256',
            kk: 'sha256',
            uz: 'sha256',
          },
          label: {
            ru: 'у каждой нормы',
            en: 'on every provision',
            de: 'bei jeder Norm',
            ar: 'لكل نص',
            kk: 'әр норма үшін',
            uz: 'har bir norma uchun',
          },
          proof: {
            ru: 'адрес источника, контрольная сумма и дата загрузки — требование базы данных, а не обещание',
            en: 'source URL, checksum and retrieval date — a database constraint, not a promise',
            de: 'Quell-URL, Prüfsumme und Ladedatum — eine Datenbankbedingung, kein Versprechen',
            ar: 'رابط المصدر والبصمة الرقمية وتاريخ التحميل — قيد في قاعدة البيانات لا وعد',
            kk: 'дереккөз мекенжайы, бақылау сомасы және жүктеу күні — дерекқор талабы, уәде емес',
            uz: 'manba manzili, nazorat summasi va yuklash sanasi — bu maʼlumotlar bazasi talabi, vaʼda emas',
          },
        },
      ],
    },

    {
      kind: 'steps',
      title: {
        ru: 'Как проходит разбор',
        en: 'How a review runs',
        de: 'Wie eine Prüfung abläuft',
        ar: 'كيف تجري المراجعة',
        kk: 'Талдау қалай өтеді',
        uz: 'Tahlil qanday oʻtadi',
      },
      items: [
        {
          title: {
            ru: 'Загрузка и подготовка',
            en: 'Upload and preparation',
            de: 'Upload und Vorbereitung',
            ar: 'الرفع والتحضير',
            kk: 'Жүктеу және дайындау',
            uz: 'Yuklash va tayyorlash',
          },
          body: {
            ru: 'Файл проверяется антивирусом, из него извлекается текст, содержимое шифруется вашим ключом. Отсканированный PDF без текстового слоя честно отклоняется, а не разбирается наугад.',
            en: 'The file is scanned for malware, its text is extracted and the content is encrypted with your key. A scanned PDF with no text layer is honestly rejected rather than guessed at.',
            de: 'Die Datei wird auf Schadsoftware geprüft, der Text extrahiert und der Inhalt mit Ihrem Schlüssel verschlüsselt. Ein gescanntes PDF ohne Textebene wird ehrlich abgelehnt statt erraten.',
            ar: 'يُفحص الملف بمضاد الفيروسات، ويُستخرج نصه، ويُشفَّر المحتوى بمفتاحك. أما ملف PDF الممسوح ضوئيًا بلا طبقة نصية فيُرفض بصراحة بدل تخمينه.',
            kk: 'Файл антивируспен тексеріледі, мәтіні алынады, мазмұны сіздің кілтіңізбен шифрланады. Мәтін қабаты жоқ сканерленген PDF болжаммен талданбай, ашық түрде қабылданбайды.',
            uz: 'Fayl antivirus bilan tekshiriladi, matni ajratib olinadi, mazmuni sizning kalitingiz bilan shifrlanadi. Matn qatlami yoʻq skanerlangan PDF taxmin qilinmay, ochiq rad etiladi.',
          },
        },
        {
          title: {
            ru: 'Разбор по пунктам',
            en: 'Clause-by-clause review',
            de: 'Klauselweise Prüfung',
            ar: 'مراجعة بندًا بندًا',
            kk: 'Тармақ бойынша талдау',
            uz: 'Band boʻyicha tahlil',
          },
          body: {
            ru: 'Модель читает договор целиком и отмечает пункты с риском: ответственность, расторжение, штрафы, сроки, применимое право. У каждой находки — уровень риска и объяснение, чем именно она опасна.',
            en: 'The model reads the whole contract and flags risky clauses: liability, termination, penalties, deadlines, governing law. Each finding carries a risk level and an explanation of what exactly is dangerous.',
            de: 'Das Modell liest den gesamten Vertrag und markiert riskante Klauseln: Haftung, Kündigung, Vertragsstrafen, Fristen, anwendbares Recht. Jeder Befund hat eine Risikostufe und eine Erklärung, worin genau die Gefahr liegt.',
            ar: 'يقرأ النموذج العقد كاملًا ويؤشّر على البنود الخطرة: المسؤولية والإنهاء والغرامات والمواعيد والقانون الواجب التطبيق. ولكل ملاحظة درجة خطورة وشرح لمكمن الخطر.',
            kk: 'Модель шартты толық оқып, тәуекелді тармақтарды белгілейді: жауапкершілік, бұзу, айыппұл, мерзім, қолданылатын құқық. Әр табылымның тәуекел деңгейі және қауіптің неде екені түсіндіріледі.',
            uz: 'Model shartnomani toʻliq oʻqib, xavfli bandlarni belgilaydi: javobgarlik, bekor qilish, jarimalar, muddatlar, qoʻllaniladigan huquq. Har bir topilmaning xavf darajasi va nimasi xavfli ekani tushuntiriladi.',
          },
        },
        {
          title: {
            ru: 'Сверка с законом',
            en: 'Matching against the law',
            de: 'Abgleich mit dem Gesetz',
            ar: 'المطابقة مع القانون',
            kk: 'Заңмен салыстыру',
            uz: 'Qonun bilan solishtirish',
          },
          body: {
            ru: 'Находка сопоставляется с корпусом официальных текстов вашей юрисдикции. Цитату проверяет отдельный код: если норма не нашлась дословно, находка понижается и помечается «не проверено».',
            en: 'The finding is matched against the corpus of official texts for your jurisdiction. A separate piece of code validates the citation: if the provision is not found verbatim, the finding is downgraded and marked “unverified”.',
            de: 'Der Befund wird mit dem Korpus amtlicher Texte Ihrer Jurisdiktion abgeglichen. Ein separater Code prüft das Zitat: Wird die Norm nicht wörtlich gefunden, wird der Befund herabgestuft und als „nicht geprüft“ markiert.',
            ar: 'تُطابق الملاحظة مع قاعدة النصوص الرسمية لولايتك القضائية. ويتحقق كود مستقل من الاقتباس: فإن لم يُعثر على النص حرفيًا، تُخفَّض درجة الملاحظة وتُوسم بـ«غير مُتحقَّق منها».',
            kk: 'Табылым сіздің юрисдикцияңыздың ресми мәтіндер корпусымен салыстырылады. Дәйексөзді бөлек код тексереді: норма сөзбе-сөз табылмаса, табылым төмендетіліп, «тексерілмеген» деп белгіленеді.',
            uz: 'Topilma sizning yurisdiksiyangizning rasmiy matnlar korpusi bilan solishtiriladi. Iqtibosni alohida kod tekshiradi: agar norma soʻzma-soʻz topilmasa, topilma pasaytirilib, «tekshirilmagan» deb belgilanadi.',
          },
        },
        {
          title: {
            ru: 'Отчёт и правки',
            en: 'Report and redlines',
            de: 'Bericht und Änderungen',
            ar: 'التقرير والتعديلات',
            kk: 'Есеп және түзетулер',
            uz: 'Hisobot va tuzatishlar',
          },
          body: {
            ru: 'Вы получаете отчёт с находками и предложенные формулировки. Каждую правку можно принять или отклонить по отдельности, а итог выгрузить или отправить контрагенту ссылкой.',
            en: 'You get a report with the findings and suggested wording. Each redline can be accepted or rejected individually, and the result exported or sent to the counterparty as a link.',
            de: 'Sie erhalten einen Bericht mit den Befunden und Formulierungsvorschlägen. Jede Änderung lässt sich einzeln annehmen oder ablehnen, das Ergebnis exportieren oder der Gegenseite als Link senden.',
            ar: 'تحصل على تقرير بالملاحظات وصياغات مقترحة. ويمكن قبول كل تعديل أو رفضه على حدة، ثم تصدير النتيجة أو إرسالها للطرف الآخر عبر رابط.',
            kk: 'Сіз табылымдары бар есепті және ұсынылған тұжырымдарды аласыз. Әр түзетуді жеке қабылдауға немесе қабылдамауға, нәтижені жүктеп алуға немесе контрагентке сілтемемен жіберуге болады.',
            uz: 'Siz topilmalari bor hisobotni va taklif etilgan matnlarni olasiz. Har bir tuzatishni alohida qabul qilish yoki rad etish, natijani yuklab olish yoki kontragentga havola bilan yuborish mumkin.',
          },
        },
      ],
    },

    {
      kind: 'list',
      title: {
        ru: 'Что именно вы получаете',
        en: 'What you actually get',
        de: 'Was Sie konkret erhalten',
        ar: 'ما الذي تحصل عليه فعليًا',
        kk: 'Нақты не аласыз',
        uz: 'Aniq nima olasiz',
      },
      items: [
        {
          title: {
            ru: 'Находки с уровнем риска',
            en: 'Findings with a risk level',
            de: 'Befunde mit Risikostufe',
            ar: 'ملاحظات بدرجة خطورة',
            kk: 'Тәуекел деңгейі бар табылымдар',
            uz: 'Xavf darajasi bilan topilmalar',
          },
          body: {
            ru: 'высокий, средний или низкий, с привязкой к конкретному пункту договора',
            en: 'high, medium or low, tied to a specific clause of the contract',
            de: 'hoch, mittel oder niedrig, jeweils an eine konkrete Klausel gebunden',
            ar: 'عالية أو متوسطة أو منخفضة، مرتبطة ببند محدد في العقد',
            kk: 'жоғары, орташа немесе төмен, шарттың нақты тармағына байланған',
            uz: 'yuqori, oʻrta yoki past, shartnomaning aniq bandiga bogʻlangan',
          },
        },
        {
          title: {
            ru: 'Цитата нормы с адресом источника',
            en: 'The provision quoted, with its source link',
            de: 'Zitat der Norm mit Quellenlink',
            ar: 'اقتباس النص مع رابط مصدره',
            kk: 'Дереккөз мекенжайы бар норма дәйексөзі',
            uz: 'Manba manzili bilan norma iqtibosi',
          },
          body: {
            ru: 'дословный текст из официального портала, а не пересказ модели',
            en: 'verbatim text from the official portal, not the model’s paraphrase',
            de: 'wörtlicher Text vom amtlichen Portal, keine Paraphrase des Modells',
            ar: 'نص حرفي من البوابة الرسمية لا إعادة صياغة من النموذج',
            kk: 'ресми порталдан сөзбе-сөз мәтін, модельдің қайталауы емес',
            uz: 'rasmiy portaldan soʻzma-soʻz matn, modelning qayta hikoyasi emas',
          },
        },
        {
          title: {
            ru: 'Правки к тексту договора',
            en: 'Redlines to the contract text',
            de: 'Änderungsvorschläge zum Vertragstext',
            ar: 'تعديلات على نص العقد',
            kk: 'Шарт мәтініне түзетулер',
            uz: 'Shartnoma matniga tuzatishlar',
          },
          body: {
            ru: 'принимаются и отклоняются по одной, видно, что было и что стало',
            en: 'accepted or rejected one by one, with before and after visible',
            de: 'einzeln annehmbar oder ablehnbar, mit Vorher und Nachher',
            ar: 'تُقبل أو تُرفض واحدة تلو الأخرى مع إظهار ما قبل وما بعد',
            kk: 'бір-бірлеп қабылданады не қабылданбайды, бұрынғысы мен кейінгісі көрінеді',
            uz: 'bittalab qabul qilinadi yoki rad etiladi, avvalgisi va keyingisi koʻrinadi',
          },
        },
        {
          title: {
            ru: 'Экспорт в DOCX с настоящими правками Word',
            en: 'DOCX export with real Word tracked changes',
            de: 'DOCX-Export mit echten Word-Änderungen',
            ar: 'تصدير DOCX بتعديلات Word حقيقية',
            kk: 'Нағыз Word түзетулерімен DOCX экспорты',
            uz: 'Haqiqiy Word tuzatishlari bilan DOCX eksporti',
          },
          body: {
            ru: 'контрагент принимает и отклоняет их прямо в Word — тариф Standard и выше',
            en: 'the counterparty accepts or rejects them inside Word — Standard plan and above',
            de: 'die Gegenseite nimmt sie direkt in Word an oder ab — ab Tarif Standard',
            ar: 'يقبلها الطرف الآخر أو يرفضها داخل Word — باقة Standard فما فوق',
            kk: 'контрагент оларды Word ішінде қабылдайды не қабылдамайды — Standard тарифінен бастап',
            uz: 'kontragent ularni Word ichida qabul qiladi yoki rad etadi — Standard tarifidan boshlab',
          },
        },
        {
          title: {
            ru: 'Ссылка на отчёт для контрагента',
            en: 'A report link for the counterparty',
            de: 'Berichtslink für die Gegenseite',
            ar: 'رابط تقرير للطرف الآخر',
            kk: 'Контрагентке арналған есеп сілтемесі',
            uz: 'Kontragent uchun hisobot havolasi',
          },
          body: {
            ru: 'без регистрации, живёт 90 дней, отзывается в один клик и гаснет вместе с документом',
            en: 'no sign-up needed, valid for 90 days, revocable in one click and dies with the document',
            de: 'ohne Registrierung, 90 Tage gültig, mit einem Klick widerrufbar und erlischt mit dem Dokument',
            ar: 'بلا تسجيل، صالح 90 يومًا، يُلغى بنقرة واحدة ويُبطل مع حذف المستند',
            kk: 'тіркеусіз, 90 күн жарамды, бір басуда кері қайтарылады және құжатпен бірге өшеді',
            uz: 'roʻyxatdan oʻtmasdan, 90 kun amal qiladi, bir bosishda bekor qilinadi va hujjat bilan birga oʻchadi',
          },
        },
      ],
    },

    {
      kind: 'prose',
      title: {
        ru: 'На чём основаны выводы',
        en: 'What the conclusions rest on',
        de: 'Worauf die Schlüsse beruhen',
        ar: 'على ماذا تستند الاستنتاجات',
        kk: 'Тұжырымдар неге негізделген',
        uz: 'Xulosalar nimaga asoslanadi',
      },
      paragraphs: [
        {
          ru: 'Ссылки берутся из собственного корпуса: 100 официальных актов, 17 248 норм, семь юрисдикций. Тексты загружаются только с государственных правовых порталов — legislation.gov.uk, lex.uz, adilet.zan.kz, gesetze-im-internet.de, govinfo.gov, legisquebec.gouv.qc.ca, uaelegislation.gov.ae и. Больше ниоткуда.',
          en: 'Citations come from our own corpus: 100 official acts, 17,248 provisions, seven jurisdictions. Texts are loaded only from state legal portals — legislation.gov.uk, lex.uz, adilet.zan.kz, gesetze-im-internet.de, govinfo.gov, legisquebec.gouv.qc.ca, uaelegislation.gov.ae. Nowhere else.',
          de: 'Die Fundstellen stammen aus einem eigenen Korpus: 100 amtliche Rechtsakte, 17.248 Normen, sieben Jurisdiktionen. Texte werden ausschließlich von staatlichen Rechtsportalen geladen — legislation.gov.uk, lex.uz, adilet.zan.kz, gesetze-im-internet.de, govinfo.gov, legisquebec.gouv.qc.ca, uaelegislation.gov.ae. Sonst nirgendwoher.',
          ar: 'تأتي الإحالات من قاعدتنا الخاصة: 100 نص رسمي، و17 248 حكمًا، وسبع ولايات قضائية. ولا تُحمَّل النصوص إلا من بوابات قانونية حكومية — legislation.gov.uk وlex.uz وadilet.zan.kz وgesetze-im-internet.de وgovinfo.gov وlegisquebec.gouv.qc.ca وuaelegislation.gov.ae و. ولا شيء سواها.',
          kk: 'Сілтемелер өз корпусымыздан алынады: 100 ресми акт, 17 248 норма, жеті юрисдикция. Мәтіндер тек мемлекеттік құқықтық порталдардан жүктеледі — legislation.gov.uk, lex.uz, adilet.zan.kz, gesetze-im-internet.de, govinfo.gov, legisquebec.gouv.qc.ca, uaelegislation.gov.ae және. Басқа еш жерден.',
          uz: 'Havolalar oʻz korpusimizdan olinadi: 100 ta rasmiy hujjat, 17 248 norma, yettita yurisdiksiya. Matnlar faqat davlat huquqiy portallaridan yuklanadi — legislation.gov.uk, lex.uz, adilet.zan.kz, gesetze-im-internet.de, govinfo.gov, legisquebec.gouv.qc.ca, uaelegislation.gov.ae. Boshqa hech qayerdan.',
        },
        {
          ru: 'Норма без адреса источника, контрольной суммы и даты загрузки физически не сохранится в базе — это ограничение самой базы данных, а не редакционная политика. И главное правило: Lexab никогда не генерирует текст закона. Если нормы нет в корпусе, вы увидите отметку «не проверено», а не выдуманный номер статьи.',
          en: 'A provision without a source URL, checksum and retrieval date physically cannot be stored — that is a constraint of the database itself, not an editorial policy. And the core rule: Lexab never generates statutory text. If a provision is not in the corpus you will see an “unverified” mark rather than an invented article number.',
          de: 'Eine Norm ohne Quell-URL, Prüfsumme und Ladedatum lässt sich physisch nicht speichern — das ist eine Bedingung der Datenbank selbst, keine redaktionelle Richtlinie. Und die Grundregel: Lexab erzeugt niemals Gesetzestext. Fehlt eine Norm im Korpus, sehen Sie den Vermerk „nicht geprüft“ statt einer erfundenen Paragrafennummer.',
          ar: 'لا يمكن فيزيائيًا تخزين نص بلا رابط مصدر وبصمة رقمية وتاريخ تحميل — وهذا قيد في قاعدة البيانات نفسها لا سياسة تحريرية. والقاعدة الأهم: لا يولّد Lexab نص القانون إطلاقًا. فإن لم يكن النص في القاعدة سترى وسم «غير مُتحقَّق منه» بدل رقم مادة مُختلق.',
          kk: 'Дереккөз мекенжайы, бақылау сомасы және жүктеу күні жоқ норма дерекқорда физикалық тұрғыда сақталмайды — бұл дерекқордың өз шектеуі, редакциялық саясат емес. Ең басты ереже: Lexab заң мәтінін ешқашан құрастырмайды. Егер норма корпуста болмаса, ойдан шығарылған бап нөмірі емес, «тексерілмеген» белгісін көресіз.',
          uz: 'Manba manzili, nazorat summasi va yuklash sanasi yoʻq norma bazada jismonan saqlanmaydi — bu bazaning oʻz cheklovi, tahririy siyosat emas. Eng asosiy qoida: Lexab qonun matnini hech qachon oʻylab topmaydi. Agar norma korpusda boʻlmasa, toʻqilgan modda raqami emas, «tekshirilmagan» belgisini koʻrasiz.',
        },
      ],
    },

    {
      kind: 'list',
      tone: 'limits',
      title: {
        ru: 'Границы: чего разбор не делает',
        en: 'Boundaries: what the review does not do',
        de: 'Grenzen: was die Prüfung nicht leistet',
        ar: 'الحدود: ما لا تفعله المراجعة',
        kk: 'Шектер: талдау нені істемейді',
        uz: 'Chegaralar: tahlil nima qilmaydi',
      },
      items: [
        {
          title: {
            ru: 'Не даёт судебной практики',
            en: 'Does not provide case law',
            de: 'Liefert keine Rechtsprechung',
            ar: 'لا يقدّم السوابق القضائية',
            kk: 'Сот тәжірибесін бермейді',
            uz: 'Sud amaliyotini bermaydi',
          },
          body: {
            ru: 'в корпусе только действующие нормативные акты; как норму применяют суды — вывод юриста',
            en: 'the corpus holds statutes only; how courts apply a provision is the lawyer’s call',
            de: 'im Korpus stehen nur Rechtsvorschriften; wie Gerichte eine Norm anwenden, entscheidet der Jurist',
            ar: 'تضم القاعدة النصوص التشريعية فقط؛ أما كيفية تطبيق المحاكم فمن اختصاص المحامي',
            kk: 'корпуста тек қолданыстағы нормативтік актілер бар; норманы соттар қалай қолданатыны — заңгердің тұжырымы',
            uz: 'korpusda faqat amaldagi normativ hujjatlar bor; normani sudlar qanday qoʻllashi — yuristning xulosasi',
          },
        },
        {
          title: {
            ru: 'Не даёт ссылок на право штатов США',
            en: 'Gives no citations to US state law',
            de: 'Nennt keine Fundstellen zum US-Bundesstaatenrecht',
            ar: 'لا يحيل إلى قوانين الولايات الأمريكية',
            kk: 'АҚШ штаттарының құқығына сілтеме бермейді',
            uz: 'AQSH shtatlari huquqiga havola bermaydi',
          },
          body: {
            ru: 'по США загружены два федеральных акта — об арбитраже и об электронных подписях',
            en: 'for the US we have loaded two federal acts — on arbitration and on electronic signatures',
            de: 'für die USA sind zwei Bundesgesetze geladen — zu Schiedsverfahren und zu elektronischen Signaturen',
            ar: 'بالنسبة للولايات المتحدة حُمِّل نصّان اتحاديان — عن التحكيم وعن التوقيعات الإلكترونية',
            kk: 'АҚШ бойынша екі федералдық акт жүктелген — төрелік және электрондық қолтаңба туралы',
            uz: 'AQSH boʻyicha ikkita federal hujjat yuklangan — arbitraj va elektron imzolar haqida',
          },
        },
        {
          title: {
            ru: 'Не подписывает документ',
            en: 'Does not sign the document',
            de: 'Unterschreibt das Dokument nicht',
            ar: 'لا يوقّع المستند',
            kk: 'Құжатқа қол қоймайды',
            uz: 'Hujjatni imzolamaydi',
          },
          body: {
            ru: 'доводим до финальной редакции и выгружаем DOCX — подписываете вы в привычном сервисе',
            en: 'we take it to the final wording and export DOCX — you sign in your usual service',
            de: 'wir führen zur Endfassung und exportieren DOCX — unterschrieben wird in Ihrem gewohnten Dienst',
            ar: 'نصل بالعقد إلى صيغته النهائية ونصدّره DOCX — والتوقيع لديك في خدمتك المعتادة',
            kk: 'соңғы редакцияға дейін жеткізіп, DOCX-ті береміз — қолды өзіңіз әдеттегі сервисте қоясыз',
            uz: 'yakuniy tahrirgacha yetkazib, DOCX ni beramiz — imzoni oʻzingiz odatdagi xizmatda qoʻyasiz',
          },
        },
        {
          title: {
            ru: 'Не заменяет юриста',
            en: 'Does not replace a lawyer',
            de: 'Ersetzt keinen Juristen',
            ar: 'لا يحل محل المحامي',
            kk: 'Заңгерді алмастырмайды',
            uz: 'Yuristning oʻrnini bosmaydi',
          },
          body: {
            ru: 'это инструмент вычитки: решение по каждой находке принимает человек',
            en: 'it is a review tool: a human decides on every finding',
            de: 'es ist ein Prüfwerkzeug: über jeden Befund entscheidet ein Mensch',
            ar: 'إنها أداة مراجعة: والقرار في كل ملاحظة يعود إلى إنسان',
            kk: 'бұл тексеру құралы: әр табылым бойынша шешімді адам қабылдайды',
            uz: 'bu tekshiruv vositasi: har bir topilma boʻyicha qarorni inson qabul qiladi',
          },
        },
      ],
    },

    {
      kind: 'prose',
      title: {
        ru: 'Данные и доступ',
        en: 'Data and access',
        de: 'Daten und Zugriff',
        ar: 'البيانات والوصول',
        kk: 'Деректер және қолжетімділік',
        uz: 'Maʼlumotlar va kirish',
      },
      paragraphs: [
        {
          ru: 'Текст договора, резюме анализа, блоки документа и правки зашифрованы алгоритмом AES-256-GCM: у каждого пользователя свой ключ, обёрнутый мастер-ключом сервиса. Открытыми намеренно остаются имя файла, контрагент и заголовки находок — по ним работают поиск и сортировка, а по шифротексту они работать не могут.',
          en: 'The contract text, the analysis summary, the document blocks and the redlines are encrypted with AES-256-GCM: every user has their own key, wrapped by the service master key. The file name, the counterparty and the finding titles deliberately stay in clear text — search and sorting run on them, and they cannot run on ciphertext.',
          de: 'Vertragstext, Analyse-Zusammenfassung, Dokumentblöcke und Änderungen sind mit AES-256-GCM verschlüsselt: Jeder Nutzer hat einen eigenen Schlüssel, der vom Hauptschlüssel des Dienstes umschlossen wird. Dateiname, Vertragspartner und Befundtitel bleiben bewusst im Klartext — Suche und Sortierung arbeiten darauf und können auf Chiffretext nicht arbeiten.',
          ar: 'نص العقد وملخّص التحليل وكتل المستند والتعديلات مشفّرة بخوارزمية AES-256-GCM: لكل مستخدم مفتاحه الخاص مغلَّفًا بمفتاح الخدمة الرئيسي. أما اسم الملف والطرف المقابل وعناوين الملاحظات فتبقى بنص ظاهر عن قصد — إذ يعمل عليها البحث والفرز، ولا يمكنهما العمل على نص مشفّر.',
          kk: 'Шарт мәтіні, талдау түйіні, құжат блоктары және түзетулер AES-256-GCM алгоритмімен шифрланған: әр пайдаланушының өз кілті бар, ол сервистің басты кілтімен оралған. Файл атауы, контрагент және табылым тақырыптары әдейі ашық қалады — іздеу мен сұрыптау солар бойынша жұмыс істейді, шифрмәтін бойынша істей алмайды.',
          uz: 'Shartnoma matni, tahlil xulosasi, hujjat bloklari va tuzatishlar AES-256-GCM algoritmi bilan shifrlangan: har bir foydalanuvchining oʻz kaliti bor, u xizmatning bosh kaliti bilan oʻralgan. Fayl nomi, kontragent va topilma sarlavhalari ataylab ochiq qoladi — qidiruv va saralash shular boʻyicha ishlaydi, shifrmatn boʻyicha ishlay olmaydi.',
        },
        {
          ru: 'Каждое действие с документом попадает в журнал. События искусственного интеллекта хранят только признак операции и её результат — никогда сам запрос и никогда ответ модели.',
          en: 'Every action on a document is written to the audit log. AI events store only the operation flag and its outcome — never the prompt itself and never the model’s output.',
          de: 'Jede Aktion an einem Dokument wird protokolliert. KI-Ereignisse speichern nur die Art der Operation und ihr Ergebnis — nie die Anfrage selbst und nie die Antwort des Modells.',
          ar: 'يُسجَّل كل إجراء على المستند في سجل الأحداث. أما أحداث الذكاء الاصطناعي فتحفظ نوع العملية ونتيجتها فقط — لا الطلب نفسه ولا مخرجات النموذج إطلاقًا.',
          kk: 'Құжатпен жасалған әр әрекет журналға түседі. Жасанды интеллект оқиғалары тек операция белгісі мен нәтижесін сақтайды — сұрауды да, модель жауабын да ешқашан сақтамайды.',
          uz: 'Hujjat bilan bogʻliq har bir amal jurnalga tushadi. Sunʼiy intellekt hodisalari faqat amal belgisi va natijasini saqlaydi — soʻrovni ham, model javobini ham hech qachon saqlamaydi.',
        },
      ],
    },

    {
      kind: 'table',
      title: {
        ru: 'Сколько разборов входит в тариф',
        en: 'How many reviews each plan includes',
        de: 'Wie viele Prüfungen jeder Tarif enthält',
        ar: 'كم مراجعة تشمل كل باقة',
        kk: 'Тарифке қанша талдау кіреді',
        uz: 'Tarifga nechta tahlil kiradi',
      },
      columns: [
        { ru: 'Тариф', en: 'Plan', de: 'Tarif', ar: 'الباقة', kk: 'Тариф', uz: 'Tarif' },
        {
          ru: 'ИИ-запросов в месяц',
          en: 'AI requests per month',
          de: 'KI-Anfragen pro Monat',
          ar: 'طلبات الذكاء الاصطناعي شهريًا',
          kk: 'Айына ЖИ сұрауы',
          uz: 'Oyiga AI soʻrovlari',
        },
        {
          ru: 'Документов в месяц',
          en: 'Documents per month',
          de: 'Dokumente pro Monat',
          ar: 'مستندات شهريًا',
          kk: 'Айына құжат',
          uz: 'Oyiga hujjatlar',
        },
      ],
      rows: [
        [
          { ru: 'Free', en: 'Free', de: 'Free', ar: 'Free', kk: 'Free', uz: 'Free' },
          { ru: '20', en: '20', de: '20', ar: '20', kk: '20', uz: '20' },
          { ru: '3', en: '3', de: '3', ar: '3', kk: '3', uz: '3' },
        ],
        [
          { ru: 'Standard', en: 'Standard', de: 'Standard', ar: 'Standard', kk: 'Standard', uz: 'Standard' },
          { ru: '100', en: '100', de: '100', ar: '100', kk: '100', uz: '100' },
          { ru: '20', en: '20', de: '20', ar: '20', kk: '20', uz: '20' },
        ],
        [
          { ru: 'Pro', en: 'Pro', de: 'Pro', ar: 'Pro', kk: 'Pro', uz: 'Pro' },
          { ru: '500', en: '500', de: '500', ar: '500', kk: '500', uz: '500' },
          { ru: '80', en: '80', de: '80', ar: '80', kk: '80', uz: '80' },
        ],
        [
          { ru: 'Business', en: 'Business', de: 'Business', ar: 'Business', kk: 'Business', uz: 'Business' },
          { ru: '10 000', en: '10,000', de: '10.000', ar: '10 000', kk: '10 000', uz: '10 000' },
          { ru: '700', en: '700', de: '700', ar: '700', kk: '700', uz: '700' },
        ],
        [
          { ru: 'Enterprise', en: 'Enterprise', de: 'Enterprise', ar: 'Enterprise', kk: 'Enterprise', uz: 'Enterprise' },
          { ru: '50 000', en: '50,000', de: '50.000', ar: '50 000', kk: '50 000', uz: '50 000' },
          {
            ru: 'без ограничения',
            en: 'unlimited',
            de: 'unbegrenzt',
            ar: 'بلا حد',
            kk: 'шектеусіз',
            uz: 'cheklovsiz',
          },
        ],
      ],
      note: {
        ru: 'Повторный разбор того же самого файла новую единицу не тратит. Счётчик обнуляется 1-го числа; удаление документа единицу не возвращает.',
        en: 'Re-running the review on the very same file costs no additional unit. The counter resets on the 1st; deleting a document does not give the unit back.',
        de: 'Eine erneute Prüfung derselben Datei verbraucht keine weitere Einheit. Der Zähler wird am 1. zurückgesetzt; das Löschen eines Dokuments gibt die Einheit nicht zurück.',
        ar: 'إعادة مراجعة الملف نفسه لا تستهلك وحدة إضافية. ويُصفَّر العداد في اليوم الأول من الشهر، وحذف المستند لا يعيد الوحدة.',
        kk: 'Дәл сол файлды қайта талдау жаңа бірлік жұмсамайды. Есептегіш айдың 1-інде нөлденеді; құжатты жою бірлікті қайтармайды.',
        uz: 'Aynan oʻsha faylni qayta tahlil qilish yangi birlik sarflamaydi. Hisoblagich oyning 1-sanasida nollanadi; hujjatni oʻchirish birlikni qaytarmaydi.',
      },
    },

    {
      kind: 'faq',
      title: {
        ru: 'Частые вопросы',
        en: 'Frequently asked questions',
        de: 'Häufige Fragen',
        ar: 'أسئلة متكررة',
        kk: 'Жиі қойылатын сұрақтар',
        uz: 'Koʻp beriladigan savollar',
      },
      items: [
        {
          q: {
            ru: 'Что будет, если модель сошлётся на несуществующую норму?',
            en: 'What happens if the model cites a provision that does not exist?',
            de: 'Was passiert, wenn das Modell eine nicht existierende Norm zitiert?',
            ar: 'ماذا يحدث إن أحال النموذج إلى نص غير موجود؟',
            kk: 'Модель жоқ нормаға сілтесе не болады?',
            uz: 'Model mavjud boʻlmagan normaga havola qilsa nima boʻladi?',
          },
          a: {
            ru: 'Цитату проверяет отдельный код, а не сам ИИ. Если норма не находится в корпусе дословно, находка автоматически понижается и получает пометку «не проверено» — вы видите её как неподтверждённую и решаете сами.',
            en: 'The citation is validated by separate code, not by the AI itself. If the provision is not found verbatim in the corpus, the finding is automatically downgraded and marked “unverified” — you see it as unconfirmed and decide for yourself.',
            de: 'Das Zitat prüft separater Code, nicht die KI selbst. Wird die Norm im Korpus nicht wörtlich gefunden, wird der Befund automatisch herabgestuft und als „nicht geprüft“ gekennzeichnet — Sie sehen ihn als unbestätigt und entscheiden selbst.',
            ar: 'يتحقق من الاقتباس كود مستقل لا الذكاء الاصطناعي نفسه. فإن لم يُعثر على النص حرفيًا في القاعدة، تُخفَّض الملاحظة تلقائيًا وتُوسم بـ«غير مُتحقَّق منها» — فتراها غير مؤكدة وتقرّر بنفسك.',
            kk: 'Дәйексөзді ЖИ емес, бөлек код тексереді. Норма корпуста сөзбе-сөз табылмаса, табылым автоматты түрде төмендетіліп, «тексерілмеген» белгісін алады — сіз оны расталмаған деп көріп, өзіңіз шешесіз.',
            uz: 'Iqtibosni AI emas, alohida kod tekshiradi. Agar norma korpusda soʻzma-soʻz topilmasa, topilma avtomatik pasaytirilib, «tekshirilmagan» belgisini oladi — siz uni tasdiqlanmagan deb koʻrasiz va oʻzingiz qaror qilasiz.',
          },
        },
        {
          q: {
            ru: 'Какие файлы поддерживаются?',
            en: 'Which file types are supported?',
            de: 'Welche Dateitypen werden unterstützt?',
            ar: 'ما صيغ الملفات المدعومة؟',
            kk: 'Қандай файлдар қолдау табады?',
            uz: 'Qanday fayllar qoʻllab-quvvatlanadi?',
          },
          a: {
            ru: 'PDF, DOC, DOCX и обычный текст — до 10 МБ. Отсканированный PDF без текстового слоя честно отклоняется: разбирать изображение как текст и выдавать результат за анализ мы не будем.',
            en: 'PDF, DOC, DOCX and plain text — up to 10 MB. A scanned PDF with no text layer is honestly rejected: we will not treat an image as text and pass the result off as a review.',
            de: 'PDF, DOC, DOCX und einfacher Text — bis 10 MB. Ein gescanntes PDF ohne Textebene wird ehrlich abgelehnt: Wir behandeln kein Bild als Text und geben das Ergebnis nicht als Prüfung aus.',
            ar: 'PDF وDOC وDOCX والنص العادي — حتى 10 ميغابايت. ويُرفض ملف PDF الممسوح ضوئيًا بلا طبقة نصية بصراحة: فلن نعامل صورة كأنها نص ونقدّم النتيجة على أنها مراجعة.',
            kk: 'PDF, DOC, DOCX және кәдімгі мәтін — 10 МБ дейін. Мәтін қабаты жоқ сканерленген PDF ашық түрде қабылданбайды: суретті мәтін ретінде талдап, нәтижені талдау деп ұсынбаймыз.',
            uz: 'PDF, DOC, DOCX va oddiy matn — 10 MB gacha. Matn qatlami yoʻq skanerlangan PDF ochiq rad etiladi: rasmni matn deb tahlil qilib, natijani tahlil sifatida bermaymiz.',
          },
        },
        {
          q: {
            ru: 'Мой договор подчинён праву штата Нью-Йорк — что я получу?',
            en: 'My contract is governed by New York law — what will I get?',
            de: 'Mein Vertrag unterliegt dem Recht des Staates New York — was bekomme ich?',
            ar: 'عقدي يخضع لقانون ولاية نيويورك — فماذا سأحصل عليه؟',
            kk: 'Менің шартым Нью-Йорк штатының құқығына бағынады — не аламын?',
            uz: 'Shartnomam Nyu-York shtati huquqiga boʻysunadi — nima olaman?',
          },
          a: {
            ru: 'Структуру, риски и правки вы получите. Ссылок на статуты штата — нет: по США в корпусе только два федеральных акта. Вместо выдуманного номера параграфа Lexab прямо скажет, что нормы в базе нет.',
            en: 'You will get the structure, the risks and the redlines. Citations to state statutes — no: for the US the corpus holds only two federal acts. Instead of an invented paragraph number, Lexab will say plainly that the provision is not in the corpus.',
            de: 'Struktur, Risiken und Änderungsvorschläge erhalten Sie. Fundstellen zu einzelstaatlichen Gesetzen nicht: Für die USA enthält das Korpus nur zwei Bundesgesetze. Statt einer erfundenen Paragrafennummer sagt Lexab klar, dass die Norm nicht im Korpus ist.',
            ar: 'ستحصل على البنية والمخاطر والتعديلات. أما الإحالة إلى قوانين الولاية فلا: إذ لا تضم القاعدة للولايات المتحدة سوى نصّين اتحاديين. وبدل رقم مادة مُختلق، يقول Lexab صراحةً إن النص غير موجود في القاعدة.',
            kk: 'Құрылымды, тәуекелдерді және түзетулерді аласыз. Штат заңдарына сілтеме — жоқ: АҚШ бойынша корпуста тек екі федералдық акт бар. Ойдан шығарылған тармақ нөмірінің орнына Lexab норманың базада жоқтығын тікелей айтады.',
            uz: 'Tuzilma, xavflar va tuzatishlarni olasiz. Shtat qonunlariga havola — yoʻq: AQSH boʻyicha korpusda faqat ikkita federal hujjat bor. Toʻqilgan modda raqami oʻrniga Lexab norma bazada yoʻqligini ochiq aytadi.',
          },
        },
        {
          q: {
            ru: 'Можно попробовать без оплаты?',
            en: 'Can I try it without paying?',
            de: 'Kann ich es kostenlos testen?',
            ar: 'هل أستطيع التجربة دون دفع؟',
            kk: 'Ақысыз көріп көруге бола ма?',
            uz: 'Toʻlovsiz sinab koʻrsa boʻladimi?',
          },
          a: {
            ru: 'Да. Бесплатный тариф даёт 20 ИИ-запросов, 3 документа и 50 МБ хранилища в месяц, а подключение Google Drive, OneDrive и Dropbox доступно на всех тарифах, включая его.',
            en: 'Yes. The free plan gives 20 AI requests, 3 documents and 50 MB of storage per month, and Google Drive, OneDrive and Dropbox connections are available on every plan, including it.',
            de: 'Ja. Der kostenlose Tarif bietet 20 KI-Anfragen, 3 Dokumente und 50 MB Speicher pro Monat; Google Drive, OneDrive und Dropbox lassen sich in allen Tarifen anbinden, auch in diesem.',
            ar: 'نعم. تمنحك الباقة المجانية 20 طلبًا و3 مستندات و100 ميغابايت تخزينًا شهريًا، كما أن ربط Google Drive وOneDrive وDropbox متاح في جميع الباقات بما فيها هذه.',
            kk: 'Иә. Тегін тариф айына 20 ЖИ сұрауын, 3 құжатты және 50 МБ қойманы береді, ал Google Drive, OneDrive және Dropbox қосу барлық тарифтерде, оның ішінде осында да, қолжетімді.',
            uz: 'Ha. Bepul tarif oyiga 20 ta AI soʻrovi, 3 ta hujjat va 50 MB xotira beradi, Google Drive, OneDrive va Dropbox ulash esa barcha tariflarda, shu jumladan unda ham mavjud.',
          },
        },
      ],
    },

    {
      // Аудит 06.08.2026: это единственная страница без блока «дальше по теме»,
      // притом самая посещаемая — 11 входящих ссылок с других страниц, а наружу
      // вели только /login и /legal-base. Ведёт на /pricing и /version-compare:
      // до этого на них не было ни одной входящей ссылки из контента.
      kind: 'related',
      title: { ru: 'Дальше по теме', en: 'Related', de: 'Weiterlesen', ar: 'مواضيع ذات صلة', kk: 'Тақырып бойынша әрі қарай', uz: 'Mavzu boʻyicha davomi' },
      items: [
        {
          title: { ru: 'Сравнение редакций', en: 'Version compare', de: 'Versionsvergleich', ar: 'مقارنة النسخ', kk: 'Редакцияларды салыстыру', uz: 'Tahrirlarni solishtirish' },
          body: {
            ru: 'Когда контрагент прислал вторую версию: что изменилось и чем это грозит.',
            en: 'When the counterparty sends a second version: what changed and what it exposes you to.',
            de: 'Wenn die Gegenseite eine zweite Fassung schickt: was sich geändert hat und was droht.',
            ar: 'حين يرسل الطرف الآخر نسخة ثانية: ما الذي تغيّر وما خطره عليك.',
            kk: 'Контрагент екінші нұсқаны жібергенде: не өзгерді және немен қауіпті.',
            uz: 'Kontragent ikkinchi versiyani yuborganda: nima oʻzgardi va nima bilan xavfli.',
          },
          to: '/version-compare',
        },
        {
          title: { ru: 'Вопросы по документу', en: 'Document Q&A', de: 'Fragen zum Dokument', ar: 'أسئلة عن المستند', kk: 'Құжат бойынша сұрақтар', uz: 'Hujjat boʻyicha savollar' },
          body: {
            ru: 'Уточнить смысл конкретного пункта, не перечитывая весь разбор.',
            en: 'Clarify a specific clause without re-reading the whole review.',
            de: 'Eine konkrete Klausel klären, ohne die ganze Prüfung erneut zu lesen.',
            ar: 'توضيح بند بعينه دون إعادة قراءة المراجعة كلها.',
            kk: 'Бүкіл талдауды қайта оқымай, нақты тармақтың мәнін нақтылау.',
            uz: 'Butun tahlilni qayta oʻqimasdan, aniq bandning maʼnosini aniqlashtirish.',
          },
          to: '/document-chat',
        },
        {
          title: { ru: 'Тарифы', en: 'Pricing', de: 'Preise', ar: 'الأسعار', kk: 'Тарифтер', uz: 'Tariflar' },
          body: {
            ru: 'Сколько разборов входит в каждый тариф и что считается одним обращением.',
            en: 'How many reviews each plan includes and what counts as one request.',
            de: 'Wie viele Prüfungen jeder Tarif enthält und was als eine Anfrage zählt.',
            ar: 'كم مراجعة تشمل كل باقة وما الذي يُحتسب طلبًا واحدًا.',
            kk: 'Әр тарифке қанша талдау кіреді және бір өтініш деп не саналады.',
            uz: 'Har bir tarifga nechta tahlil kiradi va bitta murojaat deb nima sanaladi.',
          },
          to: '/pricing',
        },
      ],
    },

    {
      kind: 'cta',
      title: {
        ru: 'Разберите свой договор',
        en: 'Review your own contract',
        de: 'Prüfen Sie Ihren Vertrag',
        ar: 'راجع عقدك أنت',
        kk: 'Өз шартыңызды талдаңыз',
        uz: 'Oʻz shartnomangizni tahlil qiling',
      },
      body: {
        ru: 'Бесплатный тариф без карты: 20 разборов и 3 документа в месяц.',
        en: 'Free plan, no card required: 20 reviews and 3 documents per month.',
        de: 'Kostenloser Tarif ohne Karte: 20 Prüfungen und 3 Dokumente pro Monat.',
        ar: 'باقة مجانية بلا بطاقة: 20 مراجعة و3 مستندات شهريًا.',
        kk: 'Картасыз тегін тариф: айына 20 талдау және 3 құжат.',
        uz: 'Kartasiz bepul tarif: oyiga 20 tahlil va 3 hujjat.',
      },
      cta: [
        {
          label: {
            ru: 'Начать бесплатно',
            en: 'Start for free',
            de: 'Kostenlos starten',
            ar: 'ابدأ مجانًا',
            kk: 'Тегін бастау',
            uz: 'Bepul boshlash',
          },
          to: '/login',
          variant: 'primary',
        },
      ],
    },
  ],
};
