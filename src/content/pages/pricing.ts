/**
 * Публичная страница «Тарифы».
 *
 * ЧИСЕЛ В ЭТОМ ФАЙЛЕ НЕТ И БЫТЬ НЕ ДОЛЖНО. Цены, лимиты и места рисует блок
 * kind:'plans' из src/content/site/plans.ts, а тот сцеплен тестом с серверными
 * PLAN_LIMITS и PLAN_SEATS. Поэтому страница физически не может пообещать
 * больше, чем сервер даёт: цифру некуда вписать руками.
 *
 * Состав возможностей по ступеням — зеркало FEATURE_MIN_PLAN (planFeatures.ts),
 * проверено 05.08.2026: Standard+ — выгрузка DOCX и шаблоны; Pro+ — сравнение
 * редакций, история версий, согласования, плейбуки, обязательства и сроки,
 * пакетная проверка, сценарии; Business+ — команда, журнал действий, единый
 * вход, программный доступ.
 * Электронные подписи НЕ УПОМИНАЕМ: раздел выключен в развёртывании.
 */
import type { PageContent } from '../types';

export const pricing: PageContent = {
  slug: 'pricing',
  pageTitle: {
    ru: 'Тарифы — Lexab',
    en: 'Pricing — Lexab',
    de: 'Preise — Lexab',
    ar: 'الأسعار — Lexab',
    kk: 'Тарифтер — Lexab',
    uz: 'Tariflar — Lexab',
  },
  blocks: [
    {
      kind: 'hero',
      title: {
        ru: 'Тарифы без мелкого шрифта',
        en: 'Pricing without small print',
        de: 'Preise ohne Kleingedrucktes',
        ar: 'أسعار بلا حواشٍ صغيرة',
        kk: 'Ұсақ жазуы жоқ тарифтер',
        uz: 'Mayda yozuvsiz tariflar',
      },
      lead: {
        ru: 'Всё, что вы видите в таблице ниже, — это те же числа, которые сервер применяет к вашей учётной записи. Они берутся из одного места в коде, а не переписываются в рекламу отдельно: обещать больше, чем даёт продукт, здесь технически негде.',
        en: 'Everything in the table below is the very number the server applies to your account. It comes from a single place in the code rather than being retyped for marketing: there is technically nowhere here to promise more than the product delivers.',
        de: 'Alles in der Tabelle unten ist genau die Zahl, die der Server auf Ihr Konto anwendet. Sie stammt aus einer einzigen Stelle im Code und wird nicht für die Werbung abgetippt: Hier ist technisch kein Ort, mehr zu versprechen als das Produkt liefert.',
        ar: 'كل ما في الجدول أدناه هو الرقم ذاته الذي يطبّقه الخادم على حسابك. يأتي من موضع واحد في الشيفرة ولا يُعاد كتابته للتسويق: لا مكان هنا تقنيًا للوعد بأكثر مما يقدّمه المنتج.',
        kk: 'Төмендегі кестедегінің бәрі — сервер тіркелгіңізге қолданатын дәл сол сандар. Олар кодтағы бір жерден алынады, жарнама үшін бөлек көшірілмейді: өнім беретіннен артығын уәде етуге мұнда техникалық орын жоқ.',
        uz: 'Quyidagi jadvaldagi hammasi — server hisobingizga qoʻllaydigan aynan oʻsha raqamlar. Ular koddagi bitta joydan olinadi, reklama uchun alohida koʻchirilmaydi: mahsulot beradiganidan koʻproq vaʼda qilishga bu yerda texnik joy yoʻq.',
      },
      cta: [
        {
          label: { ru: 'Начать бесплатно', en: 'Start free', de: 'Kostenlos starten', ar: 'ابدأ مجانًا', kk: 'Тегін бастау', uz: 'Bepul boshlash' },
          to: '/login',
          variant: 'primary',
        },
        {
          label: { ru: 'На чём основаны выводы', en: 'What the conclusions rest on', de: 'Worauf die Aussagen beruhen', ar: 'على ماذا تستند الاستنتاجات', kk: 'Тұжырымдар неге негізделген', uz: 'Xulosalar nimaga asoslanadi' },
          to: '/legal-base',
          variant: 'secondary',
        },
      ],
    },

    {
      kind: 'plans',
      title: {
        ru: 'Что входит в каждый тариф',
        en: 'What each plan includes',
        de: 'Was jeder Tarif enthält',
        ar: 'ما تتضمنه كل باقة',
        kk: 'Әр тарифке не кіреді',
        uz: 'Har bir tarifga nima kiradi',
      },
      intro: {
        ru: 'Обращение к ИИ — это один разбор договора, одно сравнение редакций или один вопрос в диалоге. Счётчик общий и обнуляется в начале месяца; удаление документов освободившихся обращений не возвращает.',
        en: 'An AI request is one contract review, one version comparison or one question in a conversation. The counter is shared and resets at the start of the month; deleting documents does not give requests back.',
        de: 'Eine KI-Anfrage ist eine Vertragsprüfung, ein Versionsvergleich oder eine Frage im Dialog. Der Zähler ist gemeinsam und startet zum Monatsbeginn neu; Löschen von Dokumenten gibt keine Anfragen zurück.',
        ar: 'طلب الذكاء الاصطناعي هو مراجعة عقد واحدة أو مقارنة نسختين أو سؤال واحد في المحادثة. العدّاد مشترك ويُصفَّر مع بداية الشهر؛ وحذف المستندات لا يعيد الطلبات.',
        kk: 'ИИ-ге бір өтініш — бір шарт талдауы, бір редакция салыстыруы немесе диалогтағы бір сұрақ. Есептегіш ортақ, ай басында нөлденеді; құжаттарды жою жұмсалған өтініштерді қайтармайды.',
        uz: 'AI ga bitta murojaat — bitta shartnoma tahlili, bitta tahrir solishtiruvi yoki suhbatdagi bitta savol. Hisoblagich umumiy, oy boshida nollanadi; hujjatlarni oʻchirish sarflangan murojaatlarni qaytarmaydi.',
      },
      columns: {
        plan: { ru: 'Тариф', en: 'Plan', de: 'Tarif', ar: 'الباقة', kk: 'Тариф', uz: 'Tarif' },
        price: { ru: 'Цена', en: 'Price', de: 'Preis', ar: 'السعر', kk: 'Бағасы', uz: 'Narxi' },
        ai: { ru: 'Обращений к ИИ', en: 'AI requests', de: 'KI-Anfragen', ar: 'طلبات الذكاء الاصطناعي', kk: 'ИИ өтініштері', uz: 'AI murojaatlari' },
        docs: { ru: 'Документов', en: 'Documents', de: 'Dokumente', ar: 'المستندات', kk: 'Құжаттар', uz: 'Hujjatlar' },
        storage: { ru: 'Хранилище', en: 'Storage', de: 'Speicher', ar: 'التخزين', kk: 'Сақтау', uz: 'Saqlash' },
        seats: { ru: 'Мест', en: 'Seats', de: 'Plätze', ar: 'المقاعد', kk: 'Орын', uz: 'Oʻrin' },
      },
      labels: {
        perMonth: { ru: '/мес', en: '/mo', de: '/Mon.', ar: '/شهر', kk: '/ай', uz: '/oy' },
        unlimited: { ru: 'без ограничения', en: 'no limit', de: 'ohne Limit', ar: 'بلا حد', kk: 'шектеусіз', uz: 'cheklovsiz' },
        custom: { ru: 'по договорённости', en: 'by arrangement', de: 'nach Absprache', ar: 'بالاتفاق', kk: 'келісім бойынша', uz: 'kelishuv boʻyicha' },
        yearlyNote: {
          ru: 'Цены указаны за месяц при помесячной оплате. При оплате за год — дешевле; итоговая сумма показывается при оформлении. Банковская карта для бесплатного тарифа не нужна.',
          en: 'Prices are per month with monthly billing. Annual billing is cheaper; the total is shown at checkout. No bank card is needed for the free plan.',
          de: 'Preise pro Monat bei monatlicher Zahlung. Jährliche Zahlung ist günstiger; die Gesamtsumme erscheint beim Bezahlen. Für den kostenlosen Tarif ist keine Bankkarte nötig.',
          ar: 'الأسعار شهرية عند الدفع الشهري. والدفع السنوي أرخص، ويظهر المجموع عند إتمام الطلب. ولا تلزم بطاقة بنكية للباقة المجانية.',
          kk: 'Бағалар ай сайынғы төлемде — айына. Жылдық төлемде арзанырақ; жалпы сома рәсімдеу кезінде көрсетіледі. Тегін тариф үшін банк картасы қажет емес.',
          uz: 'Narxlar oylik toʻlovda — bir oyga. Yillik toʻlovda arzonroq; umumiy summa rasmiylashtirishda koʻrsatiladi. Bepul tarif uchun bank kartasi kerak emas.',
        },
      },
      note: {
        ru: 'Данные таблицы берутся из того же места в коде, что и проверка лимитов на сервере, — расходиться им негде.',
        en: 'The table reads from the same place in the code as the server-side limit check — there is nowhere for the two to diverge.',
        de: 'Die Tabelle liest aus derselben Stelle im Code wie die serverseitige Limitprüfung — ein Auseinanderlaufen ist ausgeschlossen.',
        ar: 'يقرأ الجدول من الموضع نفسه في الشيفرة الذي يقرأ منه فحص الحدود على الخادم — فلا مجال للاختلاف.',
        kk: 'Кесте деректері сервердегі лимит тексерісімен бір жерден алынады — олардың айырылатын жері жоқ.',
        uz: 'Jadval maʼlumotlari serverdagi limit tekshiruvi bilan bitta joydan olinadi — ularning ayriladigan joyi yoʻq.',
      },
    },

    {
      kind: 'list',
      title: {
        ru: 'Что открывается на каждой ступени',
        en: 'What each step unlocks',
        de: 'Was jede Stufe freischaltet',
        ar: 'ما تفتحه كل درجة',
        kk: 'Әр саты нені ашады',
        uz: 'Har bir bosqich nimani ochadi',
      },
      intro: {
        ru: 'Разбор договора со ссылками на нормы, вопросы по документу и подключение облачных дисков работают на всех тарифах, включая бесплатный. Платные ступени добавляют работу с потоком документов и командой.',
        en: 'Contract review with statutory citations, document Q&A and cloud-drive connections work on every plan, including the free one. Paid steps add working with a flow of documents and with a team.',
        de: 'Vertragsprüfung mit Gesetzesverweisen, Fragen zum Dokument und Cloud-Anbindungen funktionieren in allen Tarifen, auch im kostenlosen. Die bezahlten Stufen ergänzen Arbeit mit Dokumentenstrom und Team.',
        ar: 'مراجعة العقد بإحالات قانونية، والأسئلة عن المستند، وربط التخزين السحابي تعمل في كل الباقات بما فيها المجانية. أما الدرجات المدفوعة فتضيف العمل مع تدفق المستندات ومع الفريق.',
        kk: 'Нормаларға сілтемелермен шарт талдауы, құжат бойынша сұрақтар және бұлттық дискілер барлық тарифте, тегінін қоса, жұмыс істейді. Ақылы сатылар құжат ағыны мен командамен жұмысты қосады.',
        uz: 'Normalarga havolalar bilan shartnoma tahlili, hujjat boʻyicha savollar va bulutli disklar barcha tariflarda, bepulini ham qoʻshib, ishlaydi. Pullik bosqichlar hujjatlar oqimi va jamoa bilan ishlashni qoʻshadi.',
      },
      items: [
        {
          title: { ru: 'Free', en: 'Free', de: 'Free', ar: 'Free', kk: 'Free', uz: 'Free' },
          body: {
            ru: 'Разбор договора по пунктам, вопросы по документу, проверяемые ссылки на нормы, облачные диски. Карта не нужна.',
            en: 'Clause-by-clause review, document Q&A, verifiable statutory citations, cloud drives. No card required.',
            de: 'Klauselweise Prüfung, Fragen zum Dokument, überprüfbare Gesetzesverweise, Cloud-Speicher. Keine Karte nötig.',
            ar: 'مراجعة بندًا بندًا، وأسئلة عن المستند، وإحالات قانونية قابلة للتحقق، وتخزين سحابي. بلا بطاقة.',
            kk: 'Тармақ бойынша талдау, құжат бойынша сұрақтар, тексерілетін сілтемелер, бұлттық дискілер. Карта қажет емес.',
            uz: 'Band boʻyicha tahlil, hujjat boʻyicha savollar, tekshiriladigan havolalar, bulutli disklar. Karta kerak emas.',
          },
        },
        {
          title: { ru: 'Standard', en: 'Standard', de: 'Standard', ar: 'Standard', kk: 'Standard', uz: 'Standard' },
          body: {
            ru: 'Добавляются выгрузка разбора в DOCX и библиотека шаблонов с черновиком по форме.',
            en: 'Adds DOCX export of the review and the template library with form-driven drafts.',
            de: 'Ergänzt den DOCX-Export der Prüfung und die Vorlagenbibliothek mit Entwurf per Formular.',
            ar: 'يضيف تصدير المراجعة إلى DOCX ومكتبة القوالب مع مسودة عبر نموذج.',
            kk: 'Талдауды DOCX-ке шығару және форма бойынша жобасы бар үлгілер кітапханасы қосылады.',
            uz: 'Tahlilni DOCX ga chiqarish va shakl boʻyicha loyihasi bor shablonlar kutubxonasi qoʻshiladi.',
          },
        },
        {
          title: { ru: 'Pro', en: 'Pro', de: 'Pro', ar: 'Pro', kk: 'Pro', uz: 'Pro' },
          body: {
            ru: 'Сравнение редакций, история версий, маршруты согласования со сроками, правила фирмы по пунктам, обязательства и сроки по договору, пакетная проверка, сценарии обработки.',
            en: 'Version comparison, version history, approval routes with deadlines, firm clause rules, contract obligations and deadlines, bulk review, processing scenarios.',
            de: 'Versionsvergleich, Versionshistorie, Freigabewege mit Fristen, Kanzlei-Klauselregeln, Pflichten und Fristen, Stapelprüfung, Ablaufszenarien.',
            ar: 'مقارنة النسخ، وسجل النسخ، ومسارات الموافقة بمواعيد، وقواعد البنود للمكتب، والالتزامات والمواعيد، والمراجعة الدفعية، وسيناريوهات المعالجة.',
            kk: 'Редакцияларды салыстыру, нұсқалар тарихы, мерзімі бар келісу маршруттары, фирманың тармақ ережелері, шарт бойынша міндеттемелер мен мерзімдер, топтама тексеру, өңдеу сценарийлері.',
            uz: 'Tahrirlarni solishtirish, versiyalar tarixi, muddatli kelishuv marshrutlari, firmaning band qoidalari, shartnoma majburiyatlari va muddatlari, paketli tekshiruv, ishlov stsenariylari.',
          },
        },
        {
          title: { ru: 'Business', en: 'Business', de: 'Business', ar: 'Business', kk: 'Business', uz: 'Business' },
          body: {
            ru: 'Команда с ролями, единый вход организации, журнал действий на 75 типов событий и программный доступ по ключу.',
            en: 'A team with roles, organisation single sign-on, an audit log of 75 event types and key-based programmatic access.',
            de: 'Team mit Rollen, Unternehmens-Single-Sign-on, Protokoll mit 75 Ereignistypen und schlüsselbasierter API-Zugriff.',
            ar: 'فريق بأدوار، ودخول موحّد للمؤسسة، وسجل أحداث من 75 نوعًا، ووصول برمجي بمفتاح.',
            kk: 'Рөлдері бар команда, ұйымның бірыңғай кіруі, 75 оқиға түрі бар журнал және кілт арқылы бағдарламалық қолжетімділік.',
            uz: 'Rolli jamoa, tashkilotning yagona kirishi, 75 xil hodisali jurnal va kalit orqali dasturiy kirish.',
          },
        },
        {
          title: { ru: 'Enterprise', en: 'Enterprise', de: 'Enterprise', ar: 'Enterprise', kk: 'Enterprise', uz: 'Enterprise' },
          body: {
            ru: 'Индивидуальные условия, число мест и объёмы — по договорённости. Оформляется не кнопкой, а разговором.',
            en: 'Custom terms, seat count and volumes — by arrangement. Set up through a conversation rather than a button.',
            de: 'Individuelle Konditionen, Platzanzahl und Volumina — nach Absprache. Nicht per Knopf, sondern im Gespräch.',
            ar: 'شروط مخصّصة وعدد مقاعد وأحجام — بالاتفاق. يُرتَّب بمحادثة لا بزر.',
            kk: 'Жеке шарттар, орын саны және көлемдер — келісім бойынша. Түймемен емес, әңгімемен рәсімделеді.',
            uz: 'Individual shartlar, oʻrinlar soni va hajmlar — kelishuv boʻyicha. Tugma bilan emas, suhbat bilan rasmiylashtiriladi.',
          },
        },
      ],
    },

    {
      kind: 'list',
      tone: 'limits',
      title: { ru: 'Что важно знать до оплаты', en: 'What to know before you pay', de: 'Was Sie vor dem Kauf wissen sollten', ar: 'ما ينبغي معرفته قبل الدفع', kk: 'Төлемес бұрын не білу маңызды', uz: 'Toʻlashdan oldin nimani bilish muhim' },
      items: [
        {
          title: { ru: 'Безлимита по ИИ нет ни на одном тарифе', en: 'No plan has unlimited AI', de: 'Kein Tarif hat unbegrenzte KI', ar: 'لا باقة بذكاء اصطناعي بلا حد', kk: 'Бірде-бір тарифте ИИ бойынша шексіздік жоқ', uz: 'Birorta tarifda AI boʻyicha cheksizlik yoʻq' },
          body: {
            ru: 'У каждого тарифа есть месячный потолок обращений, и он применяется на сервере. Это защита и от чужой ошибки, и от неожиданного счёта.',
            en: 'Every plan has a monthly request ceiling, enforced on the server. It protects both against someone’s mistake and against a surprise bill.',
            de: 'Jeder Tarif hat eine monatliche Obergrenze, die serverseitig durchgesetzt wird. Sie schützt vor fremden Fehlern und vor Überraschungsrechnungen.',
            ar: 'لكل باقة سقف شهري للطلبات يُطبَّق على الخادم. وهو يحمي من خطأ الآخرين ومن فاتورة مفاجئة.',
            kk: 'Әр тарифте айлық өтініш шегі бар және ол серверде қолданылады. Бұл бөгде қатеден де, күтпеген шоттан да қорғайды.',
            uz: 'Har bir tarifda oylik murojaat shifti bor va u serverda qoʻllanadi. Bu begona xatodan ham, kutilmagan hisobdan ham himoya qiladi.',
          },
        },
        {
          title: { ru: 'Счётчик не откатывается', en: 'The counter does not roll back', de: 'Der Zähler geht nicht zurück', ar: 'العدّاد لا يتراجع', kk: 'Есептегіш кері қайтпайды', uz: 'Hisoblagich orqaga qaytmaydi' },
          body: {
            ru: 'Удаление документа освобождает место в хранилище, но не возвращает израсходованные обращения и документы месяца.',
            en: 'Deleting a document frees storage but does not return the requests and documents already used this month.',
            de: 'Das Löschen eines Dokuments gibt Speicher frei, aber keine bereits verbrauchten Anfragen und Dokumente des Monats.',
            ar: 'حذف مستند يحرّر مساحة تخزين لكنه لا يعيد ما استُهلك هذا الشهر من طلبات ومستندات.',
            kk: 'Құжатты жою сақтау орнын босатады, бірақ айдың жұмсалған өтініштері мен құжаттарын қайтармайды.',
            uz: 'Hujjatni oʻchirish saqlash joyini boʻshatadi, ammo oyning sarflangan murojaat va hujjatlarini qaytarmaydi.',
          },
        },
        {
          title: { ru: 'Лимиты команды общие', en: 'Team limits are shared', de: 'Team-Limits sind gemeinsam', ar: 'حدود الفريق مشتركة', kk: 'Команда лимиттері ортақ', uz: 'Jamoa limitlari umumiy' },
          body: {
            ru: 'На Business месячные обращения и документы считаются на владельца команды, а не отдельно каждому участнику.',
            en: 'On Business, monthly requests and documents are counted against the team owner, not per member.',
            de: 'Bei Business zählen Anfragen und Dokumente auf die Team-Inhaberin, nicht je Mitglied.',
            ar: 'في Business تُحتسب الطلبات والمستندات على مالك الفريق لا على كل عضو.',
            kk: 'Business-те айлық өтініштер мен құжаттар команда иесіне есептеледі, әр қатысушыға бөлек емес.',
            uz: 'Business da oylik murojaat va hujjatlar jamoa egasiga hisoblanadi, har bir aʼzoga alohida emas.',
          },
        },
        {
          title: { ru: 'Пробного периода нет', en: 'There is no trial period', de: 'Es gibt keine Testphase', ar: 'لا توجد فترة تجريبية', kk: 'Сынақ мерзімі жоқ', uz: 'Sinov muddati yoʻq' },
          body: {
            ru: 'Роль пробника играет бесплатный тариф: он бессрочный и не требует карты. Платные тарифы включаются сразу после оплаты.',
            en: 'The free plan is the trial: it has no expiry and needs no card. Paid plans start right after payment.',
            de: 'Der kostenlose Tarif ist die Testphase: unbefristet und ohne Karte. Bezahlte Tarife starten direkt nach der Zahlung.',
            ar: 'الباقة المجانية هي التجربة: بلا انتهاء وبلا بطاقة. والباقات المدفوعة تبدأ فور الدفع.',
            kk: 'Сынақ рөлін тегін тариф атқарады: ол мерзімсіз және карта талап етпейді. Ақылы тарифтер төлемнен кейін бірден қосылады.',
            uz: 'Sinov rolini bepul tarif bajaradi: u muddatsiz va karta talab qilmaydi. Pullik tariflar toʻlovdan keyin darrov yoqiladi.',
          },
        },
      ],
    },

    {
      kind: 'faq',
      title: { ru: 'Частые вопросы', en: 'Frequently asked questions', de: 'Häufige Fragen', ar: 'أسئلة متكررة', kk: 'Жиі қойылатын сұрақтар', uz: 'Koʻp beriladigan savollar' },
      items: [
        {
          q: { ru: 'Что считается одним обращением к ИИ?', en: 'What counts as one AI request?', de: 'Was zählt als eine KI-Anfrage?', ar: 'ما الذي يُحتسب طلبًا واحدًا؟', kk: 'Бір ИИ өтініші деп не саналады?', uz: 'Bitta AI murojaati deb nima sanaladi?' },
          a: {
            ru: 'Один разбор договора, одно сравнение редакций, один черновик по шаблону или один вопрос в диалоге. Если модель не ответила, обращение возвращается в лимит — за сбой вы не платите.',
            en: 'One contract review, one version comparison, one template draft or one question in a conversation. If the model fails, the request is returned to your allowance — you do not pay for a failure.',
            de: 'Eine Vertragsprüfung, ein Versionsvergleich, ein Vorlagenentwurf oder eine Frage im Dialog. Antwortet das Modell nicht, wird die Anfrage gutgeschrieben — für einen Fehlschlag zahlen Sie nicht.',
            ar: 'مراجعة عقد واحدة، أو مقارنة نسختين، أو مسودة من قالب، أو سؤال في محادثة. وإن لم يستجب النموذج يُعاد الطلب إلى حصتك — فلا تدفع مقابل الإخفاق.',
            kk: 'Бір шарт талдауы, бір редакция салыстыруы, үлгі бойынша бір жоба немесе диалогтағы бір сұрақ. Модель жауап бермесе, өтініш лимитке қайтарылады — сәтсіздік үшін төлемейсіз.',
            uz: 'Bitta shartnoma tahlili, bitta tahrir solishtiruvi, shablon boʻyicha bitta loyiha yoki suhbatdagi bitta savol. Model javob bermasa, murojaat limitga qaytariladi — muvaffaqiyatsizlik uchun toʻlamaysiz.',
          },
        },
        {
          q: { ru: 'Что будет, когда лимит закончится?', en: 'What happens when the limit runs out?', de: 'Was passiert, wenn das Limit erschöpft ist?', ar: 'ماذا يحدث عند نفاد الحد؟', kk: 'Лимит бітсе не болады?', uz: 'Limit tugasa nima boʻladi?' },
          a: {
            ru: 'Сервер откажет в новом обращении и скажет, какой лимит исчерпан и когда он обновится. Списаний сверх тарифа не происходит: доплачивать «за превышение» нечем.',
            en: 'The server refuses the next request and tells you which limit is exhausted and when it resets. Nothing is charged beyond the plan: there is no overage billing.',
            de: 'Der Server lehnt die nächste Anfrage ab und nennt das erschöpfte Limit samt Zurücksetzung. Über den Tarif hinaus wird nichts berechnet: Es gibt keine Überschreitungsgebühr.',
            ar: 'يرفض الخادم الطلب التالي ويخبرك أي حد نفد ومتى يُجدَّد. ولا يُخصم شيء فوق الباقة: لا فوترة تجاوز.',
            kk: 'Сервер жаңа өтініштен бас тартады және қай лимит бітті, қашан жаңарады — соны айтады. Тарифтен тыс ешнәрсе алынбайды.',
            uz: 'Server yangi murojaatni rad etadi va qaysi limit tugagani hamda qachon yangilanishini aytadi. Tarifdan tashqari hech nima yechilmaydi.',
          },
        },
        {
          q: { ru: 'Можно ли перейти на другой тариф в середине месяца?', en: 'Can I change plan mid-month?', de: 'Kann ich mitten im Monat wechseln?', ar: 'هل يمكن تغيير الباقة في منتصف الشهر؟', kk: 'Ай ортасында тарифті ауыстыруға бола ма?', uz: 'Oy oʻrtasida tarifni almashtirish mumkinmi?' },
          a: {
            ru: 'Да, тариф меняется в кабинете. Лимиты нового тарифа применяются к текущему месяцу, а уже израсходованные обращения остаются израсходованными.',
            en: 'Yes, the plan is changed in your workspace. The new plan’s limits apply to the current month, while requests already used stay used.',
            de: 'Ja, der Tarif wird im Arbeitsbereich gewechselt. Die neuen Limits gelten für den laufenden Monat; bereits verbrauchte Anfragen bleiben verbraucht.',
            ar: 'نعم، تُغيَّر الباقة من داخل الحساب. وتنطبق حدود الباقة الجديدة على الشهر الحالي، أما الطلبات المستهلكة فتبقى مستهلكة.',
            kk: 'Иә, тариф кабинетте ауысады. Жаңа тарифтің лимиттері ағымдағы айға қолданылады, ал жұмсалған өтініштер жұмсалған күйі қалады.',
            uz: 'Ha, tarif kabinetda almashtiriladi. Yangi tarif limitlari joriy oyga qoʻllanadi, sarflangan murojaatlar esa sarflangan boʻlib qoladi.',
          },
        },
      ],
    },

    {
      kind: 'related',
      title: { ru: 'Дальше по теме', en: 'Related', de: 'Weiterlesen', ar: 'مواضيع ذات صلة', kk: 'Тақырып бойынша әрі қарай', uz: 'Mavzu boʻyicha davomi' },
      items: [
        {
          title: { ru: 'Анализ договора', en: 'Contract review', de: 'Vertragsprüfung', ar: 'مراجعة العقد', kk: 'Шартты талдау', uz: 'Shartnoma tahlili' },
          body: {
            ru: 'Что именно делает продукт за одно обращение к ИИ.',
            en: 'What the product actually does for one AI request.',
            de: 'Was das Produkt für eine KI-Anfrage tatsächlich leistet.',
            ar: 'ما الذي يفعله المنتج فعليًا مقابل طلب واحد.',
            kk: 'Өнім бір ИИ өтінішіне нақты не істейді.',
            uz: 'Mahsulot bitta AI murojaatiga aniq nima qiladi.',
          },
          to: '/contract-analysis',
        },
        {
          title: { ru: 'Доступы в команде', en: 'Team access', de: 'Teamzugriff', ar: 'صلاحيات الفريق', kk: 'Командадағы рұқсаттар', uz: 'Jamoadagi ruxsatlar' },
          body: {
            ru: 'Как считаются места и что видит каждая роль.',
            en: 'How seats are counted and what each role sees.',
            de: 'Wie Plätze gezählt werden und was jede Rolle sieht.',
            ar: 'كيف تُحتسب المقاعد وماذا يرى كل دور.',
            kk: 'Орындар қалай саналады және әр рөл нені көреді.',
            uz: 'Oʻrinlar qanday sanaladi va har bir rol nimani koʻradi.',
          },
          to: '/team-access',
        },
        {
          title: { ru: 'Безопасность', en: 'Security', de: 'Sicherheit', ar: 'الأمان', kk: 'Қауіпсіздік', uz: 'Xavfsizlik' },
          body: {
            ru: 'Что происходит с документами независимо от тарифа.',
            en: 'What happens to documents regardless of plan.',
            de: 'Was mit Dokumenten unabhängig vom Tarif geschieht.',
            ar: 'ماذا يحدث للمستندات بغض النظر عن الباقة.',
            kk: 'Тарифке қарамастан құжаттармен не болады.',
            uz: 'Tarifdan qatʼi nazar hujjatlar bilan nima boʻladi.',
          },
          to: '/security',
        },
      ],
    },

    {
      kind: 'cta',
      title: { ru: 'Начните с бесплатного тарифа', en: 'Start on the free plan', de: 'Mit dem kostenlosen Tarif beginnen', ar: 'ابدأ بالباقة المجانية', kk: 'Тегін тарифтен бастаңыз', uz: 'Bepul tarifdan boshlang' },
      body: {
        ru: 'Он бессрочный и не требует карты — этого достаточно, чтобы проверить продукт на своём договоре и решить самому.',
        en: 'It never expires and needs no card — enough to test the product on your own contract and judge for yourself.',
        de: 'Er ist unbefristet und braucht keine Karte — genug, um das Produkt am eigenen Vertrag zu prüfen und selbst zu urteilen.',
        ar: 'لا تنتهي ولا تتطلب بطاقة — ويكفي ذلك لاختبار المنتج على عقدك والحكم بنفسك.',
        kk: 'Ол мерзімсіз және карта талап етпейді — өнімді өз шартыңызда тексеріп, өзіңіз шешуге жеткілікті.',
        uz: 'U muddatsiz va karta talab qilmaydi — mahsulotni oʻz shartnomangizda sinab, oʻzingiz xulosa qilishga yetadi.',
      },
      cta: [
        {
          label: { ru: 'Начать бесплатно', en: 'Start free', de: 'Kostenlos starten', ar: 'ابدأ مجانًا', kk: 'Тегін бастау', uz: 'Bepul boshlash' },
          to: '/login',
          variant: 'primary',
        },
      ],
    },
  ],
};
