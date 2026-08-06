/**
 * Публичная страница «Правила по пунктам» (playbooks).
 *
 * Проверено по коду 05.08.2026 (server/src/routes/playbooks.routes.ts):
 *  - правила принадлежат ВЛАДЕЛЬЦУ команды; читают все активные участники,
 *    правят владелец и участники с ролью admin/editor;
 *  - текст правила шифруется в хранилище ключом владельца;
 *  - активный плейбук загружается конвейером анализа (loadActivePlaybook
 *    в analysis.routes.ts) и отклонения от него становятся находками;
 *  - гейт 'playbooks' → Pro, Business, Enterprise.
 */
import type { PageContent } from '../types';

export const clausePlaybooks: PageContent = {
  slug: 'clause-playbooks',
  pageTitle: {
    ru: 'Правила по пунктам — Lexab',
    en: 'Clause playbooks — Lexab',
    de: 'Klausel-Playbooks — Lexab',
    ar: 'أدلة البنود — Lexab',
    kk: 'Тармақтар бойынша ережелер — Lexab',
    uz: 'Bandlar boʻyicha qoidalar — Lexab',
  },
  blocks: [
    {
      kind: 'hero',
      title: {
        ru: 'Позиции фирмы, которые проверяются сами',
        en: 'Your firm’s positions, checked automatically',
        de: 'Positionen der Kanzlei, die sich selbst prüfen',
        ar: 'مواقف مكتبك تُفحص تلقائيًا',
        kk: 'Өзі тексерілетін фирма ұстанымдары',
        uz: 'Oʻzi tekshiriladigan firma pozitsiyalari',
      },
      lead: {
        ru: 'Записываете стандартные требования вашей фирмы обычными словами: «предоплата не больше 30 %», «арбитраж только в Ташкенте», «ответственность не ограничивается суммой договора». Дальше каждый разбор договора сверяется с этими правилами, и отклонения попадают в находки — не как общее замечание, а как конкретное нарушение вашей позиции.',
        en: 'Write your firm’s standard requirements in plain words: “advance payment no more than 30%”, “arbitration in Tashkent only”, “liability not capped at the contract value”. Every contract review is then checked against these rules, and deviations surface as findings — not as a generic remark, but as a specific breach of your position.',
        de: 'Halten Sie die Standardanforderungen Ihrer Kanzlei in normalen Worten fest: „Anzahlung höchstens 30 %“, „Schiedsverfahren nur in Taschkent“, „Haftung nicht auf die Vertragssumme begrenzt“. Jede Vertragsprüfung wird dann gegen diese Regeln gehalten, und Abweichungen erscheinen als Befunde — nicht als allgemeine Bemerkung, sondern als konkreter Verstoß gegen Ihre Position.',
        ar: 'اكتب متطلبات مكتبك المعيارية بكلمات عادية: «الدفعة المقدمة لا تتجاوز 30٪»، «التحكيم في طشقند فقط»، «المسؤولية غير مقيدة بقيمة العقد». عندها تُقارَن كل مراجعة عقد بهذه القواعد، وتظهر الانحرافات كملاحظات — لا كتعليق عام بل كمخالفة محددة لموقفك.',
        kk: 'Фирмаңыздың стандартты талаптарын кәдімгі сөзбен жазасыз: «алдын ала төлем 30 %-дан аспайды», «арбитраж тек Ташкентте», «жауапкершілік шарт сомасымен шектелмейді». Әрі қарай әр шарт талдауы осы ережелермен салыстырылады, ауытқулар нақты бұзушылық ретінде табылымға түседі.',
        uz: 'Firmangizning standart talablarini oddiy soʻz bilan yozasiz: «oldindan toʻlov 30 %dan oshmasin», «arbitraj faqat Toshkentda», «javobgarlik shartnoma summasi bilan cheklanmaydi». Keyin har bir shartnoma tahlili shu qoidalar bilan solishtiriladi, chetlanishlar aniq buzilish sifatida topilmaga tushadi.',
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
          label: { ru: 'Записать первое правило', en: 'Write your first rule', de: 'Erste Regel anlegen', ar: 'اكتب قاعدتك الأولى', kk: 'Бірінші ережені жазу', uz: 'Birinchi qoidani yozish' },
          to: '/login',
          variant: 'primary',
        },
        {
          label: { ru: 'Как устроен разбор', en: 'How the review works', de: 'Wie die Prüfung abläuft', ar: 'كيف تعمل المراجعة', kk: 'Талдау қалай жұмыс істейді', uz: 'Tahlil qanday ishlaydi' },
          to: '/contract-analysis',
          variant: 'secondary',
        },
      ],
    },

    {
      kind: 'facts',
      items: [
        {
          value: { ru: '3', en: '3', de: '3', ar: '3', kk: '3', uz: '3' },
          label: { ru: 'роли с разными правами', en: 'roles with different rights', de: 'Rollen mit unterschiedlichen Rechten', ar: 'أدوار بصلاحيات مختلفة', kk: 'әртүрлі құқықты рөл', uz: 'turli huquqli rol' },
          proof: {
            ru: 'Владелец и участники с ролью «администратор» или «редактор» правят правила; «наблюдатель» только читает.',
            en: 'The owner and members with the admin or editor role edit the rules; a viewer can only read them.',
            de: 'Inhaber sowie Mitglieder mit Admin- oder Editor-Rolle bearbeiten die Regeln; Betrachter lesen nur.',
            ar: 'المالك والأعضاء بدور مسؤول أو محرر يعدّلون القواعد؛ والمشاهد يقرأ فقط.',
            kk: 'Иесі және «әкімші» немесе «редактор» рөліндегілер ережені өзгертеді; «бақылаушы» тек оқиды.',
            uz: 'Egasi va «administrator» yoki «muharrir» rolidagilar qoidani oʻzgartiradi; «kuzatuvchi» faqat oʻqiydi.',
          },
        },
        {
          value: { ru: '1', en: '1', de: '1', ar: '1', kk: '1', uz: '1' },
          label: { ru: 'активный свод правил на команду', en: 'active rule set per team', de: 'aktives Regelwerk je Team', ar: 'مجموعة قواعد فعّالة لكل فريق', kk: 'командаға бір белсенді жинақ', uz: 'jamoaga bitta faol toʻplam' },
          proof: {
            ru: 'Разбор всегда сверяется ровно с одним активным сводом — двусмысленности «а по какому правилу проверяли» не возникает.',
            en: 'A review is always checked against exactly one active set — there is never any doubt about which rules applied.',
            de: 'Eine Prüfung läuft immer gegen genau ein aktives Regelwerk — die Frage „nach welcher Regel wurde geprüft?“ stellt sich nicht.',
            ar: 'تُقارَن المراجعة دائمًا بمجموعة فعّالة واحدة بالضبط — فلا التباس حول القاعدة المطبَّقة.',
            kk: 'Талдау әрқашан дәл бір белсенді жинақпен салыстырылады — «қай ережемен тексерілді» деген күмән болмайды.',
            uz: 'Tahlil doim aynan bitta faol toʻplam bilan solishtiriladi — «qaysi qoida boʻyicha tekshirildi» degan shubha boʻlmaydi.',
          },
        },
        {
          value: { ru: 'AES-256', en: 'AES-256', de: 'AES-256', ar: 'AES-256', kk: 'AES-256', uz: 'AES-256' },
          label: { ru: 'шифрование текста правил', en: 'encryption of rule text', de: 'Verschlüsselung des Regeltexts', ar: 'تشفير نص القواعد', kk: 'ереже мәтінін шифрлау', uz: 'qoida matnini shifrlash' },
          proof: {
            ru: 'Правила фирмы — коммерческая информация: в хранилище они лежат зашифрованными ключом владельца команды.',
            en: 'A firm’s rules are commercial information: at rest they are encrypted with the team owner’s key.',
            de: 'Kanzleiregeln sind Geschäftsinformationen: Sie liegen mit dem Schlüssel der Team-Inhaberin verschlüsselt.',
            ar: 'قواعد المكتب معلومات تجارية: تُخزَّن مشفَّرة بمفتاح مالك الفريق.',
            kk: 'Фирма ережелері — коммерциялық ақпарат: қоймада команда иесінің кілтімен шифрланып жатады.',
            uz: 'Firma qoidalari — tijorat maʼlumoti: omborda jamoa egasining kaliti bilan shifrlanib yotadi.',
          },
        },
      ],
    },

    {
      kind: 'steps',
      title: { ru: 'Как это работает', en: 'How it works', de: 'So funktioniert es', ar: 'كيف يعمل', kk: 'Бұл қалай жұмыс істейді', uz: 'Bu qanday ishlaydi' },
      items: [
        {
          title: { ru: 'Формулируете правило словами', en: 'You state the rule in words', de: 'Sie formulieren die Regel in Worten', ar: 'تصوغ القاعدة بالكلمات', kk: 'Ережені сөзбен тұжырымдайсыз', uz: 'Qoidani soʻz bilan ifodalaysiz' },
          body: {
            ru: 'Никакого конструктора условий и программирования: пишете так, как объяснили бы младшему юристу.',
            en: 'No condition builder, no programming: write it the way you would explain it to a junior lawyer.',
            de: 'Kein Bedingungsbaukasten, keine Programmierung: Schreiben Sie es so, wie Sie es einer Berufsanfängerin erklären würden.',
            ar: 'لا منشئ شروط ولا برمجة: اكتبها كما تشرحها لمحامٍ مبتدئ.',
            kk: 'Ешқандай шарт құрастырушы да, бағдарламалау да жоқ: кіші заңгерге түсіндіргендей жазасыз.',
            uz: 'Hech qanday shart konstruktori ham, dasturlash ham yoʻq: kichik yuristga tushuntirgandek yozasiz.',
          },
        },
        {
          title: { ru: 'Правило становится общим для команды', en: 'The rule becomes shared across the team', de: 'Die Regel gilt teamweit', ar: 'تصبح القاعدة مشتركة للفريق', kk: 'Ереже команда үшін ортақ болады', uz: 'Qoida jamoa uchun umumiy boʻladi' },
          body: {
            ru: 'Свод принадлежит владельцу команды, поэтому новый сотрудник получает позиции фирмы сразу, а не через полгода замечаний.',
            en: 'The set belongs to the team owner, so a new hire inherits the firm’s positions at once rather than after six months of remarks.',
            de: 'Das Regelwerk gehört der Team-Inhaberin, damit neue Mitarbeitende die Positionen sofort übernehmen statt nach einem halben Jahr Korrekturen.',
            ar: 'المجموعة ملك لمالك الفريق، فيرث الموظف الجديد مواقف المكتب فورًا لا بعد نصف عام من الملاحظات.',
            kk: 'Жинақ команда иесіне тиесілі, сондықтан жаңа қызметкер фирма ұстанымын бірден алады.',
            uz: 'Toʻplam jamoa egasiga tegishli, shuning uchun yangi xodim firma pozitsiyalarini darrov oladi.',
          },
        },
        {
          title: { ru: 'Разбор сверяется со сводом', en: 'The review is checked against the set', de: 'Die Prüfung läuft gegen das Regelwerk', ar: 'تُقارَن المراجعة بالمجموعة', kk: 'Талдау жинақпен салыстырылады', uz: 'Tahlil toʻplam bilan solishtiriladi' },
          body: {
            ru: 'Активный свод подгружается в конвейер анализа автоматически — отдельную кнопку нажимать не нужно.',
            en: 'The active set is loaded into the analysis pipeline automatically — no separate button to press.',
            de: 'Das aktive Regelwerk wird automatisch in die Analyse geladen — kein zusätzlicher Klick nötig.',
            ar: 'تُحمَّل المجموعة الفعّالة في مسار التحليل تلقائيًا — دون زر إضافي.',
            kk: 'Белсенді жинақ талдау конвейеріне автоматты жүктеледі — бөлек түйме баспайсыз.',
            uz: 'Faol toʻplam tahlil konveyeriga avtomatik yuklanadi — alohida tugma bosilmaydi.',
          },
        },
        {
          title: { ru: 'Отклонение видно как находка', en: 'A deviation shows up as a finding', de: 'Eine Abweichung erscheint als Befund', ar: 'يظهر الانحراف كملاحظة', kk: 'Ауытқу табылым болып көрінеді', uz: 'Chetlanish topilma boʻlib koʻrinadi' },
          body: {
            ru: 'Не «обратите внимание на ответственность», а «пункт 9.1 ограничивает ответственность суммой договора — против правила фирмы».',
            en: 'Not “mind the liability clause”, but “clause 9.1 caps liability at the contract value — contrary to the firm’s rule”.',
            de: 'Nicht „achten Sie auf die Haftung“, sondern „Ziffer 9.1 begrenzt die Haftung auf die Vertragssumme — entgegen der Kanzleiregel“.',
            ar: 'ليس «انتبه لبند المسؤولية»، بل «البند 9.1 يقيّد المسؤولية بقيمة العقد — خلافًا لقاعدة المكتب».',
            kk: '«Жауапкершілікке назар аударыңыз» емес, «9.1-тармақ жауапкершілікті шарт сомасымен шектейді — фирма ережесіне қарсы».',
            uz: '«Javobgarlikka eʼtibor bering» emas, «9.1-band javobgarlikni shartnoma summasi bilan cheklaydi — firma qoidasiga zid».',
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
          title: { ru: 'Правило не блокирует подписание', en: 'A rule does not block signing', de: 'Eine Regel verhindert keine Unterschrift', ar: 'القاعدة لا تمنع التوقيع', kk: 'Ереже қол қоюды бөгемейді', uz: 'Qoida imzolashni toʻsmaydi' },
          body: {
            ru: 'Это подсказка юристу, а не запрет в системе. Решение остаётся за человеком.',
            en: 'It is a prompt for the lawyer, not a system-level prohibition. The decision stays with a person.',
            de: 'Es ist ein Hinweis für die Juristin, kein Systemverbot. Die Entscheidung bleibt beim Menschen.',
            ar: 'إنها تنبيه للمحامي لا منع من النظام. القرار يبقى للإنسان.',
            kk: 'Бұл — заңгерге кеңес, жүйедегі тыйым емес. Шешім адамда қалады.',
            uz: 'Bu — yuristga maslahat, tizimdagi taqiq emas. Qaror insonda qoladi.',
          },
        },
        {
          title: { ru: 'Правила — не текст закона', en: 'Rules are not statutory text', de: 'Regeln sind kein Gesetzestext', ar: 'القواعد ليست نص قانون', kk: 'Ережелер — заң мәтіні емес', uz: 'Qoidalar — qonun matni emas' },
          body: {
            ru: 'Свод фирмы отвечает на вопрос «чего мы обычно требуем», а не «что требует закон». Второе проверяется по базе законов отдельно.',
            en: 'A firm’s set answers “what do we usually require”, not “what does the law require”. The latter is checked against the legal base separately.',
            de: 'Ein Kanzleiregelwerk beantwortet „Was fordern wir üblicherweise?“, nicht „Was fordert das Gesetz?“. Letzteres prüft die Gesetzesbasis gesondert.',
            ar: 'مجموعة المكتب تجيب «ماذا نشترط عادة» لا «ماذا يشترط القانون». والثاني يُفحص عبر قاعدة القوانين على حدة.',
            kk: 'Фирма жинағы «біз әдетте нені талап етеміз» дегенге жауап береді, «заң нені талап етеді» дегенге емес. Соңғысы заң базасы бойынша бөлек тексеріледі.',
            uz: 'Firma toʻplami «biz odatda nimani talab qilamiz» degan savolga javob beradi, «qonun nimani talab qiladi» degani emas. Ikkinchisi qonunlar bazasi boʻyicha alohida tekshiriladi.',
          },
        },
      ],
    },

    {
      kind: 'faq',
      title: { ru: 'Частые вопросы', en: 'Frequently asked questions', de: 'Häufige Fragen', ar: 'أسئلة متكررة', kk: 'Жиі қойылатын сұрақтар', uz: 'Koʻp beriladigan savollar' },
      items: [
        {
          q: { ru: 'Видит ли мои правила кто-то за пределами команды?', en: 'Can anyone outside my team see my rules?', de: 'Sieht jemand außerhalb meines Teams meine Regeln?', ar: 'هل يرى أحد خارج فريقي قواعدي؟', kk: 'Ережелерімді командадан тыс біреу көре ме?', uz: 'Qoidalarimni jamoadan tashqarida kimdir koʻradimi?' },
          a: {
            ru: 'Нет. Свод принадлежит владельцу команды, читают его только активные участники этой команды, а текст правил лежит в базе зашифрованным.',
            en: 'No. The set belongs to the team owner, only active members of that team can read it, and the rule text is stored encrypted.',
            de: 'Nein. Das Regelwerk gehört der Team-Inhaberin, nur aktive Mitglieder dieses Teams lesen es, und der Text liegt verschlüsselt.',
            ar: 'لا. المجموعة ملك لمالك الفريق، ويقرؤها أعضاؤه النشطون فقط، ونص القواعد مخزَّن مشفَّرًا.',
            kk: 'Жоқ. Жинақ команда иесіне тиесілі, оны тек осы команданың белсенді мүшелері оқиды, ереже мәтіні шифрланып жатады.',
            uz: 'Yoʻq. Toʻplam jamoa egasiga tegishli, uni faqat shu jamoaning faol aʼzolari oʻqiydi, qoida matni shifrlanib yotadi.',
          },
        },
        {
          q: { ru: 'Сколько правил имеет смысл заводить?', en: 'How many rules make sense?', de: 'Wie viele Regeln sind sinnvoll?', ar: 'كم قاعدة يُجدي إنشاؤها؟', kk: 'Қанша ереже жасаған жөн?', uz: 'Nechta qoida tuzish maʼqul?' },
          a: {
            ru: 'Начните с тех, из-за которых чаще всего спорите с контрагентами: предоплата, ответственность, подсудность, срок расторжения. Список удобнее растить по мере разборов, чем писать сразу целиком.',
            en: 'Start with the ones you argue about most often: advance payment, liability, jurisdiction, termination notice. It is easier to grow the list as reviews come in than to write it all at once.',
            de: 'Beginnen Sie mit den Punkten, über die Sie am häufigsten streiten: Anzahlung, Haftung, Gerichtsstand, Kündigungsfrist. Die Liste wächst leichter mit den Prüfungen, als dass man sie auf einmal schreibt.',
            ar: 'ابدأ بما تختلف عليه غالبًا: الدفعة المقدمة، والمسؤولية، والاختصاص، ومهلة الإنهاء. تنمية القائمة مع المراجعات أسهل من كتابتها دفعة واحدة.',
            kk: 'Контрагенттермен жиі дауласатындарыңыздан бастаңыз: алдын ала төлем, жауапкершілік, соттылық, бұзу мерзімі. Тізімді талдаулар барысында өсіру оңайырақ.',
            uz: 'Kontragentlar bilan koʻp bahslashadiganlaringizdan boshlang: oldindan toʻlov, javobgarlik, sudlov, bekor qilish muddati. Roʻyxatni tahlillar davomida oʻstirish osonroq.',
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
            ru: 'Куда попадают отклонения от ваших правил и как они выглядят.',
            en: 'Where deviations from your rules end up and how they look.',
            de: 'Wohin Abweichungen von Ihren Regeln gelangen und wie sie aussehen.',
            ar: 'أين تنتهي الانحرافات عن قواعدك وكيف تبدو.',
            kk: 'Ережелеріңізден ауытқулар қайда түседі және қалай көрінеді.',
            uz: 'Qoidalaringizdan chetlanishlar qayerga tushadi va qanday koʻrinadi.',
          },
          to: '/contract-analysis',
        },
        {
          title: { ru: 'Доступы в команде', en: 'Team access', de: 'Teamzugriff', ar: 'صلاحيات الفريق', kk: 'Командадағы рұқсаттар', uz: 'Jamoadagi ruxsatlar' },
          body: {
            ru: 'Кто в команде может править правила, а кто только читать.',
            en: 'Who in the team may edit the rules and who may only read them.',
            de: 'Wer im Team Regeln bearbeiten darf und wer nur liest.',
            ar: 'من في الفريق يعدّل القواعد ومن يقرأ فقط.',
            kk: 'Командада ережені кім өзгерте алады, кім тек оқиды.',
            uz: 'Jamoada qoidani kim oʻzgartira oladi, kim faqat oʻqiydi.',
          },
          to: '/team-access',
        },
        {
          title: { ru: 'Шаблоны договоров', en: 'Contract templates', de: 'Vertragsvorlagen', ar: 'قوالب العقود', kk: 'Шарт үлгілері', uz: 'Shartnoma shablonlari' },
          body: {
            ru: 'Закрепить те же позиции в собственных заготовках документов.',
            en: 'Lock the same positions into your own document starters.',
            de: 'Dieselben Positionen in eigenen Dokumentvorlagen verankern.',
            ar: 'ثبّت المواقف نفسها في قوالبك الخاصة.',
            kk: 'Сол ұстанымдарды өз құжат дайындамаларыңызда бекіту.',
            uz: 'Oʻsha pozitsiyalarni oʻz hujjat zagotovkalaringizda mustahkamlash.',
          },
          to: '/contract-templates',
        },
      ],
    },

    {
      kind: 'cta',
      title: { ru: 'Перестаньте повторять одно и то же в правках', en: 'Stop repeating the same redlines', de: 'Hören Sie auf, dieselben Änderungen zu wiederholen', ar: 'كفَّ عن تكرار التعديلات نفسها', kk: 'Түзетулерде бірдей нәрсені қайталауды доғарыңыз', uz: 'Tuzatishlarda bir xil narsani takrorlashni bas qiling' },
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
