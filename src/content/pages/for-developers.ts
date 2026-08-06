/**
 * Публичная страница «Разработчикам».
 *
 * Проверено по коду 05.08.2026 (server/src/routes/public-api.routes.ts):
 *  - 15 эндпоинтов в /api/v1 (посчитано по обработчикам);
 *  - GET /api/v1/openapi.json отдаётся БЕЗ ключа (нет preHandler авторизации) —
 *    это и есть «спецификация до регистрации»;
 *  - 6 скоупов: analyses:read, analyses:write, drafts:write, compares:write,
 *    templates:write, webhooks:manage (API_SCOPES в lib/apiKeys.ts);
 *  - гейт 'apiAccess' → Business, Enterprise.
 * Адрес API на сайте НЕ ПИШЕМ: он задаётся при развёртывании (VITE_API_BASE_URL)
 * и попал бы на страницу как выдумка. Точный адрес — в кабинете, вкладка API.
 */
import type { PageContent } from '../types';

export const forDevelopers: PageContent = {
  slug: 'for-developers',
  pageTitle: {
    ru: 'Разработчикам: API Lexab — Lexab',
    en: 'Developers: the Lexab API — Lexab',
    de: 'Entwickler: die Lexab-API — Lexab',
    ar: 'للمطورين: واجهة Lexab البرمجية — Lexab',
    kk: 'Әзірлеушілерге: Lexab API — Lexab',
    uz: 'Dasturchilarga: Lexab API — Lexab',
  },
  blocks: [
    {
      kind: 'hero',
      title: {
        ru: 'Разбор договоров из вашей системы',
        en: 'Contract review from your own system',
        de: 'Vertragsprüfung aus Ihrem System',
        ar: 'مراجعة العقود من نظامك',
        kk: 'Шарттарды өз жүйеңізден талдау',
        uz: 'Shartnomalarni oʻz tizimingizdan tahlil qilish',
      },
      lead: {
        ru: 'Пятнадцать эндпоинтов: отправить договор на разбор, забрать результат, собрать черновик, сравнить редакции, сгенерировать документ по шаблону, подписаться на события. Спецификация OpenAPI открыта без ключа — можно посмотреть контракт до того, как заводить учётную запись.',
        en: 'Fifteen endpoints: send a contract for review, fetch the result, build a draft, compare versions, generate a document from a template, subscribe to events. The OpenAPI specification is public without a key — you can read the contract before creating an account.',
        de: 'Fünfzehn Endpunkte: Vertrag zur Prüfung senden, Ergebnis abholen, Entwurf erzeugen, Fassungen vergleichen, Dokument aus Vorlage erstellen, Ereignisse abonnieren. Die OpenAPI-Spezifikation ist ohne Schlüssel öffentlich — Sie können den Vertrag lesen, bevor Sie ein Konto anlegen.',
        ar: 'خمسة عشر مسارًا: إرسال عقد للمراجعة، وجلب النتيجة، وبناء مسودة، ومقارنة نسخ، وتوليد مستند من قالب، والاشتراك في الأحداث. ومواصفة OpenAPI متاحة بلا مفتاح — يمكنك قراءة العقد قبل إنشاء حساب.',
        kk: 'Он бес эндпоинт: шартты талдауға жіберу, нәтижені алу, жоба құрастыру, редакцияларды салыстыру, үлгі бойынша құжат жасау, оқиғаларға жазылу. OpenAPI сипаттамасы кілтсіз ашық — тіркелгі ашпай тұрып қарауға болады.',
        uz: 'Oʻn beshta endpoint: shartnomani tahlilga yuborish, natijani olish, loyiha tuzish, tahrirlarni solishtirish, shablon boʻyicha hujjat yaratish, hodisalarga obuna boʻlish. OpenAPI spetsifikatsiyasi kalitsiz ochiq — hisob ochmasdan oldin koʻrish mumkin.',
      },
      planNote: {
        ru: 'Программный доступ входит в тариф Business (и Enterprise).',
        en: 'Programmatic access is part of the Business plan (and Enterprise).',
        de: 'Programmatischer Zugriff gehört zum Business-Tarif (und Enterprise).',
        ar: 'الوصول البرمجي ضمن باقة Business (وEnterprise).',
        kk: 'Бағдарламалық қолжетімділік Business тарифіне кіреді (және Enterprise).',
        uz: 'Dasturiy kirish Business tarifiga kiradi (va Enterprise).',
      },
      cta: [
        {
          label: { ru: 'Получить ключ', en: 'Get a key', de: 'Schlüssel holen', ar: 'احصل على مفتاح', kk: 'Кілт алу', uz: 'Kalit olish' },
          to: '/login',
          variant: 'primary',
        },
        {
          label: { ru: 'Интеграции', en: 'Integrations', de: 'Integrationen', ar: 'التكاملات', kk: 'Интеграциялар', uz: 'Integratsiyalar' },
          to: '/integrations',
          variant: 'secondary',
        },
      ],
    },

    {
      kind: 'facts',
      items: [
        {
          value: { ru: '15', en: '15', de: '15', ar: '15', kk: '15', uz: '15' },
          label: { ru: 'эндпоинтов в версии v1', en: 'endpoints in v1', de: 'Endpunkte in v1', ar: 'مسارًا في الإصدار v1', kk: 'v1-дегі эндпоинт', uz: 'v1 dagi endpoint' },
          proof: {
            ru: 'Анализы, черновики, сравнения, шаблоны, расход лимитов и вебхуки.',
            en: 'Analyses, drafts, comparisons, templates, usage and webhooks.',
            de: 'Analysen, Entwürfe, Vergleiche, Vorlagen, Verbrauch und Webhooks.',
            ar: 'التحليلات والمسودات والمقارنات والقوالب والاستهلاك وخطافات الويب.',
            kk: 'Талдаулар, жобалар, салыстырулар, үлгілер, лимит шығыны және вебхуктар.',
            uz: 'Tahlillar, loyihalar, solishtirishlar, shablonlar, limit sarfi va vebxuklar.',
          },
        },
        {
          value: { ru: '6', en: '6', de: '6', ar: '6', kk: '6', uz: '6' },
          label: { ru: 'прав у ключа', en: 'scopes per key', de: 'Rechte je Schlüssel', ar: 'صلاحيات للمفتاح', kk: 'кілттің құқығы', uz: 'kalit huquqi' },
          proof: {
            ru: 'Ключ можно ограничить только чтением анализов — тогда он физически не сможет ни создать документ, ни тронуть вебхуки.',
            en: 'A key can be limited to reading analyses — then it physically cannot create a document or touch webhooks.',
            de: 'Ein Schlüssel lässt sich auf das Lesen von Analysen begrenzen — dann kann er weder Dokumente anlegen noch Webhooks ändern.',
            ar: 'يمكن قصر المفتاح على قراءة التحليلات — فلا يستطيع عندها إنشاء مستند ولا المساس بخطافات الويب.',
            kk: 'Кілтті тек талдауларды оқумен шектеуге болады — сонда ол құжат та жасай алмайды, вебхукқа да тие алмайды.',
            uz: 'Kalitni faqat tahlillarni oʻqish bilan cheklash mumkin — shunda u hujjat ham yarata olmaydi, vebxukka ham tegmaydi.',
          },
        },
        {
          value: { ru: '0', en: '0', de: '0', ar: '0', kk: '0', uz: '0' },
          label: { ru: 'ключей нужно, чтобы прочитать спецификацию', en: 'keys needed to read the spec', de: 'Schlüssel nötig, um die Spezifikation zu lesen', ar: 'مفاتيح لقراءة المواصفة', kk: 'сипаттаманы оқуға қажет кілт', uz: 'spetsifikatsiyani oʻqishga kerak kalit' },
          proof: {
            ru: 'OpenAPI 3.1 отдаётся публично: интеграцию можно оценить до регистрации и до оплаты.',
            en: 'The OpenAPI 3.1 document is served publicly: you can size up the integration before signing up and before paying.',
            de: 'Das OpenAPI-3.1-Dokument ist öffentlich: Sie können den Aufwand vor Registrierung und Zahlung einschätzen.',
            ar: 'مستند OpenAPI 3.1 متاح للعموم: يمكنك تقدير التكامل قبل التسجيل وقبل الدفع.',
            kk: 'OpenAPI 3.1 құжаты ашық беріледі: интеграцияны тіркелмей және төлемей бағалауға болады.',
            uz: 'OpenAPI 3.1 hujjati ochiq beriladi: integratsiyani roʻyxatdan oʻtmasdan va toʻlamasdan baholash mumkin.',
          },
        },
      ],
    },

    {
      kind: 'list',
      title: { ru: 'Что сделано ради надёжности', en: 'What is in place for reliability', de: 'Was für Verlässlichkeit sorgt', ar: 'ما هو مُعدّ من أجل الموثوقية', kk: 'Сенімділік үшін не істелген', uz: 'Ishonchlilik uchun nima qilingan' },
      items: [
        {
          title: { ru: 'Повторный запрос не создаст дубль', en: 'A retry will not create a duplicate', de: 'Ein Wiederholungsversuch erzeugt kein Duplikat', ar: 'إعادة الطلب لا تُنشئ نسخة مكررة', kk: 'Қайталанған сұрау қосарлама жасамайды', uz: 'Takroriy soʻrov dublikat yaratmaydi' },
          body: {
            ru: 'Запрос с ключом идемпотентности возвращает прежний результат вместо второго списания лимита. Сеть рвётся у всех — платить за это дважды не должен никто.',
            en: 'A request carrying an idempotency key returns the original result instead of charging your allowance twice. Networks fail for everyone — nobody should pay twice for that.',
            de: 'Eine Anfrage mit Idempotenz-Schlüssel liefert das ursprüngliche Ergebnis, statt das Kontingent erneut zu belasten. Netze brechen überall ab — dafür soll niemand doppelt zahlen.',
            ar: 'الطلب الحامل لمفتاح إتقان يعيد النتيجة الأصلية بدل خصم الحصة مرتين. الشبكات تنقطع للجميع — ولا ينبغي أن يدفع أحد مرتين.',
            kk: 'Идемпотенттік кілті бар сұрау лимитті екінші рет шығындаудың орнына бұрынғы нәтижені қайтарады. Желі бәрінде үзіледі — ол үшін екі рет төлеудің қажеті жоқ.',
            uz: 'Idempotentlik kaliti bor soʻrov limitni ikkinchi marta sarflash oʻrniga oldingi natijani qaytaradi. Tarmoq hammada uziladi — buning uchun ikki marta toʻlash kerak emas.',
          },
        },
        {
          title: { ru: 'События приходят подписанными', en: 'Events arrive signed', de: 'Ereignisse kommen signiert an', ar: 'تصل الأحداث موقَّعة', kk: 'Оқиғалар қолтаңбамен келеді', uz: 'Hodisalar imzolangan holda keladi' },
          body: {
            ru: 'У вебхука есть подпись, которую ваш обработчик проверяет: подделать уведомление «разбор готов» со стороны нельзя.',
            en: 'A webhook carries a signature your handler verifies: a “review is ready” notification cannot be forged from outside.',
            de: 'Ein Webhook trägt eine Signatur, die Ihr Handler prüft: Eine „Prüfung fertig“-Meldung lässt sich von außen nicht fälschen.',
            ar: 'يحمل خطاف الويب توقيعًا يتحقق منه معالجك: لا يمكن تزوير إشعار «المراجعة جاهزة» من الخارج.',
            kk: 'Вебхукта қолтаңба бар, оны сіздің өңдеушіңіз тексереді: «талдау дайын» хабарламасын сырттан жасау мүмкін емес.',
            uz: 'Vebxukda imzo bor, uni ishlovchingiz tekshiradi: «tahlil tayyor» xabarini tashqaridan soxtalashtirib boʻlmaydi.',
          },
        },
        {
          title: { ru: 'Адрес вебхука проверяется', en: 'The webhook address is validated', de: 'Die Webhook-Adresse wird geprüft', ar: 'يُفحص عنوان خطاف الويب', kk: 'Вебхук мекенжайы тексеріледі', uz: 'Vebxuk manzili tekshiriladi' },
          body: {
            ru: 'Внутренние и служебные адреса не принимаются: подписка не может стать способом заглянуть во внутреннюю сеть.',
            en: 'Internal and infrastructure addresses are rejected: a subscription cannot become a way to peek into a private network.',
            de: 'Interne und Infrastrukturadressen werden abgelehnt: Ein Abo kann kein Weg in ein privates Netz werden.',
            ar: 'تُرفض العناوين الداخلية والبنيوية: فلا يصبح الاشتراك وسيلة للاطلاع على شبكة داخلية.',
            kk: 'Ішкі және қызметтік мекенжайлар қабылданбайды: жазылым ішкі желіге көз салудың тәсілі бола алмайды.',
            uz: 'Ichki va xizmat manzillari qabul qilinmaydi: obuna ichki tarmoqqa koʻz tashlash usuli boʻla olmaydi.',
          },
        },
        {
          title: { ru: 'Ключи стареют и меняются', en: 'Keys expire and rotate', de: 'Schlüssel laufen ab und rotieren', ar: 'المفاتيح تنتهي وتُدوَّر', kk: 'Кілттердің мерзімі бітеді және ауысады', uz: 'Kalitlar eskiradi va almashadi' },
          body: {
            ru: 'Ключу можно задать срок жизни и заменить его без простоя интеграции.',
            en: 'A key can be given a lifetime and replaced without integration downtime.',
            de: 'Einem Schlüssel lässt sich eine Laufzeit geben; der Austausch erfolgt ohne Ausfall der Integration.',
            ar: 'يمكن منح المفتاح مدة صلاحية واستبداله دون توقف التكامل.',
            kk: 'Кілтке қолданылу мерзімін беруге және интеграция тоқтамай ауыстыруға болады.',
            uz: 'Kalitga amal muddati berish va integratsiya toʻxtamasdan almashtirish mumkin.',
          },
        },
      ],
    },

    {
      kind: 'list',
      tone: 'limits',
      title: { ru: 'Границы', en: 'Limits', de: 'Grenzen', ar: 'الحدود', kk: 'Шекаралар', uz: 'Chegaralar' },
      items: [
        {
          title: { ru: 'Лимиты те же, что в интерфейсе', en: 'The limits are the same as in the app', de: 'Es gelten dieselben Limits wie in der Oberfläche', ar: 'الحدود نفسها كما في الواجهة', kk: 'Лимиттер интерфейстегідей', uz: 'Limitlar interfeysdagidek' },
          body: {
            ru: 'Ключ не даёт отдельной квоты: запросы через API расходуют тот же месячный лимит тарифа.',
            en: 'A key grants no separate quota: API calls consume the same monthly plan allowance.',
            de: 'Ein Schlüssel bringt kein eigenes Kontingent: API-Aufrufe verbrauchen dasselbe Monatslimit.',
            ar: 'المفتاح لا يمنح حصة منفصلة: نداءات الواجهة تستهلك الحصة الشهرية نفسها.',
            kk: 'Кілт бөлек квота бермейді: API арқылы сұраулар сол айлық лимитті жұмсайды.',
            uz: 'Kalit alohida kvota bermaydi: API orqali soʻrovlar oʻsha oylik limitni sarflaydi.',
          },
        },
        {
          title: { ru: 'Адрес API зависит от развёртывания', en: 'The API address depends on the deployment', de: 'Die API-Adresse hängt vom Deployment ab', ar: 'عنوان الواجهة يعتمد على النشر', kk: 'API мекенжайы орналастыруға байланысты', uz: 'API manzili joylashtirishga bogʻliq' },
          body: {
            ru: 'Точный адрес и ключи выдаются в кабинете, на вкладке API. Мы не печатаем его здесь, чтобы не разослать устаревший.',
            en: 'The exact address and keys are issued in the workspace, on the API tab. We do not print it here so as not to publish a stale one.',
            de: 'Die genaue Adresse und die Schlüssel erhalten Sie im Arbeitsbereich, Reiter API. Wir drucken sie hier nicht ab, um nichts Veraltetes zu verbreiten.',
            ar: 'العنوان الدقيق والمفاتيح تُصدر داخل الحساب في تبويب API. لا نطبعه هنا كي لا ننشر عنوانًا قديمًا.',
            kk: 'Нақты мекенжай мен кілттер кабинетте, API қойындысында беріледі. Ескісін таратпау үшін оны мұнда жазбаймыз.',
            uz: 'Aniq manzil va kalitlar kabinetda, API varagʻida beriladi. Eskisini tarqatmaslik uchun uni bu yerda yozmaymiz.',
          },
        },
      ],
    },

    {
      kind: 'faq',
      title: { ru: 'Частые вопросы', en: 'Frequently asked questions', de: 'Häufige Fragen', ar: 'أسئلة متكررة', kk: 'Жиі қойылатын сұрақтар', uz: 'Koʻp beriladigan savollar' },
      items: [
        {
          q: { ru: 'Можно ли изучить API до покупки?', en: 'Can I study the API before buying?', de: 'Kann ich die API vor dem Kauf prüfen?', ar: 'هل أستطيع دراسة الواجهة قبل الشراء؟', kk: 'API-ды сатып алмай зерттеуге бола ма?', uz: 'API ni sotib olmasdan oʻrganish mumkinmi?' },
          a: {
            ru: 'Да. Спецификация OpenAPI отдаётся без ключа — по ней видно все пути, поля и коды ответов. Это осознанное решение: интеграцию оценивают до денег, а не после.',
            en: 'Yes. The OpenAPI document is served without a key — it shows every path, field and response code. That is deliberate: an integration is assessed before money changes hands, not after.',
            de: 'Ja. Das OpenAPI-Dokument wird ohne Schlüssel ausgeliefert — mit allen Pfaden, Feldern und Statuscodes. Das ist Absicht: Eine Integration bewertet man vor der Zahlung, nicht danach.',
            ar: 'نعم. يُقدَّم مستند OpenAPI بلا مفتاح — ويُظهر كل المسارات والحقول ورموز الاستجابة. وهذا مقصود: يُقيَّم التكامل قبل الدفع لا بعده.',
            kk: 'Иә. OpenAPI сипаттамасы кілтсіз беріледі — онда барлық жолдар, өрістер және жауап кодтары көрінеді. Бұл — саналы шешім.',
            uz: 'Ha. OpenAPI hujjati kalitsiz beriladi — unda barcha yoʻllar, maydonlar va javob kodlari koʻrinadi. Bu — ongli qaror.',
          },
        },
        {
          q: { ru: 'Что приходит в вебхуке?', en: 'What arrives in a webhook?', de: 'Was kommt in einem Webhook an?', ar: 'ماذا يصل في خطاف الويب؟', kk: 'Вебхукта не келеді?', uz: 'Vebxukda nima keladi?' },
          a: {
            ru: 'Событие о готовности работы и ссылка на результат — сам текст договора наружу не отправляется. Подпись позволяет вашему обработчику убедиться, что уведомление действительно наше.',
            en: 'An event that the work is ready plus a link to the result — the contract text itself is not pushed out. The signature lets your handler confirm the notification is genuinely ours.',
            de: 'Ein Ereignis über die Fertigstellung und ein Link zum Ergebnis — der Vertragstext selbst wird nicht hinausgeschickt. Die Signatur bestätigt Ihrem Handler die Echtheit.',
            ar: 'حدث بجاهزية العمل ورابط إلى النتيجة — أما نص العقد فلا يُرسَل للخارج. والتوقيع يتيح لمعالجك التأكد من أن الإشعار منّا فعلًا.',
            kk: 'Жұмыстың дайын екені туралы оқиға және нәтижеге сілтеме — шарт мәтінінің өзі сыртқа жіберілмейді. Қолтаңба хабарламаның шынымен бізден екенін растайды.',
            uz: 'Ish tayyorligi haqidagi hodisa va natijaga havola — shartnoma matnining oʻzi tashqariga yuborilmaydi. Imzo xabar haqiqatan bizdan ekanini tasdiqlaydi.',
          },
        },
      ],
    },

    {
      kind: 'related',
      title: { ru: 'Дальше по теме', en: 'Related', de: 'Weiterlesen', ar: 'مواضيع ذات صلة', kk: 'Тақырып бойынша әрі қарай', uz: 'Mavzu boʻyicha davomi' },
      items: [
        {
          title: { ru: 'Доступы в команде', en: 'Team access', de: 'Teamzugriff', ar: 'صلاحيات الفريق', kk: 'Командадағы рұқсаттар', uz: 'Jamoadagi ruxsatlar' },
          body: {
            ru: 'Тариф Business, в который входит программный доступ.',
            en: 'The Business plan, which includes programmatic access.',
            de: 'Der Business-Tarif, der den programmatischen Zugriff enthält.',
            ar: 'باقة Business التي تشمل الوصول البرمجي.',
            kk: 'Бағдарламалық қолжетімділік кіретін Business тарифі.',
            uz: 'Dasturiy kirish kiradigan Business tarifi.',
          },
          to: '/team-access',
        },
        {
          title: { ru: 'Безопасность', en: 'Security', de: 'Sicherheit', ar: 'الأمان', kk: 'Қауіпсіздік', uz: 'Xavfsizlik' },
          body: {
            ru: 'Что происходит с данными, которые вы отправляете через API.',
            en: 'What happens to the data you send through the API.',
            de: 'Was mit den über die API gesendeten Daten geschieht.',
            ar: 'ماذا يحدث للبيانات التي ترسلها عبر الواجهة.',
            kk: 'API арқылы жіберген деректеріңізбен не болады.',
            uz: 'API orqali yuborgan maʼlumotlaringiz bilan nima boʻladi.',
          },
          to: '/security',
        },
        {
          title: { ru: 'Пакетная проверка', en: 'Bulk review', de: 'Stapelprüfung', ar: 'مراجعة دفعية', kk: 'Топтама тексеру', uz: 'Paketli tekshiruv' },
          body: {
            ru: 'Массовый разбор руками — если автоматизация пока не нужна.',
            en: 'Manual bulk review — if automation is not needed yet.',
            de: 'Stapelprüfung von Hand — falls Automatisierung noch nicht nötig ist.',
            ar: 'مراجعة دفعية يدويًا — إن لم تكن الأتمتة لازمة بعد.',
            kk: 'Қолмен жаппай талдау — автоматтандыру әзірше қажет болмаса.',
            uz: 'Qoʻlda ommaviy tahlil — avtomatlashtirish hozircha kerak boʻlmasa.',
          },
          to: '/bulk-review',
        },
      ],
    },

    {
      kind: 'cta',
      title: { ru: 'Посмотрите спецификацию до регистрации', en: 'Read the spec before signing up', de: 'Lesen Sie die Spezifikation vor der Registrierung', ar: 'اطّلع على المواصفة قبل التسجيل', kk: 'Тіркелмей тұрып сипаттаманы қараңыз', uz: 'Roʻyxatdan oʻtmasdan spetsifikatsiyani koʻring' },
      body: {
        ru: 'Адрес спецификации и ключи выдаются в кабинете, на вкладке API.',
        en: 'The spec URL and the keys are issued in the workspace, on the API tab.',
        de: 'Die Spezifikations-URL und die Schlüssel gibt es im Arbeitsbereich, Reiter API.',
        ar: 'رابط المواصفة والمفاتيح تُصدر داخل الحساب في تبويب API.',
        kk: 'Сипаттама мекенжайы мен кілттер кабинетте, API қойындысында беріледі.',
        uz: 'Spetsifikatsiya manzili va kalitlar kabinetda, API varagʻida beriladi.',
      },
      cta: [
        {
          label: { ru: 'Открыть Lexab', en: 'Open Lexab', de: 'Lexab öffnen', ar: 'افتح Lexab', kk: 'Lexab-ты ашу', uz: 'Lexab ni ochish' },
          to: '/login',
          variant: 'primary',
        },
      ],
    },
  ],
};
