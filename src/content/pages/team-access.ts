/**
 * Публичная страница «Доступы в команде».
 *
 * Проверено по коду 05.08.2026:
 *  - гейт 'team' → Business, Enterprise (FEATURE_MIN_PLAN в limits.ts);
 *  - мест в команде: Free 1, Standard 1, Pro 1, Business 5, Enterprise без
 *    ограничения (PLAN_SEATS);
 *  - роли участника: admin, editor, viewer + владелец (teamAccess.ts);
 *  - единый вход организации (SSO) и просмотр журнала действий — тоже Business.
 */
import type { PageContent } from '../types';

export const teamAccess: PageContent = {
  slug: 'team-access',
  pageTitle: {
    ru: 'Доступы в команде — Lexab',
    en: 'Team access — Lexab',
    de: 'Teamzugriff — Lexab',
    ar: 'صلاحيات الفريق — Lexab',
    kk: 'Командадағы рұқсаттар — Lexab',
    uz: 'Jamoadagi ruxsatlar — Lexab',
  },
  blocks: [
    {
      kind: 'hero',
      title: {
        ru: 'Общая работа без общего пароля',
        en: 'Working together without a shared password',
        de: 'Zusammenarbeiten ohne gemeinsames Passwort',
        ar: 'عمل مشترك بلا كلمة مرور مشتركة',
        kk: 'Ортақ құпия сөзсіз бірлескен жұмыс',
        uz: 'Umumiy parolsiz birgalikda ishlash',
      },
      lead: {
        ru: 'Приглашаете коллег по почте и выдаёте роль: администратор, редактор или наблюдатель. Документы, правила фирмы и разборы становятся общими для команды, а действия каждого попадают в журнал. Один логин на всех больше не нужен — и это перестаёт быть дырой в безопасности.',
        en: 'Invite colleagues by email and assign a role: admin, editor or viewer. Documents, firm rules and reviews become shared across the team, and everyone’s actions land in the audit log. A single shared login is no longer needed — and stops being a security hole.',
        de: 'Laden Sie Kolleginnen per E-Mail ein und vergeben Sie eine Rolle: Admin, Bearbeiter oder Betrachter. Dokumente, Kanzleiregeln und Prüfungen werden teamweit geteilt, und jede Handlung landet im Protokoll. Ein gemeinsamer Login wird überflüssig — und hört auf, ein Sicherheitsloch zu sein.',
        ar: 'ادعُ زملاءك بالبريد وامنح كلًا دورًا: مسؤول أو محرر أو مشاهد. تصبح المستندات وقواعد المكتب والمراجعات مشتركة للفريق، وتُسجَّل أفعال كل شخص. ولم يعد حساب واحد مشترك ضروريًا — فيتوقف عن كونه ثغرة أمنية.',
        kk: 'Әріптестерді поштамен шақырып, рөл бересіз: әкімші, редактор немесе бақылаушы. Құжаттар, фирма ережелері және талдаулар команда үшін ортақ болады, әркімнің әрекеті журналға түседі. Бәріне бір логин енді қажет емес — әрі ол қауіпсіздік олқылығы болудан қалады.',
        uz: 'Hamkasblarni pochta orqali taklif qilib, rol berasiz: administrator, muharrir yoki kuzatuvchi. Hujjatlar, firma qoidalari va tahlillar jamoa uchun umumiy boʻladi, har kimning harakati jurnalga tushadi. Hammaga bitta login endi kerak emas — va u xavfsizlik teshigi boʻlishdan toʻxtaydi.',
      },
      planNote: {
        ru: 'Командная работа доступна на тарифе Business: 5 мест. На Enterprise число мест не ограничено. На Free, Standard и Pro — одно рабочее место.',
        en: 'Teamwork is available on Business: 5 seats. Enterprise has no seat limit. Free, Standard and Pro are single-seat.',
        de: 'Teamarbeit gibt es ab Business: 5 Plätze. Enterprise ist unbegrenzt. Free, Standard und Pro sind Einzelplatz-Tarife.',
        ar: 'العمل الجماعي متاح في Business: 5 مقاعد. وEnterprise بلا حد. أما Free وStandard وPro فمقعد واحد.',
        kk: 'Командалық жұмыс Business тарифінде: 5 орын. Enterprise-те орын саны шектелмеген. Free, Standard және Pro — бір орын.',
        uz: 'Jamoaviy ish Business tarifida: 5 ta oʻrin. Enterprise da oʻrin soni cheklanmagan. Free, Standard va Pro — bitta oʻrin.',
      },
      cta: [
        {
          label: { ru: 'Собрать команду', en: 'Build your team', de: 'Team aufbauen', ar: 'كوّن فريقك', kk: 'Команда жинау', uz: 'Jamoa toʻplash' },
          to: '/login',
          variant: 'primary',
        },
        {
          label: { ru: 'Безопасность', en: 'Security', de: 'Sicherheit', ar: 'الأمان', kk: 'Қауіпсіздік', uz: 'Xavfsizlik' },
          to: '/security',
          variant: 'secondary',
        },
      ],
    },

    {
      kind: 'table',
      title: { ru: 'Роли и права', en: 'Roles and rights', de: 'Rollen und Rechte', ar: 'الأدوار والصلاحيات', kk: 'Рөлдер мен құқықтар', uz: 'Rollar va huquqlar' },
      columns: [
        { ru: 'Роль', en: 'Role', de: 'Rolle', ar: 'الدور', kk: 'Рөл', uz: 'Rol' },
        { ru: 'Что может', en: 'What they can do', de: 'Was sie darf', ar: 'ما تستطيعه', kk: 'Не істей алады', uz: 'Nima qila oladi' },
      ],
      rows: [
        [
          { ru: 'Владелец', en: 'Owner', de: 'Inhaber', ar: 'المالك', kk: 'Иесі', uz: 'Egasi' },
          {
            ru: 'Всё: приглашает и удаляет участников, запускает согласования, управляет тарифом и ключами доступа',
            en: 'Everything: invites and removes members, starts approvals, manages the plan and access keys',
            de: 'Alles: lädt Mitglieder ein und entfernt sie, startet Freigaben, verwaltet Tarif und Zugriffsschlüssel',
            ar: 'كل شيء: يدعو الأعضاء ويزيلهم، ويبدأ الموافقات، ويدير الباقة ومفاتيح الوصول',
            kk: 'Бәрі: қатысушыларды шақырады және жояды, келісуді бастайды, тариф пен кілттерді басқарады',
            uz: 'Hammasi: aʼzolarni taklif qiladi va oʻchiradi, kelishuvni boshlaydi, tarif va kalitlarni boshqaradi',
          },
        ],
        [
          { ru: 'Администратор', en: 'Admin', de: 'Admin', ar: 'مسؤول', kk: 'Әкімші', uz: 'Administrator' },
          {
            ru: 'Работает с документами и правит правила фирмы наравне с владельцем',
            en: 'Works with documents and edits the firm’s rules on a par with the owner',
            de: 'Arbeitet mit Dokumenten und bearbeitet Kanzleiregeln gleichrangig mit der Inhaberin',
            ar: 'يعمل على المستندات ويعدّل قواعد المكتب كالمالك',
            kk: 'Құжаттармен жұмыс істейді және фирма ережелерін иесімен тең өзгертеді',
            uz: 'Hujjatlar bilan ishlaydi va firma qoidalarini ega bilan teng oʻzgartiradi',
          },
        ],
        [
          { ru: 'Редактор', en: 'Editor', de: 'Bearbeiter', ar: 'محرر', kk: 'Редактор', uz: 'Muharrir' },
          {
            ru: 'Загружает и разбирает документы, правит правила, но не управляет составом команды',
            en: 'Uploads and reviews documents, edits rules, but does not manage team membership',
            de: 'Lädt Dokumente hoch und prüft sie, bearbeitet Regeln, verwaltet aber keine Mitgliedschaften',
            ar: 'يرفع المستندات ويراجعها ويعدّل القواعد، لكنه لا يدير عضوية الفريق',
            kk: 'Құжаттарды жүктеп талдайды, ережелерді өзгертеді, бірақ команда құрамын басқармайды',
            uz: 'Hujjatlarni yuklaydi va tahlil qiladi, qoidalarni oʻzgartiradi, ammo jamoa tarkibini boshqarmaydi',
          },
        ],
        [
          { ru: 'Наблюдатель', en: 'Viewer', de: 'Betrachter', ar: 'مشاهد', kk: 'Бақылаушы', uz: 'Kuzatuvchi' },
          {
            ru: 'Только чтение: видит общие документы и правила, ничего не меняет',
            en: 'Read-only: sees shared documents and rules, changes nothing',
            de: 'Nur Lesen: sieht geteilte Dokumente und Regeln, ändert nichts',
            ar: 'قراءة فقط: يرى المستندات والقواعد المشتركة ولا يغيّر شيئًا',
            kk: 'Тек оқу: ортақ құжаттар мен ережелерді көреді, ештеңе өзгертпейді',
            uz: 'Faqat oʻqish: umumiy hujjatlar va qoidalarni koʻradi, hech nima oʻzgartirmaydi',
          },
        ],
      ],
    },

    {
      kind: 'list',
      title: { ru: 'Что ещё открывается на Business', en: 'What else Business unlocks', de: 'Was Business zusätzlich freischaltet', ar: 'ما يفتحه Business أيضًا', kk: 'Business-те тағы не ашылады', uz: 'Business da yana nima ochiladi' },
      items: [
        {
          title: { ru: 'Единый вход организации', en: 'Organisation single sign-on', de: 'Unternehmens-Single-Sign-on', ar: 'الدخول الموحّد للمؤسسة', kk: 'Ұйымның бірыңғай кіруі', uz: 'Tashkilotning yagona kirishi' },
          body: {
            ru: 'Сотрудники входят учётной записью организации — увольнение закрывает доступ там же, где отключается почта.',
            en: 'Staff sign in with the organisation account — offboarding closes access in the same place the mailbox is disabled.',
            de: 'Mitarbeitende melden sich mit dem Organisationskonto an — beim Austritt endet der Zugriff dort, wo auch das Postfach abgeschaltet wird.',
            ar: 'يدخل الموظفون بحساب المؤسسة — وإنهاء الخدمة يغلق الوصول في المكان نفسه الذي يُعطَّل فيه البريد.',
            kk: 'Қызметкерлер ұйым тіркелгісімен кіреді — жұмыстан шыққанда пошта өшетін жерде қолжетімділік те жабылады.',
            uz: 'Xodimlar tashkilot hisobi bilan kiradi — ishdan boʻshaganda pochta oʻchiriladigan joyda kirish ham yopiladi.',
          },
        },
        {
          title: { ru: 'Журнал действий команды', en: 'Team audit log', de: 'Team-Protokoll', ar: 'سجل أحداث الفريق', kk: 'Команда әрекеттер журналы', uz: 'Jamoa harakatlar jurnali' },
          body: {
            ru: '75 типов событий: кто открыл, выгрузил, удалил, изменил доступ. Хранится 365 дней и не переписывается задним числом.',
            en: '75 event types: who opened, exported, deleted, changed access. Kept for 365 days and never rewritten after the fact.',
            de: '75 Ereignistypen: wer geöffnet, exportiert, gelöscht, Zugriff geändert hat. 365 Tage Aufbewahrung, nachträglich unveränderbar.',
            ar: '75 نوع حدث: من فتح وصدّر وحذف وغيّر الصلاحيات. يُحفَظ 365 يومًا ولا يُعاد كتابته لاحقًا.',
            kk: '75 оқиға түрі: кім ашты, шығарды, жойды, рұқсатты өзгертті. 365 күн сақталады, кейін қайта жазылмайды.',
            uz: '75 xil hodisa: kim ochdi, yukladi, oʻchirdi, ruxsatni oʻzgartirdi. 365 kun saqlanadi va keyin qayta yozilmaydi.',
          },
        },
        {
          title: { ru: 'Программный доступ по ключу', en: 'Programmatic access by key', de: 'Programmatischer Zugriff per Schlüssel', ar: 'وصول برمجي بمفتاح', kk: 'Кілт арқылы бағдарламалық қолжетімділік', uz: 'Kalit orqali dasturiy kirish' },
          body: {
            ru: 'Тот же продукт из вашей системы: ключи с ограниченными правами, сроком жизни и ротацией.',
            en: 'The same product from your own system: keys with limited scopes, expiry and rotation.',
            de: 'Dasselbe Produkt aus dem eigenen System: Schlüssel mit begrenzten Rechten, Ablauf und Rotation.',
            ar: 'المنتج نفسه من نظامك: مفاتيح بصلاحيات محدودة ومدة صلاحية وتدوير.',
            kk: 'Сол өнім өз жүйеңізден: шектеулі құқықты, мерзімі бар және ауыстырылатын кілттер.',
            uz: 'Oʻsha mahsulot oʻz tizimingizdan: cheklangan huquqli, muddatli va almashtiriladigan kalitlar.',
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
          title: { ru: 'До Business команда — один человек', en: 'Below Business a team is one person', de: 'Unter Business ist ein Team eine Person', ar: 'دون Business الفريق شخص واحد', kk: 'Business-ке дейін команда — бір адам', uz: 'Business gacha jamoa — bitta odam' },
          body: {
            ru: 'На Free, Standard и Pro рабочее место одно. Это видно в тарифах и в интерфейсе заранее, а не в момент приглашения коллеги.',
            en: 'Free, Standard and Pro are single-seat. This is visible in the plans and in the app upfront, not at the moment you invite a colleague.',
            de: 'Free, Standard und Pro haben einen Platz. Das steht vorab in den Tarifen und in der Oberfläche, nicht erst beim Einladen.',
            ar: 'باقات Free وStandard وPro بمقعد واحد. وهذا ظاهر في الباقات وفي الواجهة مسبقًا لا لحظة دعوة زميل.',
            kk: 'Free, Standard және Pro — бір орын. Бұл тарифтерде және интерфейсте алдын ала көрінеді.',
            uz: 'Free, Standard va Pro — bitta oʻrin. Bu tariflarda va interfeysda oldindan koʻrinadi.',
          },
        },
        {
          title: { ru: 'Лимиты общие на команду', en: 'Limits are shared by the team', de: 'Limits gelten für das ganze Team', ar: 'الحدود مشتركة للفريق', kk: 'Лимиттер командаға ортақ', uz: 'Limitlar jamoaga umumiy' },
          body: {
            ru: 'Месячные обращения к ИИ и документы считаются по владельцу команды, а не отдельно каждому участнику.',
            en: 'Monthly AI requests and documents are counted against the team owner, not per member.',
            de: 'Monatliche KI-Anfragen und Dokumente zählen auf die Inhaberin, nicht je Mitglied.',
            ar: 'تُحتسب الطلبات الشهرية والمستندات على مالك الفريق لا على كل عضو.',
            kk: 'Айлық ИИ сұраулары мен құжаттар команда иесі бойынша есептеледі, әр қатысушыға бөлек емес.',
            uz: 'Oylik AI soʻrovlari va hujjatlar jamoa egasi boʻyicha hisoblanadi, har bir aʼzoga alohida emas.',
          },
        },
      ],
    },

    {
      kind: 'faq',
      title: { ru: 'Частые вопросы', en: 'Frequently asked questions', de: 'Häufige Fragen', ar: 'أسئلة متكررة', kk: 'Жиі қойылатын сұрақтар', uz: 'Koʻp beriladigan savollar' },
      items: [
        {
          q: { ru: 'Видит ли участник все мои документы?', en: 'Does a member see all my documents?', de: 'Sieht ein Mitglied alle meine Dokumente?', ar: 'هل يرى العضو كل مستنداتي؟', kk: 'Қатысушы барлық құжаттарымды көре ме?', uz: 'Aʼzo barcha hujjatlarimni koʻradimi?' },
          a: {
            ru: 'Только те, что открыты команде. Документ помечается общим осознанно — по умолчанию он остаётся личным.',
            en: 'Only those shared with the team. Sharing a document is a deliberate act — by default it stays private.',
            de: 'Nur die fürs Team freigegebenen. Das Teilen ist eine bewusste Handlung — standardmäßig bleibt ein Dokument privat.',
            ar: 'فقط ما تمت مشاركته مع الفريق. والمشاركة فعل مقصود — وافتراضيًا يبقى المستند خاصًا.',
            kk: 'Тек командаға ашылғандарын. Құжат әдейі ортақ деп белгіленеді — әдепкіде жеке болып қалады.',
            uz: 'Faqat jamoaga ochilganlarini. Hujjat ataylab umumiy deb belgilanadi — sukut boʻyicha shaxsiy qoladi.',
          },
        },
        {
          q: { ru: 'Что происходит, когда сотрудник уходит?', en: 'What happens when someone leaves?', de: 'Was passiert, wenn jemand geht?', ar: 'ماذا يحدث عند مغادرة موظف؟', kk: 'Қызметкер кеткенде не болады?', uz: 'Xodim ketganda nima boʻladi?' },
          a: {
            ru: 'Владелец отключает участника, и доступ к общим документам прекращается. Событие остаётся в журнале — видно, кто и когда что открывал до этого.',
            en: 'The owner deactivates the member and access to shared documents ends. The event stays in the log — it remains visible who opened what and when before that.',
            de: 'Die Inhaberin deaktiviert das Mitglied, der Zugriff endet. Das Ereignis bleibt im Protokoll — wer wann was geöffnet hat, bleibt nachvollziehbar.',
            ar: 'يعطّل المالك العضو فينتهي الوصول إلى المستندات المشتركة. ويبقى الحدث في السجل — فيظل واضحًا من فتح ماذا ومتى قبل ذلك.',
            kk: 'Иесі қатысушыны өшіреді, ортақ құжаттарға қолжетімділік тоқтайды. Оқиға журналда қалады — оған дейін кім нені қашан ашқаны көрінеді.',
            uz: 'Ega aʼzoni oʻchiradi, umumiy hujjatlarga kirish toʻxtaydi. Hodisa jurnalda qoladi — undan oldin kim nimani qachon ochgani koʻrinadi.',
          },
        },
      ],
    },

    {
      kind: 'related',
      title: { ru: 'Дальше по теме', en: 'Related', de: 'Weiterlesen', ar: 'مواضيع ذات صلة', kk: 'Тақырып бойынша әрі қарай', uz: 'Mavzu boʻyicha davomi' },
      items: [
        {
          title: { ru: 'Согласования и сроки', en: 'Approvals & deadlines', de: 'Freigaben und Fristen', ar: 'الموافقات والمواعيد', kk: 'Келісулер мен мерзімдер', uz: 'Kelishuvlar va muddatlar' },
          body: {
            ru: 'Порядок визирования документа внутри команды и за её пределами.',
            en: 'How a document is signed off inside the team and beyond it.',
            de: 'Wie ein Dokument im Team und darüber hinaus freigegeben wird.',
            ar: 'كيف يُعتمد المستند داخل الفريق وخارجه.',
            kk: 'Құжатты команда ішінде және одан тыс виза беру тәртібі.',
            uz: 'Hujjatni jamoa ichida va tashqarisida viza qilish tartibi.',
          },
          to: '/approvals-and-deadlines',
        },
        {
          title: { ru: 'Правила по пунктам', en: 'Clause playbooks', de: 'Klausel-Playbooks', ar: 'أدلة البنود', kk: 'Тармақтар бойынша ережелер', uz: 'Bandlar boʻyicha qoidalar' },
          body: {
            ru: 'Общие позиции фирмы, которые видит вся команда.',
            en: 'The firm’s shared positions, visible to the whole team.',
            de: 'Gemeinsame Kanzleipositionen, für das ganze Team sichtbar.',
            ar: 'مواقف المكتب المشتركة التي يراها الفريق كله.',
            kk: 'Бүкіл команда көретін фирманың ортақ ұстанымдары.',
            uz: 'Butun jamoa koʻradigan firmaning umumiy pozitsiyalari.',
          },
          to: '/clause-playbooks',
        },
        {
          title: { ru: 'Безопасность', en: 'Security', de: 'Sicherheit', ar: 'الأمان', kk: 'Қауіпсіздік', uz: 'Xavfsizlik' },
          body: {
            ru: 'Шифрование, журнал действий и разграничение на уровне базы.',
            en: 'Encryption, the audit log and isolation at the database level.',
            de: 'Verschlüsselung, Protokoll und Abschottung auf Datenbankebene.',
            ar: 'التشفير وسجل الأحداث والعزل على مستوى قاعدة البيانات.',
            kk: 'Шифрлау, әрекеттер журналы және дерекқор деңгейіндегі шектеу.',
            uz: 'Shifrlash, harakatlar jurnali va baza darajasidagi ajratish.',
          },
          to: '/security',
        },
      ],
    },

    {
      kind: 'cta',
      title: { ru: 'Уберите общий пароль из практики', en: 'Retire the shared password', de: 'Schaffen Sie das gemeinsame Passwort ab', ar: 'تخلَّص من كلمة المرور المشتركة', kk: 'Ортақ құпия сөзді тәжірибеден алып тастаңыз', uz: 'Umumiy parolni amaliyotdan olib tashlang' },
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
