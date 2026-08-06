/**
 * Публичная страница «Безопасность».
 *
 * Проверено по коду и по схеме боевой базы 05.08.2026:
 *  - конвертное шифрование: у каждого пользователя свой ключ данных (таблица
 *    data_keys), сам он лежит под мастер-ключом сервера; алгоритм AES-256-GCM;
 *  - ЗАШИФРОВАНЫ: извлечённый текст документа, резюме анализа, блоки разбора,
 *    тексты правок (del_text/ins_text), сохранённые шаблоны, правила плейбука;
 *  - ОТКРЫТЫ (намеренно, иначе не работают списки, поиск и сортировка):
 *    имя документа, контрагент, статус, юрисдикция, уровень риска, размер,
 *    а также заголовок и цитата находки (таблица findings);
 *  - 2FA по одноразовым кодам + резервные коды (user_totp);
 *  - журнал действий: 75 типов событий, срок хранения 365 дней
 *    (AUDIT_RETENTION_DAYS в audit.routes.ts);
 *  - выгрузка всех своих данных одним файлом: GET /me/export;
 *  - RLS включён на всех таблицах (миграция 053), тест server/test/rls.test.ts.
 * ПРО SOC 2 / ISO НЕ ПИШЕМ НИ СЛОВА — сертификаций нет.
 * ПРО АНТИВИРУС НЕ ПИШЕМ: он включается переменной CLAMD_HOST, в текущем
 * развёртывании она не задана. Всегда работает сверка содержимого файла с
 * расширением (assertValidFileContent) — про неё и говорим.
 */
import type { PageContent } from '../types';

export const security: PageContent = {
  slug: 'security',
  pageTitle: {
    ru: 'Безопасность — Lexab',
    en: 'Security — Lexab',
    de: 'Sicherheit — Lexab',
    ar: 'الأمان — Lexab',
    kk: 'Қауіпсіздік — Lexab',
    uz: 'Xavfsizlik — Lexab',
  },
  blocks: [
    {
      kind: 'hero',
      title: {
        ru: 'Что зашифровано, что открыто и почему',
        en: 'What is encrypted, what is not, and why',
        de: 'Was verschlüsselt ist, was offen bleibt und warum',
        ar: 'ما المشفَّر وما غير المشفَّر ولماذا',
        kk: 'Не шифрланған, не ашық және неге',
        uz: 'Nima shifrlangan, nima ochiq va nega',
      },
      lead: {
        ru: 'Договоры клиентов — не обычные файлы: это адвокатская тайна и коммерческие условия. Поэтому вместо общих слов «всё защищено» ниже точный список: что именно лежит зашифрованным, что остаётся открытым ради работы поиска и списков, и что происходит при удалении.',
        en: 'Client contracts are not ordinary files: they are privileged and commercially sensitive. So instead of the vague “everything is protected”, here is the exact list: what exactly is stored encrypted, what stays readable so that lists and search work at all, and what happens on deletion.',
        de: 'Mandantenverträge sind keine gewöhnlichen Dateien: Sie unterliegen dem Berufsgeheimnis und enthalten Geschäftskonditionen. Statt des vagen „alles ist geschützt“ steht hier die genaue Liste: was verschlüsselt liegt, was lesbar bleibt, damit Listen und Suche funktionieren, und was beim Löschen passiert.',
        ar: 'عقود العملاء ليست ملفات عادية: فيها سر المهنة وشروط تجارية. لذلك بدل عبارة «كل شيء محمي» الغامضة، إليك القائمة الدقيقة: ما المخزَّن مشفَّرًا، وما يبقى مقروءًا كي تعمل القوائم والبحث، وماذا يحدث عند الحذف.',
        kk: 'Клиент шарттары — кәдімгі файл емес: бұл адвокаттық құпия және коммерциялық шарттар. Сондықтан «бәрі қорғалған» деген жалпы сөздің орнына нақты тізім: не шифрланып жатады, тізімдер мен іздеу жұмыс істеуі үшін не ашық қалады және жойғанда не болады.',
        uz: 'Mijoz shartnomalari — oddiy fayl emas: bu advokatlik siri va tijorat shartlari. Shuning uchun «hammasi himoyalangan» degan umumiy soʻz oʻrniga aniq roʻyxat: nima shifrlanib yotadi, roʻyxatlar va qidiruv ishlashi uchun nima ochiq qoladi va oʻchirilganda nima boʻladi.',
      },
      cta: [
        {
          label: { ru: 'Начать бесплатно', en: 'Start free', de: 'Kostenlos starten', ar: 'ابدأ مجانًا', kk: 'Тегін бастау', uz: 'Bepul boshlash' },
          to: '/login',
          variant: 'primary',
        },
        {
          label: { ru: 'Доступы в команде', en: 'Team access', de: 'Teamzugriff', ar: 'صلاحيات الفريق', kk: 'Командадағы рұқсаттар', uz: 'Jamoadagi ruxsatlar' },
          to: '/team-access',
          variant: 'secondary',
        },
      ],
    },

    {
      kind: 'facts',
      items: [
        {
          value: { ru: 'AES-256-GCM', en: 'AES-256-GCM', de: 'AES-256-GCM', ar: 'AES-256-GCM', kk: 'AES-256-GCM', uz: 'AES-256-GCM' },
          label: { ru: 'шифрование текста документов', en: 'encryption of document text', de: 'Verschlüsselung des Dokumenttexts', ar: 'تشفير نص المستندات', kk: 'құжат мәтінін шифрлау', uz: 'hujjat matnini shifrlash' },
          proof: {
            ru: 'У каждой учётной записи свой ключ данных; сам ключ хранится под мастер-ключом сервера — это называется конвертным шифрованием.',
            en: 'Every account has its own data key; that key is itself stored under the server’s master key — this is envelope encryption.',
            de: 'Jedes Konto hat einen eigenen Datenschlüssel; dieser liegt selbst unter dem Master-Schlüssel des Servers — das nennt man Envelope-Verschlüsselung.',
            ar: 'لكل حساب مفتاح بيانات خاص؛ وهذا المفتاح نفسه مخزَّن تحت المفتاح الرئيسي للخادم — وهذا ما يُسمى التشفير المغلَّف.',
            kk: 'Әр тіркелгінің өз деректер кілті бар; кілттің өзі сервердің мастер-кілтімен сақталады — бұл конверттік шифрлау деп аталады.',
            uz: 'Har bir hisobning oʻz maʼlumot kaliti bor; kalitning oʻzi server master-kaliti ostida saqlanadi — bu konvert shifrlash deyiladi.',
          },
        },
        {
          value: { ru: '75', en: '75', de: '75', ar: '75', kk: '75', uz: '75' },
          label: { ru: 'типов событий в журнале', en: 'event types in the audit log', de: 'Ereignistypen im Protokoll', ar: 'أنواع أحداث في السجل', kk: 'журналдағы оқиға түрі', uz: 'jurnaldagi hodisa turi' },
          proof: {
            ru: 'Вход, выгрузка, удаление, изменение доступа. Записи только добавляются и хранятся 365 дней — задним числом их не переписать.',
            en: 'Sign-in, export, deletion, access changes. Records are append-only and kept for 365 days — they cannot be rewritten after the fact.',
            de: 'Anmeldung, Export, Löschung, Zugriffsänderung. Einträge sind nur anfügbar und bleiben 365 Tage — nachträglich nicht änderbar.',
            ar: 'الدخول والتصدير والحذف وتغيير الصلاحيات. السجلات تُضاف فقط وتُحفَظ 365 يومًا — ولا يمكن إعادة كتابتها لاحقًا.',
            kk: 'Кіру, шығару, жою, рұқсат өзгерісі. Жазбалар тек қосылады және 365 күн сақталады — кейін қайта жазу мүмкін емес.',
            uz: 'Kirish, yuklab olish, oʻchirish, ruxsat oʻzgarishi. Yozuvlar faqat qoʻshiladi va 365 kun saqlanadi — keyin qayta yozib boʻlmaydi.',
          },
        },
        {
          value: { ru: '1', en: '1', de: '1', ar: '1', kk: '1', uz: '1' },
          label: { ru: 'файл со всеми вашими данными', en: 'file with all your data', de: 'Datei mit all Ihren Daten', ar: 'ملف واحد بكل بياناتك', kk: 'барлық деректеріңіз бар файл', uz: 'barcha maʼlumotlaringiz bor fayl' },
          proof: {
            ru: 'Выгрузка своих данных доступна самостоятельно, без письма в поддержку и ожидания.',
            en: 'You can export your data yourself, with no support ticket and no waiting.',
            de: 'Sie können Ihre Daten selbst exportieren — ohne Support-Ticket und Wartezeit.',
            ar: 'يمكنك تصدير بياناتك بنفسك، بلا تذكرة دعم ولا انتظار.',
            kk: 'Деректеріңізді өзіңіз шығара аласыз — қолдауға хат жазбай, күтпей.',
            uz: 'Maʼlumotlaringizni oʻzingiz yuklab olasiz — qoʻllab-quvvatlashga xat yozmasdan, kutmasdan.',
          },
        },
        {
          value: { ru: '2FA', en: '2FA', de: '2FA', ar: '2FA', kk: '2FA', uz: '2FA' },
          label: { ru: 'вход по одноразовому коду', en: 'sign-in with a one-time code', de: 'Anmeldung per Einmalcode', ar: 'دخول برمز لمرة واحدة', kk: 'бір реттік кодпен кіру', uz: 'bir martalik kod bilan kirish' },
          proof: {
            ru: 'Приложение-аутентификатор плюс резервные коды на случай потери телефона. Сессии можно отозвать — одну или все сразу.',
            en: 'An authenticator app plus backup codes in case the phone is lost. Sessions can be revoked — one or all at once.',
            de: 'Eine Authenticator-App plus Backup-Codes für den Verlustfall. Sitzungen lassen sich einzeln oder alle auf einmal widerrufen.',
            ar: 'تطبيق مصادقة مع رموز احتياطية عند فقد الهاتف. ويمكن إبطال الجلسات — واحدة أو كلها.',
            kk: 'Аутентификатор қосымшасы және телефон жоғалса — резервтік кодтар. Сессияларды бір-бірден немесе бәрін бірден тоқтатуға болады.',
            uz: 'Autentifikator ilovasi va telefon yoʻqolsa — zaxira kodlar. Sessiyalarni bittalab yoki hammasini birdan bekor qilish mumkin.',
          },
        },
      ],
    },

    {
      kind: 'table',
      title: {
        ru: 'Точный список: что зашифровано, что открыто',
        en: 'The exact list: what is encrypted, what is open',
        de: 'Die genaue Liste: verschlüsselt oder offen',
        ar: 'القائمة الدقيقة: ما المشفَّر وما المفتوح',
        kk: 'Нақты тізім: не шифрланған, не ашық',
        uz: 'Aniq roʻyxat: nima shifrlangan, nima ochiq',
      },
      intro: {
        ru: 'Мы не говорим «полностью зашифровано»: это было бы неправдой в любом продукте, где работают поиск и списки. Вместо этого — что и почему.',
        en: 'We do not say “fully encrypted”: that would be untrue in any product where search and lists work. Here is what and why instead.',
        de: 'Wir sagen nicht „vollständig verschlüsselt“: Das wäre in jedem Produkt mit Suche und Listen unwahr. Stattdessen: was und warum.',
        ar: 'لا نقول «مشفَّر بالكامل»: فذلك غير صحيح في أي منتج تعمل فيه القوائم والبحث. بدلًا من ذلك: ماذا ولماذا.',
        kk: '«Толық шифрланған» демейміз: іздеу мен тізім жұмыс істейтін кез келген өнімде бұл шындық емес. Оның орнына — не және неге.',
        uz: '«Toʻliq shifrlangan» demaymiz: qidiruv va roʻyxat ishlaydigan har qanday mahsulotda bu haqiqat emas. Buning oʻrniga — nima va nega.',
      },
      columns: [
        { ru: 'Данные', en: 'Data', de: 'Daten', ar: 'البيانات', kk: 'Деректер', uz: 'Maʼlumotlar' },
        { ru: 'Как хранится', en: 'How it is stored', de: 'Speicherung', ar: 'كيف تُخزَّن', kk: 'Қалай сақталады', uz: 'Qanday saqlanadi' },
        { ru: 'Почему так', en: 'Why', de: 'Warum', ar: 'لماذا', kk: 'Неге солай', uz: 'Nega shunday' },
      ],
      rows: [
        [
          { ru: 'Текст договора', en: 'Contract text', de: 'Vertragstext', ar: 'نص العقد', kk: 'Шарт мәтіні', uz: 'Shartnoma matni' },
          { ru: 'Зашифрован', en: 'Encrypted', de: 'Verschlüsselt', ar: 'مشفَّر', kk: 'Шифрланған', uz: 'Shifrlangan' },
          { ru: 'Самое ценное в документе; для списков он не нужен', en: 'The most sensitive part; lists do not need it', de: 'Das Sensibelste; für Listen nicht nötig', ar: 'الأكثر حساسية؛ والقوائم لا تحتاجه', kk: 'Ең құнды бөлігі; тізімге қажет емес', uz: 'Eng qimmatli qismi; roʻyxatga kerak emas' },
        ],
        [
          { ru: 'Резюме и блоки разбора', en: 'Summary and review blocks', de: 'Zusammenfassung und Prüfblöcke', ar: 'الملخص وكتل المراجعة', kk: 'Түйін және талдау блоктары', uz: 'Xulosa va tahlil bloklari' },
          { ru: 'Зашифрованы', en: 'Encrypted', de: 'Verschlüsselt', ar: 'مشفَّرة', kk: 'Шифрланған', uz: 'Shifrlangan' },
          { ru: 'Пересказывают содержание договора', en: 'They retell the contract’s content', de: 'Sie geben den Vertragsinhalt wieder', ar: 'تعيد سرد مضمون العقد', kk: 'Шарт мазмұнын қайталайды', uz: 'Shartnoma mazmunini takrorlaydi' },
        ],
        [
          { ru: 'Тексты правок', en: 'Redline texts', de: 'Änderungstexte', ar: 'نصوص التعديلات', kk: 'Түзету мәтіндері', uz: 'Tuzatish matnlari' },
          { ru: 'Зашифрованы', en: 'Encrypted', de: 'Verschlüsselt', ar: 'مشفَّرة', kk: 'Шифрланған', uz: 'Shifrlangan' },
          { ru: 'Это фрагменты договора и ваша позиция', en: 'They are contract fragments and your position', de: 'Sie sind Vertragsauszüge und Ihre Position', ar: 'هي مقاطع من العقد وموقفك', kk: 'Бұл шарт үзінділері және ұстанымыңыз', uz: 'Bu shartnoma parchalari va pozitsiyangiz' },
        ],
        [
          { ru: 'Шаблоны и правила фирмы', en: 'Templates and firm rules', de: 'Vorlagen und Kanzleiregeln', ar: 'القوالب وقواعد المكتب', kk: 'Үлгілер мен фирма ережелері', uz: 'Shablonlar va firma qoidalari' },
          { ru: 'Зашифрованы', en: 'Encrypted', de: 'Verschlüsselt', ar: 'مشفَّرة', kk: 'Шифрланған', uz: 'Shifrlangan' },
          { ru: 'Ноу-хау практики, а не служебные данные', en: 'The practice’s know-how, not housekeeping data', de: 'Know-how der Kanzlei, keine Verwaltungsdaten', ar: 'خبرة المكتب لا بيانات إدارية', kk: 'Тәжірибенің ноу-хауы, қызметтік дерек емес', uz: 'Amaliyot nou-xausi, xizmat maʼlumoti emas' },
        ],
        [
          { ru: 'Имя документа и контрагент', en: 'Document name and counterparty', de: 'Dokumentname und Gegenpartei', ar: 'اسم المستند والطرف المقابل', kk: 'Құжат атауы және контрагент', uz: 'Hujjat nomi va kontragent' },
          { ru: 'Открыты', en: 'Open', de: 'Offen', ar: 'مفتوحة', kk: 'Ашық', uz: 'Ochiq' },
          { ru: 'По ним идут список, поиск и сортировка', en: 'Lists, search and sorting run on them', de: 'Listen, Suche und Sortierung bauen darauf', ar: 'تعتمد عليها القوائم والبحث والفرز', kk: 'Тізім, іздеу және сұрыптау солар бойынша', uz: 'Roʻyxat, qidiruv va saralash shular boʻyicha' },
        ],
        [
          { ru: 'Заголовок и цитата находки', en: 'Finding title and citation', de: 'Titel und Fundstelle eines Befunds', ar: 'عنوان الملاحظة والإحالة', kk: 'Табылым тақырыбы және дәйексөз', uz: 'Topilma sarlavhasi va iqtibosi' },
          { ru: 'Открыты', en: 'Open', de: 'Offen', ar: 'مفتوحة', kk: 'Ашық', uz: 'Ochiq' },
          { ru: 'Нужны для фильтров по риску и проверки ссылки', en: 'Needed for risk filters and citation checks', de: 'Nötig für Risikofilter und Fundstellenprüfung', ar: 'لازمة لمرشحات المخاطر وفحص الإحالة', kk: 'Тәуекел сүзгілері мен сілтеме тексеруіне қажет', uz: 'Xavf filtrlari va havola tekshiruvi uchun kerak' },
        ],
      ],
    },

    {
      kind: 'list',
      title: {
        ru: 'Что ещё сделано',
        en: 'What else is in place',
        de: 'Was außerdem gilt',
        ar: 'ما الموجود أيضًا',
        kk: 'Тағы не істелген',
        uz: 'Yana nima qilingan',
      },
      items: [
        {
          title: { ru: 'Разграничение на уровне базы', en: 'Isolation at the database level', de: 'Abschottung auf Datenbankebene', ar: 'عزل على مستوى قاعدة البيانات', kk: 'Дерекқор деңгейінде шектеу', uz: 'Maʼlumotlar bazasi darajasida ajratish' },
          body: {
            ru: 'Правила доступа включены на всех таблицах: даже при ошибке в коде чужая строка не отдастся. Это проверяется автотестом, который падает, а не напоминает.',
            en: 'Row-level access rules are enabled on every table: even a bug in the code cannot hand out someone else’s row. An automated test enforces it — it fails rather than reminds.',
            de: 'Zeilenbasierte Zugriffsregeln sind auf allen Tabellen aktiv: Selbst ein Codefehler gibt keine fremde Zeile heraus. Ein Test erzwingt das — er schlägt fehl statt zu erinnern.',
            ar: 'قواعد الوصول على مستوى الصف مفعّلة في كل الجداول: حتى خطأ برمجي لا يسلّم صف غيرك. ويفرض ذلك اختبار آلي يفشل بدل أن يذكّر.',
            kk: 'Қатар деңгейіндегі қолжетімділік ережелері барлық кестеде қосулы: кодтағы қате де бөгде жолды бермейді. Мұны автотест қадағалайды — ол еске салмайды, құлайды.',
            uz: 'Satr darajasidagi kirish qoidalari barcha jadvallarda yoqilgan: koddagi xato ham begona satrni bermaydi. Buni avtotest nazorat qiladi — u eslatmaydi, yiqiladi.',
          },
        },
        {
          title: { ru: 'Удаление стирает ключ', en: 'Deletion erases the key', de: 'Löschen vernichtet den Schlüssel', ar: 'الحذف يمحو المفتاح', kk: 'Жою кілтті өшіреді', uz: 'Oʻchirish kalitni yoʻq qiladi' },
          body: {
            ru: 'При удалении учётной записи уничтожается её ключ данных. Даже если бы где-то остался зашифрованный фрагмент, расшифровать его больше нечем.',
            en: 'Deleting an account destroys its data key. Even if an encrypted fragment survived somewhere, there is nothing left to decrypt it with.',
            de: 'Beim Löschen eines Kontos wird dessen Datenschlüssel vernichtet. Selbst ein irgendwo verbliebenes verschlüsseltes Fragment ließe sich nicht mehr entschlüsseln.',
            ar: 'حذف الحساب يدمّر مفتاح بياناته. وحتى لو بقي مقطع مشفَّر في مكان ما، لم يعد هناك ما يفك تشفيره.',
            kk: 'Тіркелгіні жойғанда оның деректер кілті жойылады. Бір жерде шифрланған үзінді қалса да, оны ашатын ештеңе жоқ.',
            uz: 'Hisob oʻchirilganda uning maʼlumot kaliti yoʻq qilinadi. Biror joyda shifrlangan parcha qolsa ham, uni ochadigan narsa qolmaydi.',
          },
        },
        {
          title: { ru: 'Файл проверяется до разбора', en: 'A file is checked before review', de: 'Eine Datei wird vor der Prüfung kontrolliert', ar: 'يُفحص الملف قبل المراجعة', kk: 'Файл талдауға дейін тексеріледі', uz: 'Fayl tahlildan oldin tekshiriladi' },
          body: {
            ru: 'Содержимое сверяется с расширением: файл, который притворяется документом, отклоняется на входе.',
            en: 'The content is matched against the extension: a file pretending to be a document is rejected at the door.',
            de: 'Der Inhalt wird gegen die Dateiendung geprüft: Eine Datei, die sich als Dokument ausgibt, wird abgewiesen.',
            ar: 'يُطابَق المحتوى مع الامتداد: الملف الذي يتظاهر بأنه مستند يُرفض عند المدخل.',
            kk: 'Мазмұны кеңейтімге сәйкестігі тексеріледі: құжат болып көрінгісі келген файл кіре берісте қайтарылады.',
            uz: 'Mazmun kengaytmaga mosligi tekshiriladi: hujjat boʻlib koʻrinmoqchi boʻlgan fayl kirishda rad etiladi.',
          },
        },
        {
          title: { ru: 'Бесплатный тариф — отдельный поставщик ИИ', en: 'The free plan uses a separate AI provider', de: 'Der kostenlose Tarif nutzt einen separaten KI-Anbieter', ar: 'الباقة المجانية تستخدم مزوّد ذكاء اصطناعي منفصلًا', kk: 'Тегін тариф — бөлек ИИ жеткізушісі', uz: 'Bepul tarif — alohida AI yetkazuvchisi' },
          body: {
            ru: 'На Free запросы могут обрабатываться сторонним поставщиком инфраструктуры, в том числе за пределами вашей юрисдикции. Если для документов это критично — платные тарифы. Мы пишем об этом здесь, а не мелким шрифтом в условиях.',
            en: 'On Free, requests may be processed by a third-party infrastructure provider, possibly outside your jurisdiction. If that matters for your documents, use a paid plan. We say this here, not in small print.',
            de: 'Im Free-Tarif können Anfragen von einem Drittanbieter verarbeitet werden, auch außerhalb Ihrer Rechtsordnung. Ist das für Ihre Dokumente kritisch, nutzen Sie einen bezahlten Tarif. Wir sagen das hier, nicht im Kleingedruckten.',
            ar: 'في الباقة المجانية قد تُعالَج الطلبات لدى مزوّد بنية تحتية خارجي، وربما خارج ولايتك. إن كان ذلك حرجًا لمستنداتك فاستخدم باقة مدفوعة. نقول ذلك هنا لا في الحاشية.',
            kk: 'Free-де сұраулар сыртқы инфрақұрылым жеткізушісінде, соның ішінде юрисдикцияңыздан тыс өңделуі мүмкін. Құжаттарыңыз үшін бұл маңызды болса — ақылы тариф. Мұны шарттардың ұсақ жазуында емес, осында жазамыз.',
            uz: 'Free da soʻrovlar tashqi infratuzilma yetkazuvchisida, yurisdiksiyangizdan tashqarida ham qayta ishlanishi mumkin. Hujjatlaringiz uchun bu muhim boʻlsa — pullik tarif. Buni shartlarning mayda yozuvida emas, shu yerda aytamiz.',
          },
        },
      ],
    },

    {
      kind: 'list',
      tone: 'limits',
      title: { ru: 'Чего у нас нет', en: 'What we do not have', de: 'Was wir nicht haben', ar: 'ما لا نملكه', kk: 'Бізде не жоқ', uz: 'Bizda nima yoʻq' },
      items: [
        {
          title: { ru: 'Нет сертификаций', en: 'No certifications', de: 'Keine Zertifizierungen', ar: 'لا شهادات', kk: 'Сертификаттар жоқ', uz: 'Sertifikatlar yoʻq' },
          body: {
            ru: 'У нас нет пройденных отраслевых аудитов и сертификатов, и мы не намекаем на них словами вроде «соответствует стандартам». Есть меры, перечисленные выше, — их можно проверить в работе.',
            en: 'We have no completed industry audits or certificates, and we do not hint at them with phrases like “meets industry standards”. What we have are the measures listed above — verifiable in use.',
            de: 'Wir haben keine abgeschlossenen Branchenaudits oder Zertifikate und deuten sie auch nicht mit Formeln wie „entspricht Standards“ an. Es gibt die oben genannten Maßnahmen — im Betrieb überprüfbar.',
            ar: 'ليست لدينا تدقيقات أو شهادات قطاعية مكتملة، ولا نلمّح إليها بعبارات مثل «مطابق للمعايير». لدينا الإجراءات أعلاه — ويمكن التحقق منها عمليًا.',
            kk: 'Бізде өткен салалық аудиттер мен сертификаттар жоқ, «стандарттарға сай» деген сөздермен де мегзеп айтпаймыз. Жоғарыдағы шаралар бар — оларды жұмыста тексеруге болады.',
            uz: 'Bizda tugallangan soha auditlari va sertifikatlar yoʻq, «standartlarga mos» kabi soʻzlar bilan ham ishora qilmaymiz. Yuqoridagi choralar bor — ularni ishda tekshirish mumkin.',
          },
        },
        {
          title: { ru: 'Нет полной невидимости для сервера', en: 'The server is not blind to your data', de: 'Der Server ist nicht blind für Ihre Daten', ar: 'الخادم ليس أعمى عن بياناتك', kk: 'Сервер деректеріңізге мүлдем «соқыр» емес', uz: 'Server maʼlumotlaringizga toʻliq «koʻr» emas' },
          body: {
            ru: 'Чтобы разобрать договор, сервис должен его прочитать. Мы не обещаем схему, где расшифровка возможна только у вас в браузере, — это было бы неправдой.',
            en: 'To review a contract, the service must read it. We do not promise a scheme where decryption happens only in your browser — that would be untrue.',
            de: 'Um einen Vertrag zu prüfen, muss der Dienst ihn lesen. Wir versprechen kein Verfahren, bei dem nur Ihr Browser entschlüsselt — das wäre unwahr.',
            ar: 'لمراجعة العقد يجب أن تقرأه الخدمة. لا نعد بنظام يقتصر فك التشفير فيه على متصفحك — فذلك غير صحيح.',
            kk: 'Шартты талдау үшін сервис оны оқуы керек. Шифр тек браузеріңізде ашылатын схеманы уәде етпейміз — бұл шындық болмас еді.',
            uz: 'Shartnomani tahlil qilish uchun xizmat uni oʻqishi kerak. Shifr faqat brauzeringizda ochiladigan sxemani vaʼda qilmaymiz — bu haqiqat boʻlmasdi.',
          },
        },
      ],
    },

    {
      kind: 'faq',
      title: { ru: 'Частые вопросы', en: 'Frequently asked questions', de: 'Häufige Fragen', ar: 'أسئلة متكررة', kk: 'Жиі қойылатын сұрақтар', uz: 'Koʻp beriladigan savollar' },
      items: [
        {
          q: { ru: 'Кто из сотрудников Lexab может открыть мой договор?', en: 'Which Lexab staff can open my contract?', de: 'Wer bei Lexab kann meinen Vertrag öffnen?', ar: 'من من موظفي Lexab يمكنه فتح عقدي؟', kk: 'Lexab қызметкерлерінің қайсысы шартымды аша алады?', uz: 'Lexab xodimlaridan kim shartnomamni ocha oladi?' },
          a: {
            ru: 'Текст лежит зашифрованным ключом вашей учётной записи, а доступ к строкам ограничен правилами базы. Обращения к данным попадают в журнал, который нельзя переписать задним числом.',
            en: 'The text is encrypted with your account key, and row access is restricted by database rules. Data access lands in an audit log that cannot be rewritten afterwards.',
            de: 'Der Text liegt mit Ihrem Kontoschlüssel verschlüsselt, und der Zeilenzugriff ist per Datenbankregel beschränkt. Zugriffe landen im Protokoll, das sich nachträglich nicht ändern lässt.',
            ar: 'النص مشفَّر بمفتاح حسابك، والوصول إلى الصفوف مقيَّد بقواعد قاعدة البيانات. وتُسجَّل عمليات الوصول في سجل لا يمكن تعديله لاحقًا.',
            kk: 'Мәтін тіркелгіңіздің кілтімен шифрланған, жолдарға қолжетімділік дерекқор ережелерімен шектелген. Деректерге қатынау журналға түседі, оны кейін өзгерту мүмкін емес.',
            uz: 'Matn hisobingiz kaliti bilan shifrlangan, satrlarga kirish baza qoidalari bilan cheklangan. Maʼlumotlarga murojaat jurnalga tushadi, uni keyin oʻzgartirib boʻlmaydi.',
          },
        },
        {
          q: { ru: 'Что происходит при удалении документа?', en: 'What happens when I delete a document?', de: 'Was passiert beim Löschen eines Dokuments?', ar: 'ماذا يحدث عند حذف مستند؟', kk: 'Құжатты жойғанда не болады?', uz: 'Hujjat oʻchirilganda nima boʻladi?' },
          a: {
            ru: 'Документ уходит из работы, а событие удаления записывается в журнал. При удалении всей учётной записи уничтожается ключ данных — это необратимо.',
            en: 'The document leaves your workspace and the deletion is recorded in the log. Deleting the whole account destroys the data key — that is irreversible.',
            de: 'Das Dokument verschwindet aus der Arbeit, die Löschung wird protokolliert. Beim Löschen des gesamten Kontos wird der Datenschlüssel vernichtet — unwiderruflich.',
            ar: 'يخرج المستند من العمل ويُسجَّل الحذف في السجل. وحذف الحساب بالكامل يدمّر مفتاح البيانات — وهذا لا رجعة فيه.',
            kk: 'Құжат жұмыстан шығады, жою оқиғасы журналға жазылады. Бүкіл тіркелгіні жойғанда деректер кілті жойылады — бұл қайтымсыз.',
            uz: 'Hujjat ishdan chiqadi, oʻchirish hodisasi jurnalga yoziladi. Butun hisob oʻchirilganda maʼlumot kaliti yoʻq qilinadi — bu qaytarib boʻlmaydi.',
          },
        },
        {
          q: { ru: 'Можно ли забрать свои данные и уйти?', en: 'Can I take my data and leave?', de: 'Kann ich meine Daten mitnehmen und gehen?', ar: 'هل أستطيع أخذ بياناتي والمغادرة؟', kk: 'Деректерімді алып кете аламын ба?', uz: 'Maʼlumotlarimni olib keta olamanmi?' },
          a: {
            ru: 'Да. Выгрузка всех ваших данных одним файлом делается самостоятельно из настроек, отдельно от этого можно скачивать сами документы.',
            en: 'Yes. A single-file export of all your data is available from settings, and documents can be downloaded separately at any time.',
            de: 'Ja. Ein Export aller Daten in einer Datei ist in den Einstellungen verfügbar; Dokumente lassen sich zusätzlich einzeln herunterladen.',
            ar: 'نعم. تصدير كل بياناتك في ملف واحد متاح من الإعدادات، ويمكن تنزيل المستندات على حدة في أي وقت.',
            kk: 'Иә. Барлық деректеріңізді бір файлмен шығару баптаулардан жасалады, құжаттарды бөлек те жүктеуге болады.',
            uz: 'Ha. Barcha maʼlumotlaringizni bitta fayl bilan yuklab olish sozlamalardan bajariladi, hujjatlarni alohida ham yuklab olish mumkin.',
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
            ru: 'Роли и то, кто из коллег что видит.',
            en: 'Roles and who among colleagues sees what.',
            de: 'Rollen und wer im Kollegium was sieht.',
            ar: 'الأدوار ومن يرى ماذا بين الزملاء.',
            kk: 'Рөлдер және әріптестердің кім нені көретіні.',
            uz: 'Rollar va hamkasblardan kim nimani koʻradi.',
          },
          to: '/team-access',
        },
        {
          title: { ru: 'Интеграции', en: 'Integrations', de: 'Integrationen', ar: 'التكاملات', kk: 'Интеграциялар', uz: 'Integratsiyalar' },
          body: {
            ru: 'Какие права запрашиваются у облачных дисков и почему только на выбранные файлы.',
            en: 'Which permissions cloud drives are asked for, and why only for the files you pick.',
            de: 'Welche Rechte Cloud-Speicher erhalten und warum nur für gewählte Dateien.',
            ar: 'ما الصلاحيات المطلوبة من التخزين السحابي ولماذا للملفات المختارة فقط.',
            kk: 'Бұлттық дискілерден қандай рұқсат сұралады және неге тек таңдалған файлдарға.',
            uz: 'Bulutli disklardan qanday ruxsat soʻraladi va nega faqat tanlangan fayllarga.',
          },
          to: '/integrations',
        },
        {
          title: { ru: 'База законов', en: 'Legal base', de: 'Gesetzesbasis', ar: 'قاعدة القوانين', kk: 'Заң базасы', uz: 'Qonunlar bazasi' },
          body: {
            ru: 'Такая же точность в другом месте: что в корпусе есть и чего нет.',
            en: 'The same precision elsewhere: what the corpus has and what it does not.',
            de: 'Dieselbe Genauigkeit an anderer Stelle: was der Korpus hat und was nicht.',
            ar: 'الدقة نفسها في موضع آخر: ما في القاعدة وما ليس فيها.',
            kk: 'Дәл сондай нақтылық басқа жерде: корпуста не бар және не жоқ.',
            uz: 'Xuddi shunday aniqlik boshqa joyda: korpusda nima bor va nima yoʻq.',
          },
          to: '/legal-base',
        },
      ],
    },

    {
      kind: 'cta',
      title: { ru: 'Проверьте на своих документах', en: 'Check it on your own documents', de: 'Prüfen Sie es an eigenen Dokumenten', ar: 'تحقق على مستنداتك', kk: 'Өз құжаттарыңызда тексеріңіз', uz: 'Oʻz hujjatlaringizda tekshiring' },
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
