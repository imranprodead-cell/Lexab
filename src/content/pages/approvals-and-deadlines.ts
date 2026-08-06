/**
 * Публичная страница «Согласования и сроки».
 *
 * Проверено по коду 05.08.2026 (server/src/routes/approvals.routes.ts):
 *  - цепочку запускает ВЛАДЕЛЕЦ документа (POST /approvals), он же отменяет;
 *  - согласующий открывает свой шаг по персональной ссылке БЕЗ входа в систему
 *    (GET /approve/:token) и решает «согласовано / отклонено» с комментарием;
 *  - просроченный шаг получает ОДНО письмо-напоминание, владелец — уведомление
 *    в приложении (checkApprovalDeadlines по интервалу);
 *  - гейт 'approvals' → Pro, Business, Enterprise.
 * Никакой электронной подписи здесь нет и не обещается.
 */
import type { PageContent } from '../types';

export const approvalsAndDeadlines: PageContent = {
  slug: 'approvals-and-deadlines',
  pageTitle: {
    ru: 'Согласования и сроки — Lexab',
    en: 'Approvals and deadlines — Lexab',
    de: 'Freigaben und Fristen — Lexab',
    ar: 'الموافقات والمواعيد — Lexab',
    kk: 'Келісулер мен мерзімдер — Lexab',
    uz: 'Kelishuvlar va muddatlar — Lexab',
  },
  blocks: [
    {
      kind: 'hero',
      title: {
        ru: 'Договор проходит согласование по цепочке',
        en: 'A contract moves through an approval chain',
        de: 'Ein Vertrag durchläuft eine Freigabekette',
        ar: 'العقد يمر بسلسلة موافقات',
        kk: 'Шарт тізбекпен келісуден өтеді',
        uz: 'Shartnoma zanjir boʻylab kelishuvdan oʻtadi',
      },
      lead: {
        ru: 'Задаёте порядок согласующих и срок на каждый шаг. Каждый получает персональную ссылку и решает прямо из письма — «согласовано» или «отклонено» с комментарием. Регистрироваться в Lexab согласующему не нужно, а вы видите, на ком именно застряло.',
        en: 'You set the order of approvers and a deadline for each step. Each of them gets a personal link and decides straight from the email — approve or reject with a comment. An approver does not need a Lexab account, and you can see exactly where the chain is stuck.',
        de: 'Sie legen die Reihenfolge der Freigebenden und je Schritt eine Frist fest. Jede Person erhält einen persönlichen Link und entscheidet direkt aus der E-Mail — freigeben oder ablehnen mit Kommentar. Ein Lexab-Konto braucht sie dafür nicht, und Sie sehen genau, wo es hängt.',
        ar: 'تحدد ترتيب المعتمِدين ومهلة لكل خطوة. يحصل كل منهم على رابط شخصي ويقرر من البريد مباشرة — موافقة أو رفض مع تعليق. ولا يحتاج المعتمِد إلى حساب في Lexab، وأنت ترى أين توقفت السلسلة بالضبط.',
        kk: 'Келісушілердің ретін және әр қадамға мерзім белгілейсіз. Әрқайсысы жеке сілтеме алып, тікелей хаттан шешеді — «келісілді» немесе «қабылданбады», түсініктемемен. Келісушіге Lexab-қа тіркелу қажет емес, ал сіз кімде тұрып қалғанын көресіз.',
        uz: 'Kelishuvchilar tartibini va har bir qadamga muddat belgilaysiz. Har biri shaxsiy havola olib, toʻgʻridan-toʻgʻri xatdan qaror qiladi — «kelishildi» yoki «rad etildi», izoh bilan. Kelishuvchiga Lexabda roʻyxatdan oʻtish shart emas, siz esa qayerda toʻxtaganini koʻrasiz.',
      },
      planNote: {
        ru: 'Доступно на тарифах Pro и Business (и на Enterprise).',
        en: 'Available on Pro and Business (and Enterprise).',
        de: 'Verfügbar in Pro und Business (sowie Enterprise).',
        ar: 'متاحة في Pro وBusiness (وEnterprise).',
        kk: 'Pro және Business тарифтерінде (және Enterprise).',
        uz: 'Pro va Business tariflarida (hamda Enterprise).',
      },
      cta: [
        {
          label: { ru: 'Запустить согласование', en: 'Start an approval', de: 'Freigabe starten', ar: 'ابدأ موافقة', kk: 'Келісуді бастау', uz: 'Kelishuvni boshlash' },
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
          value: { ru: '0', en: '0', de: '0', ar: '0', kk: '0', uz: '0' },
          label: { ru: 'регистраций от согласующего', en: 'sign-ups required from an approver', de: 'Registrierungen für Freigebende', ar: 'تسجيلات مطلوبة من المعتمِد', kk: 'келісушіден талап етілетін тіркелу', uz: 'kelishuvchidan talab qilinadigan roʻyxat' },
          proof: {
            ru: 'Шаг открывается по персональной ссылке из письма — без пароля и учётной записи.',
            en: 'A step opens from a personal link in the email — no password, no account.',
            de: 'Ein Schritt öffnet sich über einen persönlichen Link in der E-Mail — ohne Passwort und Konto.',
            ar: 'تُفتح الخطوة برابط شخصي من البريد — بلا كلمة مرور ولا حساب.',
            kk: 'Қадам хаттағы жеке сілтемемен ашылады — құпия сөзсіз және тіркелгісіз.',
            uz: 'Qadam xatdagi shaxsiy havola bilan ochiladi — parolsiz va hisobsiz.',
          },
        },
        {
          value: { ru: '1', en: '1', de: '1', ar: '1', kk: '1', uz: '1' },
          label: { ru: 'напоминание о просрочке', en: 'reminder when a step is overdue', de: 'Erinnerung bei Fristablauf', ar: 'تذكير عند التأخر', kk: 'мерзім өткені туралы бір еске салу', uz: 'muddat oʻtgani haqida bitta eslatma' },
          proof: {
            ru: 'Ровно одно письмо на просроченный шаг: напоминание, а не рассылка, которую начинают игнорировать.',
            en: 'Exactly one email per overdue step: a reminder, not a stream people start ignoring.',
            de: 'Genau eine E-Mail je überfälligem Schritt: eine Erinnerung, keine Serie, die man zu ignorieren beginnt.',
            ar: 'رسالة واحدة بالضبط لكل خطوة متأخرة: تذكير لا سيل يبدأ الناس بتجاهله.',
            kk: 'Мерзімі өткен қадамға дәл бір хат: еске салу, елемей бастайтын тарату емес.',
            uz: 'Muddati oʻtgan qadamga aynan bitta xat: eslatma, eʼtiborsiz qoldiriladigan tarqatma emas.',
          },
        },
        {
          value: { ru: '75', en: '75', de: '75', ar: '75', kk: '75', uz: '75' },
          label: { ru: 'типов событий в журнале', en: 'event types in the audit log', de: 'Ereignistypen im Protokoll', ar: 'أنواع أحداث في السجل', kk: 'журналдағы оқиға түрі', uz: 'jurnaldagi hodisa turi' },
          proof: {
            ru: 'Запуск цепочки, решение по шагу и отмена записываются в журнал действий — его нельзя изменить задним числом.',
            en: 'Starting a chain, deciding a step and cancelling are written to the audit log — which cannot be altered after the fact.',
            de: 'Start der Kette, Entscheidung eines Schritts und Abbruch landen im Protokoll — nachträglich unveränderbar.',
            ar: 'بدء السلسلة وقرار الخطوة والإلغاء تُسجَّل في سجل الأحداث — ولا يمكن تغييره لاحقًا.',
            kk: 'Тізбекті бастау, қадам бойынша шешім және бас тарту әрекеттер журналына жазылады — оны кейін өзгерту мүмкін емес.',
            uz: 'Zanjirni boshlash, qadam boʻyicha qaror va bekor qilish harakatlar jurnaliga yoziladi — uni keyin oʻzgartirib boʻlmaydi.',
          },
        },
      ],
    },

    {
      kind: 'steps',
      title: { ru: 'Как это работает', en: 'How it works', de: 'So funktioniert es', ar: 'كيف يعمل', kk: 'Бұл қалай жұмыс істейді', uz: 'Bu qanday ishlaydi' },
      items: [
        {
          title: { ru: 'Собираете цепочку', en: 'You build the chain', de: 'Sie bauen die Kette', ar: 'تبني السلسلة', kk: 'Тізбекті құрасыз', uz: 'Zanjirni tuzasiz' },
          body: {
            ru: 'Указываете, кто согласует и в каком порядке, и ставите срок на каждый шаг.',
            en: 'You say who approves and in what order, and set a deadline for each step.',
            de: 'Sie legen fest, wer in welcher Reihenfolge freigibt, und setzen je Schritt eine Frist.',
            ar: 'تحدد من يعتمد وبأي ترتيب، وتضع مهلة لكل خطوة.',
            kk: 'Кім, қандай ретпен келісетінін көрсетіп, әр қадамға мерзім қоясыз.',
            uz: 'Kim, qanday tartibda kelishishini koʻrsatib, har bir qadamga muddat qoʻyasiz.',
          },
        },
        {
          title: { ru: 'Приходит письмо со ссылкой', en: 'An email with a link arrives', de: 'Eine E-Mail mit Link kommt an', ar: 'تصل رسالة تحوي رابطًا', kk: 'Сілтемесі бар хат келеді', uz: 'Havolali xat keladi' },
          body: {
            ru: 'Согласующий видит документ, цепочку целиком и свой шаг — без доступа к остальному кабинету.',
            en: 'The approver sees the document, the whole chain and their own step — with no access to the rest of the workspace.',
            de: 'Die freigebende Person sieht Dokument, gesamte Kette und den eigenen Schritt — ohne Zugriff auf den übrigen Arbeitsbereich.',
            ar: 'يرى المعتمِد المستند والسلسلة كاملة وخطوته — دون وصول إلى بقية المساحة.',
            kk: 'Келісуші құжатты, тізбекті толық және өз қадамын көреді — кабинеттің қалғанына кірмей.',
            uz: 'Kelishuvchi hujjatni, zanjirni toʻliq va oʻz qadamini koʻradi — kabinetning qolganiga kirmasdan.',
          },
        },
        {
          title: { ru: 'Решение с комментарием', en: 'A decision with a comment', de: 'Entscheidung mit Kommentar', ar: 'قرار مع تعليق', kk: 'Түсініктемемен шешім', uz: 'Izohli qaror' },
          body: {
            ru: '«Согласовано» или «отклонено» — и текст, почему. Комментарий остаётся в истории документа.',
            en: 'Approve or reject — plus the reasoning. The comment stays in the document’s history.',
            de: 'Freigeben oder ablehnen — samt Begründung. Der Kommentar bleibt in der Historie des Dokuments.',
            ar: 'موافقة أو رفض — مع السبب. ويبقى التعليق في سجل المستند.',
            kk: '«Келісілді» немесе «қабылданбады» — және себебі. Түсініктеме құжат тарихында қалады.',
            uz: '«Kelishildi» yoki «rad etildi» — va sababi. Izoh hujjat tarixida qoladi.',
          },
        },
        {
          title: { ru: 'Просрочка не остаётся незамеченной', en: 'An overdue step does not go unnoticed', de: 'Eine überfällige Freigabe bleibt nicht unbemerkt', ar: 'الخطوة المتأخرة لا تمر دون ملاحظة', kk: 'Мерзімі өткен қадам байқалмай қалмайды', uz: 'Muddati oʻtgan qadam sezilmay qolmaydi' },
          body: {
            ru: 'Согласующему уходит напоминание, а вам — уведомление в приложении: видно, где именно встала сделка.',
            en: 'The approver gets a reminder and you get an in-app notification: it is visible exactly where the deal stalled.',
            de: 'Die freigebende Person erhält eine Erinnerung, Sie eine Benachrichtigung in der App: Es ist sichtbar, wo das Geschäft hängt.',
            ar: 'يتلقى المعتمِد تذكيرًا وتتلقى أنت إشعارًا في التطبيق: يظهر أين تعطلت الصفقة بالضبط.',
            kk: 'Келісушіге еске салу, сізге қосымшада хабарлама келеді: мәміле дәл қай жерде тұрғаны көрінеді.',
            uz: 'Kelishuvchiga eslatma, sizga ilovada bildirishnoma keladi: bitim aynan qayerda toʻxtagani koʻrinadi.',
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
          title: { ru: 'Согласование — не подпись', en: 'An approval is not a signature', de: 'Eine Freigabe ist keine Unterschrift', ar: 'الموافقة ليست توقيعًا', kk: 'Келісу — қол қою емес', uz: 'Kelishuv — imzo emas' },
          body: {
            ru: 'Это внутренний порядок визирования. Юридически значимой электронной подписи в продукте нет — раздел выключен.',
            en: 'This is an internal sign-off procedure. There is no legally significant e-signature in the product — that section is switched off.',
            de: 'Das ist ein internes Zeichnungsverfahren. Eine rechtsverbindliche elektronische Signatur gibt es nicht — der Bereich ist abgeschaltet.',
            ar: 'هذا إجراء اعتماد داخلي. ولا يوجد توقيع إلكتروني ذو حجية في المنتج — القسم مُعطَّل.',
            kk: 'Бұл — ішкі виза тәртібі. Заңдық мәні бар электрондық қолтаңба өнімде жоқ — бөлім өшірілген.',
            uz: 'Bu — ichki viza tartibi. Huquqiy ahamiyatga ega elektron imzo mahsulotda yoʻq — boʻlim oʻchirilgan.',
          },
        },
        {
          title: { ru: 'Цепочку запускает владелец документа', en: 'Only the document owner starts a chain', de: 'Die Kette startet die Dokumenteninhaberin', ar: 'مالك المستند وحده يبدأ السلسلة', kk: 'Тізбекті құжат иесі бастайды', uz: 'Zanjirni hujjat egasi boshlaydi' },
          body: {
            ru: 'Участник команды может видеть ход согласования, но не запускать и не отменять его вместо владельца.',
            en: 'A team member can watch the progress but cannot start or cancel a chain on the owner’s behalf.',
            de: 'Teammitglieder sehen den Verlauf, können die Kette aber nicht anstelle der Inhaberin starten oder abbrechen.',
            ar: 'يمكن لعضو الفريق متابعة السير لكن لا يبدأ السلسلة أو يلغيها نيابة عن المالك.',
            kk: 'Команда мүшесі барысын көре алады, бірақ иесінің орнына бастай да, тоқтата да алмайды.',
            uz: 'Jamoa aʼzosi jarayonni koʻra oladi, ammo ega oʻrniga boshlay ham, bekor qila ham olmaydi.',
          },
        },
      ],
    },

    {
      kind: 'faq',
      title: { ru: 'Частые вопросы', en: 'Frequently asked questions', de: 'Häufige Fragen', ar: 'أسئلة متكررة', kk: 'Жиі қойылатын сұрақтар', uz: 'Koʻp beriladigan savollar' },
      items: [
        {
          q: { ru: 'Что видит человек по ссылке из письма?', en: 'What does a person see via the email link?', de: 'Was sieht eine Person über den Link in der E-Mail?', ar: 'ماذا يرى الشخص عبر رابط البريد؟', kk: 'Хаттағы сілтеме бойынша адам не көреді?', uz: 'Xatdagi havola boʻyicha odam nima koʻradi?' },
          a: {
            ru: 'Документ, всю цепочку согласования и свой шаг. Ни других документов, ни настроек, ни данных вашей команды по этой ссылке не видно.',
            en: 'The document, the whole approval chain and their own step. No other documents, no settings, none of your team’s data are reachable from that link.',
            de: 'Das Dokument, die gesamte Freigabekette und den eigenen Schritt. Andere Dokumente, Einstellungen oder Teamdaten sind über den Link nicht erreichbar.',
            ar: 'المستند وسلسلة الموافقات كاملة وخطوته. لا مستندات أخرى ولا إعدادات ولا بيانات فريقك عبر ذلك الرابط.',
            kk: 'Құжатты, бүкіл келісу тізбегін және өз қадамын. Бұл сілтемеден басқа құжаттар да, баптаулар да, команда деректері де көрінбейді.',
            uz: 'Hujjatni, butun kelishuv zanjirini va oʻz qadamini. Bu havoladan boshqa hujjatlar ham, sozlamalar ham, jamoa maʼlumotlari ham koʻrinmaydi.',
          },
        },
        {
          q: { ru: 'Можно ли отменить запущенную цепочку?', en: 'Can a running chain be cancelled?', de: 'Lässt sich eine laufende Kette abbrechen?', ar: 'هل يمكن إلغاء سلسلة جارية؟', kk: 'Басталған тізбекті тоқтатуға бола ма?', uz: 'Boshlangan zanjirni bekor qilish mumkinmi?' },
          a: {
            ru: 'Да, владелец документа может отменить активную цепочку. Отмена, как и все решения по шагам, записывается в журнал действий.',
            en: 'Yes, the document owner can cancel an active chain. The cancellation, like every step decision, is written to the audit log.',
            de: 'Ja, die Dokumenteninhaberin kann eine aktive Kette abbrechen. Der Abbruch landet wie jede Schrittentscheidung im Protokoll.',
            ar: 'نعم، يمكن لمالك المستند إلغاء سلسلة نشطة. ويُسجَّل الإلغاء كسائر قرارات الخطوات في سجل الأحداث.',
            kk: 'Иә, құжат иесі белсенді тізбекті тоқтата алады. Бас тарту да, қадам шешімдері де журналға жазылады.',
            uz: 'Ha, hujjat egasi faol zanjirni bekor qila oladi. Bekor qilish ham, qadam qarorlari ham jurnalga yoziladi.',
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
            ru: 'Роли, приглашения и то, кто что видит внутри команды.',
            en: 'Roles, invitations and who sees what inside the team.',
            de: 'Rollen, Einladungen und wer im Team was sieht.',
            ar: 'الأدوار والدعوات ومن يرى ماذا داخل الفريق.',
            kk: 'Рөлдер, шақырулар және команда ішінде кім нені көреді.',
            uz: 'Rollar, taklifnomalar va jamoa ichida kim nimani koʻradi.',
          },
          to: '/team-access',
        },
        {
          title: { ru: 'Безопасность', en: 'Security', de: 'Sicherheit', ar: 'الأمان', kk: 'Қауіпсіздік', uz: 'Xavfsizlik' },
          body: {
            ru: 'Журнал действий, шифрование и то, что нельзя изменить задним числом.',
            en: 'The audit log, encryption and what cannot be altered after the fact.',
            de: 'Protokoll, Verschlüsselung und was sich nachträglich nicht ändern lässt.',
            ar: 'سجل الأحداث والتشفير وما لا يمكن تغييره لاحقًا.',
            kk: 'Әрекеттер журналы, шифрлау және кейін өзгертуге келмейтіні.',
            uz: 'Harakatlar jurnali, shifrlash va keyin oʻzgartirib boʻlmaydigani.',
          },
          to: '/security',
        },
        {
          title: { ru: 'Пакетная проверка', en: 'Bulk review', de: 'Stapelprüfung', ar: 'مراجعة دفعية', kk: 'Топтама тексеру', uz: 'Paketli tekshiruv' },
          body: {
            ru: 'Когда согласовывать нужно не один договор, а пачку.',
            en: 'When it is not one contract to move but a whole batch.',
            de: 'Wenn nicht ein Vertrag ansteht, sondern ein ganzer Stapel.',
            ar: 'حين لا يكون العقد واحدًا بل دفعة كاملة.',
            kk: 'Бір шарт емес, бір топ шарт қажет болғанда.',
            uz: 'Bitta shartnoma emas, bir toʻda kerak boʻlganda.',
          },
          to: '/bulk-review',
        },
      ],
    },

    {
      kind: 'cta',
      title: { ru: 'Пусть согласование перестанет теряться в почте', en: 'Stop losing approvals in email threads', de: 'Freigaben gehen nicht mehr im Postfach verloren', ar: 'لتتوقف الموافقات عن الضياع في البريد', kk: 'Келісу поштада жоғалуын доғарсын', uz: 'Kelishuv pochtada yoʻqolishini bas qilsin' },
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
