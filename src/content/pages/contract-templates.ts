/**
 * Публичная страница «Шаблоны договоров».
 *
 * Проверено по коду 05.08.2026 (server/src/routes/templates.routes.ts):
 *  - GET /templates?category — общая библиотека шаблонов по категориям;
 *  - POST /templates/:id/generate — черновик по шаблону и заполненной форме,
 *    расходует одно обращение к ИИ;
 *  - гейт 'templates' → Standard, Pro, Business, Enterprise (на Free закрыт);
 *  - свои сохранённые шаблоны хранятся зашифрованными (encText/decTextStrict).
 */
import type { PageContent } from '../types';

export const contractTemplates: PageContent = {
  slug: 'contract-templates',
  pageTitle: {
    ru: 'Шаблоны договоров — Lexab',
    en: 'Contract templates — Lexab',
    de: 'Vertragsvorlagen — Lexab',
    ar: 'قوالب العقود — Lexab',
    kk: 'Шарт үлгілері — Lexab',
    uz: 'Shartnoma shablonlari — Lexab',
  },
  blocks: [
    {
      kind: 'hero',
      title: {
        ru: 'Черновик договора из шаблона',
        en: 'A contract draft from a template',
        de: 'Vertragsentwurf aus einer Vorlage',
        ar: 'مسودة عقد من قالب',
        kk: 'Үлгіден шарт жобасы',
        uz: 'Shablondan shartnoma loyihasi',
      },
      lead: {
        ru: 'Выбираете шаблон из библиотеки, заполняете короткую форму — стороны, предмет, сроки, суммы — и получаете готовый черновик, который дальше можно сразу отправить на разбор и правку. Свои удачные формулировки сохраняются как собственные шаблоны и хранятся зашифрованными.',
        en: 'Pick a template from the library, fill in a short form — parties, subject, deadlines, amounts — and get a ready draft you can send straight into review and redlining. Your own successful wordings are saved as personal templates and stored encrypted.',
        de: 'Wählen Sie eine Vorlage aus der Bibliothek, füllen Sie ein kurzes Formular aus — Parteien, Gegenstand, Fristen, Beträge — und erhalten Sie einen fertigen Entwurf, den Sie direkt in Prüfung und Überarbeitung geben können. Eigene bewährte Formulierungen werden als persönliche Vorlagen verschlüsselt gespeichert.',
        ar: 'اختر قالبًا من المكتبة، واملأ نموذجًا قصيرًا — الأطراف والموضوع والمواعيد والمبالغ — واحصل على مسودة جاهزة يمكن إرسالها مباشرة إلى المراجعة والتعديل. وصياغاتك الناجحة تُحفَظ كقوالب خاصة ومشفَّرة.',
        kk: 'Кітапханадан үлгі таңдайсыз, қысқа форманы толтырасыз — тараптар, мәні, мерзімдер, сомалар — және дайын жобаны аласыз, оны бірден талдауға және түзетуге жіберуге болады. Өз сәтті тұжырымдарыңыз жеке үлгі ретінде шифрланып сақталады.',
        uz: 'Kutubxonadan shablon tanlaysiz, qisqa shaklni toʻldirasiz — tomonlar, predmet, muddatlar, summalar — va tayyor loyihani olasiz, uni darrov tahlil va tuzatishga yuborish mumkin. Oʻz muvaffaqiyatli iboralaringiz shaxsiy shablon sifatida shifrlanib saqlanadi.',
      },
      planNote: {
        ru: 'Доступно на платных тарифах: Standard, Pro и Business. На бесплатном закрыто.',
        en: 'Available on paid plans: Standard, Pro and Business. Closed on the free plan.',
        de: 'In den kostenpflichtigen Tarifen: Standard, Pro und Business. Im kostenlosen gesperrt.',
        ar: 'متاحة في الباقات المدفوعة: Standard وPro وBusiness. مغلقة في المجانية.',
        kk: 'Ақылы тарифтерде: Standard, Pro және Business. Тегінде жабық.',
        uz: 'Pullik tariflarda: Standard, Pro va Business. Bepulida yopiq.',
      },
      cta: [
        {
          label: { ru: 'Собрать черновик', en: 'Build a draft', de: 'Entwurf erstellen', ar: 'أنشئ مسودة', kk: 'Жоба жасау', uz: 'Loyiha tuzish' },
          to: '/login',
          variant: 'primary',
        },
        {
          label: { ru: 'Правила по пунктам', en: 'Clause playbooks', de: 'Klausel-Playbooks', ar: 'أدلة البنود', kk: 'Тармақтар бойынша ережелер', uz: 'Bandlar boʻyicha qoidalar' },
          to: '/clause-playbooks',
          variant: 'secondary',
        },
      ],
    },

    {
      kind: 'facts',
      items: [
        {
          value: { ru: '1', en: '1', de: '1', ar: '1', kk: '1', uz: '1' },
          label: { ru: 'обращение к ИИ на черновик', en: 'AI request per draft', de: 'KI-Anfrage je Entwurf', ar: 'طلب ذكاء اصطناعي لكل مسودة', kk: 'жобаға бір ИИ сұрауы', uz: 'loyihaga bitta AI soʻrovi' },
          proof: {
            ru: 'Считается из общего месячного лимита тарифа. Неудачная попытка лимит не расходует.',
            en: 'Counted against the plan’s shared monthly allowance. A failed attempt does not consume it.',
            de: 'Zählt auf das gemeinsame Monatskontingent des Tarifs. Ein Fehlversuch verbraucht nichts.',
            ar: 'تُحتسب من الحصة الشهرية المشتركة للباقة. والمحاولة الفاشلة لا تستهلك شيئًا.',
            kk: 'Тарифтің жалпы айлық лимитінен есептеледі. Сәтсіз әрекет лимитті жұмсамайды.',
            uz: 'Tarifning umumiy oylik limitidan hisoblanadi. Muvaffaqiyatsiz urinish limitni sarflamaydi.',
          },
        },
        {
          value: { ru: '6', en: '6', de: '6', ar: '6', kk: '6', uz: '6' },
          label: { ru: 'языков интерфейса', en: 'interface languages', de: 'Oberflächensprachen', ar: 'لغات الواجهة', kk: 'интерфейс тілі', uz: 'interfeys tili' },
          proof: {
            ru: 'Форма и подсказки переведены полностью, включая арабский с письмом справа налево.',
            en: 'Form and hints are fully translated, including Arabic with right-to-left layout.',
            de: 'Formular und Hinweise sind vollständig übersetzt, inklusive Arabisch von rechts nach links.',
            ar: 'النموذج والتلميحات مترجمة بالكامل، بما فيها العربية من اليمين إلى اليسار.',
            kk: 'Форма мен нұсқаулар толық аударылған, оңнан солға жазылатын арабты қоса.',
            uz: 'Shakl va maslahatlar toʻliq tarjima qilingan, oʻngdan chapga yoziladigan arabni ham qoʻshib.',
          },
        },
        {
          value: { ru: 'AES-256', en: 'AES-256', de: 'AES-256', ar: 'AES-256', kk: 'AES-256', uz: 'AES-256' },
          label: { ru: 'шифрование ваших шаблонов', en: 'encryption of your templates', de: 'Verschlüsselung Ihrer Vorlagen', ar: 'تشفير قوالبك', kk: 'үлгілеріңізді шифрлау', uz: 'shablonlaringizni shifrlash' },
          proof: {
            ru: 'Текст сохранённого шаблона шифруется ключом вашей учётной записи — как и текст договоров.',
            en: 'The text of a saved template is encrypted with your account key — just like contract text.',
            de: 'Der Text einer gespeicherten Vorlage wird mit Ihrem Kontoschlüssel verschlüsselt — wie Vertragstext.',
            ar: 'نص القالب المحفوظ مُشفَّر بمفتاح حسابك — تمامًا كنص العقود.',
            kk: 'Сақталған үлгі мәтіні тіркелгіңіздің кілтімен шифрланады — шарт мәтіні сияқты.',
            uz: 'Saqlangan shablon matni hisobingiz kaliti bilan shifrlanadi — shartnoma matni kabi.',
          },
        },
      ],
    },

    {
      kind: 'steps',
      title: { ru: 'Как это работает', en: 'How it works', de: 'So funktioniert es', ar: 'كيف يعمل', kk: 'Бұл қалай жұмыс істейді', uz: 'Bu qanday ishlaydi' },
      items: [
        {
          title: { ru: 'Выбираете категорию', en: 'You pick a category', de: 'Sie wählen eine Kategorie', ar: 'تختار فئة', kk: 'Санатты таңдайсыз', uz: 'Toifani tanlaysiz' },
          body: {
            ru: 'Библиотека разбита по типам договоров, чтобы не листать всё подряд.',
            en: 'The library is split by contract type so you do not scroll through everything.',
            de: 'Die Bibliothek ist nach Vertragsarten gegliedert, damit Sie nicht alles durchblättern.',
            ar: 'المكتبة مقسَّمة بحسب نوع العقد كي لا تتصفح كل شيء.',
            kk: 'Кітапхана шарт түрлері бойынша бөлінген — бәрін ақтарудың қажеті жоқ.',
            uz: 'Kutubxona shartnoma turlari boʻyicha boʻlingan — hammasini varaqlash shart emas.',
          },
        },
        {
          title: { ru: 'Заполняете форму', en: 'You fill in the form', de: 'Sie füllen das Formular aus', ar: 'تملأ النموذج', kk: 'Форманы толтырасыз', uz: 'Shaklni toʻldirasiz' },
          body: {
            ru: 'Стороны, предмет, суммы, сроки, применимое право. Поля у каждого шаблона свои.',
            en: 'Parties, subject, amounts, deadlines, governing law. Each template has its own fields.',
            de: 'Parteien, Gegenstand, Beträge, Fristen, anwendbares Recht. Jede Vorlage hat eigene Felder.',
            ar: 'الأطراف والموضوع والمبالغ والمواعيد والقانون الواجب التطبيق. لكل قالب حقوله.',
            kk: 'Тараптар, мәні, сомалар, мерзімдер, қолданылатын құқық. Әр үлгінің өз өрістері бар.',
            uz: 'Tomonlar, predmet, summalar, muddatlar, qoʻllaniladigan huquq. Har bir shablonning oʻz maydonlari.',
          },
        },
        {
          title: { ru: 'Получаете черновик', en: 'You get a draft', de: 'Sie erhalten einen Entwurf', ar: 'تحصل على مسودة', kk: 'Жобаны аласыз', uz: 'Loyihani olasiz' },
          body: {
            ru: 'Текст собирается с учётом ваших ответов, а не подставляется механически в пропуски.',
            en: 'The text is composed from your answers rather than mechanically pasted into blanks.',
            de: 'Der Text entsteht aus Ihren Angaben, statt mechanisch in Lücken eingesetzt zu werden.',
            ar: 'يُصاغ النص من إجاباتك بدل لصقه آليًا في الفراغات.',
            kk: 'Мәтін жауаптарыңыз ескеріліп құрылады, бос орындарға механикалық қойылмайды.',
            uz: 'Matn javoblaringiz asosida quriladi, boʻsh joylarga mexanik qoʻyilmaydi.',
          },
        },
        {
          title: { ru: 'Сразу отправляете на разбор', en: 'You send it straight to review', de: 'Sie geben ihn direkt in die Prüfung', ar: 'ترسلها مباشرة إلى المراجعة', kk: 'Бірден талдауға жібересіз', uz: 'Darrov tahlilga yuborasiz' },
          body: {
            ru: 'Черновик — это обычный документ в кабинете: к нему применимы разбор по пунктам, вопросы и согласование.',
            en: 'A draft is an ordinary document in your workspace: clause review, questions and approvals all apply to it.',
            de: 'Ein Entwurf ist ein normales Dokument im Arbeitsbereich: Klauselprüfung, Fragen und Freigaben gelten dafür.',
            ar: 'المسودة مستند عادي في مساحتك: تنطبق عليها مراجعة البنود والأسئلة والموافقات.',
            kk: 'Жоба — кабинеттегі кәдімгі құжат: оған тармақ талдауы, сұрақтар және келісу қолданылады.',
            uz: 'Loyiha — kabinetdagi oddiy hujjat: unga band tahlili, savollar va kelishuv qoʻllanadi.',
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
          title: { ru: 'Черновик — не готовый к подписи документ', en: 'A draft is not a signature-ready document', de: 'Ein Entwurf ist kein unterschriftsreifes Dokument', ar: 'المسودة ليست مستندًا جاهزًا للتوقيع', kk: 'Жоба — қол қоюға дайын құжат емес', uz: 'Loyiha — imzoga tayyor hujjat emas' },
          body: {
            ru: 'Его нужно прочитать и выверить под конкретную сделку. Мы даём основу, а не подпись под ней.',
            en: 'It must be read and adjusted to the specific deal. We provide the basis, not the endorsement of it.',
            de: 'Er muss gelesen und auf das konkrete Geschäft zugeschnitten werden. Wir liefern die Grundlage, nicht die Freigabe.',
            ar: 'يجب قراءتها وضبطها على الصفقة المحددة. نحن نقدم الأساس لا الإقرار به.',
            kk: 'Оны оқып, нақты мәмілеге қарай түзету керек. Біз негіз береміз, оған қол емес.',
            uz: 'Uni oʻqib, aniq bitimga moslash kerak. Biz asos beramiz, unga imzo emas.',
          },
        },
        {
          title: { ru: 'Электронной подписи в продукте нет', en: 'There is no e-signature in the product', de: 'Eine elektronische Signatur gibt es nicht', ar: 'لا يوجد توقيع إلكتروني في المنتج', kk: 'Өнімде электрондық қолтаңба жоқ', uz: 'Mahsulotda elektron imzo yoʻq' },
          body: {
            ru: 'Раздел выключен. Подписывать договор нужно вашим обычным способом.',
            en: 'The section is switched off. Sign the contract the way you normally do.',
            de: 'Der Bereich ist abgeschaltet. Unterschreiben Sie den Vertrag wie gewohnt.',
            ar: 'القسم مُعطَّل. وقّع العقد بالطريقة التي تعتمدها عادة.',
            kk: 'Бөлім өшірілген. Шартқа әдеттегі тәсіліңізбен қол қойыңыз.',
            uz: 'Boʻlim oʻchirilgan. Shartnomani odatdagi usulingizda imzolang.',
          },
        },
      ],
    },

    {
      kind: 'faq',
      title: { ru: 'Частые вопросы', en: 'Frequently asked questions', de: 'Häufige Fragen', ar: 'أسئلة متكررة', kk: 'Жиі қойылатын сұрақтар', uz: 'Koʻp beriladigan savollar' },
      items: [
        {
          q: { ru: 'Можно ли загрузить свой шаблон?', en: 'Can I upload my own template?', de: 'Kann ich eine eigene Vorlage hinterlegen?', ar: 'هل يمكنني رفع قالبي الخاص؟', kk: 'Өз үлгімді жүктеуге бола ма?', uz: 'Oʻz shablonimni yuklash mumkinmi?' },
          a: {
            ru: 'Да, свои формулировки сохраняются как ваши шаблоны и доступны только вам и вашей команде. Их текст шифруется в хранилище.',
            en: 'Yes, your wordings are saved as your own templates, visible only to you and your team. Their text is encrypted at rest.',
            de: 'Ja, eigene Formulierungen werden als Ihre Vorlagen gespeichert und sind nur Ihnen und Ihrem Team zugänglich. Der Text liegt verschlüsselt.',
            ar: 'نعم، تُحفَظ صياغاتك كقوالب خاصة بك ومتاحة لك ولفريقك فقط. ونصها مشفَّر في التخزين.',
            kk: 'Иә, өз тұжырымдарыңыз жеке үлгі ретінде сақталады және тек сізге әрі командаңызға қолжетімді. Мәтіні шифрланады.',
            uz: 'Ha, oʻz iboralaringiz shaxsiy shablon sifatida saqlanadi va faqat sizga hamda jamoangizga koʻrinadi. Matni shifrlanadi.',
          },
        },
        {
          q: { ru: 'Учитывает ли черновик право моей страны?', en: 'Does the draft take my country’s law into account?', de: 'Berücksichtigt der Entwurf das Recht meines Landes?', ar: 'هل تراعي المسودة قانون بلدي؟', kk: 'Жоба еліміздің құқығын ескере ме?', uz: 'Loyiha davlatim huquqini hisobga oladimi?' },
          a: {
            ru: 'Черновик собирается по вашим ответам, включая применимое право. Проверить его против текста законов можно следующим шагом — разбором договора, где ссылки на нормы сверяются с базой.',
            en: 'The draft is composed from your answers, including the governing law. You can check it against statutory text in the next step — the contract review, where citations are matched against the base.',
            de: 'Der Entwurf entsteht aus Ihren Angaben, einschließlich des anwendbaren Rechts. Prüfen lässt er sich im nächsten Schritt — in der Vertragsprüfung, wo Fundstellen mit der Basis abgeglichen werden.',
            ar: 'تُصاغ المسودة من إجاباتك بما فيها القانون الواجب التطبيق. ويمكن فحصها في الخطوة التالية — مراجعة العقد حيث تُطابق الإحالات مع القاعدة.',
            kk: 'Жоба жауаптарыңыз бойынша, қолданылатын құқықты қоса құрылады. Оны келесі қадамда — сілтемелер базамен салыстырылатын шарт талдауында тексеруге болады.',
            uz: 'Loyiha javoblaringiz asosida, qoʻllaniladigan huquqni ham qoʻshib quriladi. Uni keyingi qadamda — havolalar baza bilan solishtiriladigan shartnoma tahlilida tekshirish mumkin.',
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
            ru: 'Проверить собранный черновик по пунктам со ссылками на нормы.',
            en: 'Check the assembled draft clause by clause with statutory citations.',
            de: 'Den erstellten Entwurf klauselweise mit Gesetzesverweisen prüfen.',
            ar: 'افحص المسودة بندًا بندًا مع إحالات قانونية.',
            kk: 'Жиналған жобаны тармақ бойынша, нормаларға сілтемелермен тексеру.',
            uz: 'Tuzilgan loyihani band boʻyicha, normalarga havolalar bilan tekshirish.',
          },
          to: '/contract-analysis',
        },
        {
          title: { ru: 'Правила по пунктам', en: 'Clause playbooks', de: 'Klausel-Playbooks', ar: 'أدلة البنود', kk: 'Тармақтар бойынша ережелер', uz: 'Bandlar boʻyicha qoidalar' },
          body: {
            ru: 'Зафиксировать позиции фирмы, чтобы отклонения ловились автоматически.',
            en: 'Fix the firm’s positions so deviations are caught automatically.',
            de: 'Positionen der Kanzlei festhalten, damit Abweichungen automatisch auffallen.',
            ar: 'ثبّت مواقف المكتب لتُرصد الانحرافات تلقائيًا.',
            kk: 'Фирма ұстанымдарын бекітіп, ауытқулар автоматты ұсталсын.',
            uz: 'Firma pozitsiyalarini belgilab, chetlanishlar avtomatik ushlansin.',
          },
          to: '/clause-playbooks',
        },
        {
          title: { ru: 'Согласования и сроки', en: 'Approvals & deadlines', de: 'Freigaben und Fristen', ar: 'الموافقات والمواعيد', kk: 'Келісулер мен мерзімдер', uz: 'Kelishuvlar va muddatlar' },
          body: {
            ru: 'Провести черновик по цепочке согласующих с напоминанием о просрочке.',
            en: 'Route the draft through an approval chain with reminders when a step is overdue.',
            de: 'Den Entwurf durch eine Freigabekette führen, mit Erinnerung bei Fristablauf.',
            ar: 'مرِّر المسودة عبر سلسلة موافقات مع تذكير عند التأخر.',
            kk: 'Жобаны келісушілер тізбегінен өткізу, мерзімі өткенде еске салумен.',
            uz: 'Loyihani kelishuvchilar zanjiridan oʻtkazish, muddat oʻtganda eslatma bilan.',
          },
          to: '/approvals-and-deadlines',
        },
      ],
    },

    {
      kind: 'cta',
      title: { ru: 'Начните с готовой основы', en: 'Start from a ready basis', de: 'Mit fertiger Grundlage starten', ar: 'ابدأ من أساس جاهز', kk: 'Дайын негізден бастаңыз', uz: 'Tayyor asosdan boshlang' },
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
