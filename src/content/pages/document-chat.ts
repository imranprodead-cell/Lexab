/**
 * Публичная страница «Вопросы по документу».
 *
 * Проверено по коду 05.08.2026:
 *  - гейта по тарифу у чата НЕТ (server/src/lib/limits.ts → FEATURE_MIN_PLAN),
 *    расходуется общий месячный лимит обращений к ИИ: Free 20, Standard 100,
 *    Pro 500, Business 10 000;
 *  - к каждому вопросу подмешиваются 5 норм юрисдикции чата
 *    (chats.routes.ts: retrieveLegalContext … topK: 5);
 *  - цитаты проверяются тем же кодом, что и в разборе (validate-citations.ts).
 * Ничего про судебную практику и про «правовую консультацию» не обещаем.
 */
import type { PageContent } from '../types';

export const documentChat: PageContent = {
  slug: 'document-chat',
  pageTitle: {
    ru: 'Вопросы по документу — Lexab',
    en: 'Document Q&A — Lexab',
    de: 'Fragen zum Dokument — Lexab',
    ar: 'أسئلة عن المستند — Lexab',
    kk: 'Құжат бойынша сұрақтар — Lexab',
    uz: 'Hujjat boʻyicha savollar — Lexab',
  },
  blocks: [
    {
      kind: 'hero',
      title: {
        ru: 'Вопросы по договору со ссылками на нормы',
        en: 'Ask your contract, get answers with citations',
        de: 'Fragen zum Vertrag mit Normverweisen',
        ar: 'أسئلة عن العقد بإحالات إلى النصوص',
        kk: 'Шарт бойынша сұрақтар, нормаларға сілтемелермен',
        uz: 'Shartnoma boʻyicha savollar, normalarga havolalar bilan',
      },
      lead: {
        ru: 'Спрашиваете обычными словами — «чем грозит пункт 7.2», «кто платит при досрочном расторжении». Ответ строится по тексту вашего документа, а к вопросу подмешиваются пять норм из законодательства выбранной юрисдикции. Ссылки на нормы проверяются тем же кодом, что и в разборе договора.',
        en: 'Ask in plain words — “what does clause 7.2 expose us to”, “who pays on early termination”. The answer is built from the text of your document, and five provisions from the chosen jurisdiction are added to the question. Citations are validated by the same code as in the contract review.',
        de: 'Fragen Sie in normalen Worten — „Was droht uns aus Ziffer 7.2?“, „Wer zahlt bei vorzeitiger Kündigung?“. Die Antwort entsteht aus dem Text Ihres Dokuments, und der Frage werden fünf Normen der gewählten Rechtsordnung beigegeben. Fundstellen prüft derselbe Code wie in der Vertragsprüfung.',
        ar: 'اسأل بكلمات عادية — «ماذا يعرّضنا له البند 7.2»، «من يدفع عند الإنهاء المبكر». تُبنى الإجابة من نص مستندك، ويُضاف إلى السؤال خمسة نصوص من تشريع الولاية المختارة. وتُتحقَّق الإحالات بالشيفرة نفسها المستخدمة في مراجعة العقد.',
        kk: 'Кәдімгі сөзбен сұрайсыз — «7.2-тармақ немен қауіпті», «мерзімінен бұрын бұзғанда кім төлейді». Жауап құжатыңыздың мәтіні бойынша құрылады, ал сұраққа таңдалған юрисдикцияның бес нормасы қосылады. Сілтемелерді шарт талдауындағы код тексереді.',
        uz: 'Oddiy soʻz bilan soʻraysiz — «7.2-band nima bilan xavfli», «muddatidan oldin bekor qilinganda kim toʻlaydi». Javob hujjatingiz matni asosida quriladi, savolga esa tanlangan yurisdiksiyaning beshta normasi qoʻshiladi. Havolalarni shartnoma tahlilidagi kod tekshiradi.',
      },
      planNote: {
        ru: 'На всех тарифах, включая бесплатный. Расходуется общий месячный лимит обращений к ИИ: 20 на Free, 100 на Standard, 500 на Pro, 10 000 на Business.',
        en: 'On every plan, including the free one. It consumes the shared monthly AI allowance: 20 on Free, 100 on Standard, 500 on Pro, 10,000 on Business.',
        de: 'In allen Tarifen, auch im kostenlosen. Es zählt auf das gemeinsame KI-Monatskontingent: 20 bei Free, 100 bei Standard, 500 bei Pro, 10 000 bei Business.',
        ar: 'في جميع الباقات، بما فيها المجانية. تُحتسب من حصة الذكاء الاصطناعي الشهرية المشتركة: 20 في Free، و100 في Standard، و500 في Pro، و10٬000 في Business.',
        kk: 'Барлық тарифте, тегінін қоса. Жалпы айлық ИИ лимиті жұмсалады: Free 20, Standard 100, Pro 500, Business 10 000.',
        uz: 'Barcha tariflarda, bepulini ham qoʻshib. Umumiy oylik AI limiti sarflanadi: Free 20, Standard 100, Pro 500, Business 10 000.',
      },
      cta: [
        {
          label: { ru: 'Задать первый вопрос', en: 'Ask your first question', de: 'Erste Frage stellen', ar: 'اطرح سؤالك الأول', kk: 'Бірінші сұрақты қою', uz: 'Birinchi savolni berish' },
          to: '/login',
          variant: 'primary',
        },
        {
          label: { ru: 'На чём основаны ответы', en: 'What the answers rest on', de: 'Worauf die Antworten beruhen', ar: 'على ماذا تستند الإجابات', kk: 'Жауаптар неге негізделген', uz: 'Javoblar nimaga asoslanadi' },
          to: '/legal-base',
          variant: 'secondary',
        },
      ],
    },

    {
      kind: 'facts',
      items: [
        {
          value: { ru: '5', en: '5', de: '5', ar: '5', kk: '5', uz: '5' },
          label: { ru: 'норм подмешивается к каждому вопросу', en: 'provisions added to every question', de: 'Normen je Frage beigegeben', ar: 'نصوص تُضاف لكل سؤال', kk: 'норма әр сұраққа қосылады', uz: 'norma har bir savolga qoʻshiladi' },
          proof: {
            ru: 'Поиск идёт по корпусу той юрисдикции, которую вы выбрали для этого диалога.',
            en: 'The search runs over the corpus of the jurisdiction you selected for this conversation.',
            de: 'Gesucht wird im Korpus der Rechtsordnung, die Sie für dieses Gespräch gewählt haben.',
            ar: 'يجري البحث في مجموعة الولاية القضائية التي اخترتها لهذه المحادثة.',
            kk: 'Іздеу осы диалог үшін таңдаған юрисдикцияңыздың корпусы бойынша жүреді.',
            uz: 'Qidiruv ushbu suhbat uchun tanlagan yurisdiksiyangiz korpusi boʻyicha ketadi.',
          },
        },
        {
          value: { ru: '6', en: '6', de: '6', ar: '6', kk: '6', uz: '6' },
          label: { ru: 'языков вопроса и ответа', en: 'languages for question and answer', de: 'Sprachen für Frage und Antwort', ar: 'لغات للسؤال والجواب', kk: 'сұрақ пен жауап тілі', uz: 'savol va javob tili' },
          proof: {
            ru: 'Русский, английский, немецкий, арабский, казахский, узбекский — включая направление письма справа налево.',
            en: 'Russian, English, German, Arabic, Kazakh, Uzbek — right-to-left layout included.',
            de: 'Russisch, Englisch, Deutsch, Arabisch, Kasachisch, Usbekisch — samt Rechts-nach-links-Darstellung.',
            ar: 'الروسية والإنجليزية والألمانية والعربية والكازاخية والأوزبكية — مع اتجاه الكتابة من اليمين إلى اليسار.',
            kk: 'Орыс, ағылшын, неміс, араб, қазақ, өзбек — оңнан солға жазу бағытын қоса.',
            uz: 'Rus, ingliz, nemis, arab, qozoq, oʻzbek — oʻngdan chapga yozuv yoʻnalishi bilan.',
          },
        },
        {
          value: { ru: '«не проверено»', en: '“unverified”', de: '„nicht geprüft“', ar: '«غير مُتحقَّق منه»', kk: '«тексерілмеген»', uz: '«tekshirilmagan»' },
          label: { ru: 'метка неподтверждённой ссылки', en: 'label for an unconfirmed citation', de: 'Kennzeichen unbestätigter Fundstellen', ar: 'وسم الإحالة غير المؤكدة', kk: 'расталмаған сілтеме белгісі', uz: 'tasdiqlanmagan havola belgisi' },
          proof: {
            ru: 'Ссылка, которой нет в базе законов, не выдаётся за факт — она видна, но помечена.',
            en: 'A citation absent from the legal base is not presented as fact — it stays visible but flagged.',
            de: 'Eine Fundstelle, die in der Gesetzesbasis fehlt, gilt nicht als Tatsache — sie bleibt sichtbar, aber markiert.',
            ar: 'الإحالة غير الموجودة في قاعدة القوانين لا تُقدَّم كحقيقة — تبقى ظاهرة لكن موسومة.',
            kk: 'Заң базасында жоқ сілтеме факт ретінде берілмейді — көрінеді, бірақ белгіленген.',
            uz: 'Qonunlar bazasida yoʻq havola fakt sifatida berilmaydi — koʻrinadi, ammo belgilangan.',
          },
        },
      ],
    },

    {
      kind: 'steps',
      title: {
        ru: 'Как это работает',
        en: 'How it works',
        de: 'So funktioniert es',
        ar: 'كيف يعمل',
        kk: 'Бұл қалай жұмыс істейді',
        uz: 'Bu qanday ishlaydi',
      },
      items: [
        {
          title: { ru: 'Загружаете документ', en: 'You upload a document', de: 'Sie laden ein Dokument hoch', ar: 'ترفع مستندًا', kk: 'Құжатты жүктейсіз', uz: 'Hujjatni yuklaysiz' },
          body: {
            ru: 'PDF, DOCX или обычный текст. Содержимое файла сверяется с его расширением — подменённый файл не пройдёт, — и текст шифруется до попадания в хранилище.',
            en: 'PDF, DOCX or plain text. The file’s content is checked against its extension — a disguised file will not pass — and the text is encrypted before it reaches storage.',
            de: 'PDF, DOCX oder reiner Text. Der Inhalt wird gegen die Dateiendung geprüft — eine getarnte Datei kommt nicht durch — und der Text wird vor der Ablage verschlüsselt.',
            ar: 'PDF أو DOCX أو نص عادي. يُطابَق محتوى الملف مع امتداده — فالملف المموَّه لا يمر — ويُشفَّر النص قبل وصوله إلى التخزين.',
            kk: 'PDF, DOCX немесе қарапайым мәтін. Файл мазмұны кеңейтіміне сәйкестігі тексеріледі — жасырылған файл өтпейді — және мәтін сақтауға түспей тұрып шифрланады.',
            uz: 'PDF, DOCX yoki oddiy matn. Fayl mazmuni kengaytmasiga mosligi tekshiriladi — niqoblangan fayl oʻtmaydi — va matn saqlashga tushishidan oldin shifrlanadi.',
          },
        },
        {
          title: { ru: 'Выбираете юрисдикцию диалога', en: 'You choose the jurisdiction', de: 'Sie wählen die Rechtsordnung', ar: 'تختار الولاية القضائية', kk: 'Диалог юрисдикциясын таңдайсыз', uz: 'Suhbat yurisdiksiyasini tanlaysiz' },
          body: {
            ru: 'От неё зависит, из какого корпуса берутся нормы. Юрисдикции без корпуса отвечают без ссылок на закон — и говорят об этом.',
            en: 'It decides which corpus provisions come from. Jurisdictions without a corpus answer without statutory citations — and say so.',
            de: 'Sie bestimmt, aus welchem Korpus die Normen stammen. Rechtsordnungen ohne Korpus antworten ohne Gesetzesverweise — und sagen das.',
            ar: 'هي تحدد المجموعة التي تُؤخذ منها النصوص. الولايات بلا مجموعة تجيب بلا إحالات قانونية — وتذكر ذلك.',
            kk: 'Нормалар қай корпустан алынатыны содан тәуелді. Корпусы жоқ юрисдикциялар заңға сілтемесіз жауап береді — және мұны айтады.',
            uz: 'Normalar qaysi korpusdan olinishi shunga bogʻliq. Korpusi yoʻq yurisdiksiyalar qonunga havolasiz javob beradi — va buni aytadi.',
          },
        },
        {
          title: { ru: 'Спрашиваете своими словами', en: 'You ask in your own words', de: 'Sie fragen in eigenen Worten', ar: 'تسأل بكلماتك', kk: 'Өз сөзіңізбен сұрайсыз', uz: 'Oʻz soʻzingiz bilan soʻraysiz' },
          body: {
            ru: 'Вопрос переписывается в поисковый запрос по-русски для узбекского корпуса — тексты законов там русскоязычные, так находится больше.',
            en: 'For the Uzbek corpus the question is rewritten into a Russian search query — the statutes there are in Russian, and that finds more.',
            de: 'Für den usbekischen Korpus wird die Frage in eine russische Suchanfrage umgeschrieben — die Gesetze liegen dort auf Russisch vor, das findet mehr.',
            ar: 'للمجموعة الأوزبكية يُعاد صوغ السؤال كاستعلام بالروسية — فالقوانين هناك بالروسية، وهذا يجد أكثر.',
            kk: 'Өзбек корпусы үшін сұрақ орысша іздеу сұранысына айналдырылады — ондағы заңдар орысша, солай көбірек табылады.',
            uz: 'Oʻzbek korpusi uchun savol ruscha qidiruv soʻroviga aylantiriladi — u yerdagi qonunlar ruscha, shunda koʻproq topiladi.',
          },
        },
        {
          title: { ru: 'Получаете ответ и проверяете ссылку', en: 'You get an answer and check the citation', de: 'Sie erhalten eine Antwort und prüfen die Fundstelle', ar: 'تحصل على إجابة وتتحقق من الإحالة', kk: 'Жауап алып, сілтемені тексересіз', uz: 'Javob olasiz va havolani tekshirasiz' },
          body: {
            ru: 'Каждая ссылка ведёт к тексту нормы и адресу официального источника — проверка занимает секунды, а не поход в правовую базу.',
            en: 'Every citation leads to the text of the provision and the address of its official source — checking takes seconds, not a trip to a legal database.',
            de: 'Jede Fundstelle führt zum Normtext und zur Adresse der amtlichen Quelle — die Prüfung dauert Sekunden statt eines Ausflugs in die Rechtsdatenbank.',
            ar: 'كل إحالة تقود إلى نص المادة وعنوان مصدرها الرسمي — التحقق يستغرق ثوانٍ لا رحلة إلى قاعدة قانونية.',
            kk: 'Әр сілтеме норма мәтініне және ресми дереккөз мекенжайына апарады — тексеру секунд алады.',
            uz: 'Har bir havola norma matniga va rasmiy manba manziliga olib boradi — tekshirish soniyalar oladi.',
          },
        },
      ],
    },

    {
      kind: 'list',
      title: {
        ru: 'Что можно спросить',
        en: 'What you can ask',
        de: 'Was Sie fragen können',
        ar: 'ما الذي يمكن أن تسأل عنه',
        kk: 'Нені сұрауға болады',
        uz: 'Nimani soʻrash mumkin',
      },
      items: [
        {
          title: { ru: 'Смысл конкретного пункта', en: 'The meaning of a specific clause', de: 'Die Bedeutung einer konkreten Klausel', ar: 'معنى بند بعينه', kk: 'Нақты тармақтың мәні', uz: 'Aniq bandning maʼnosi' },
          body: {
            ru: '«Что означает пункт 5.4 простыми словами и чем он опасен для нас».',
            en: '“What does clause 5.4 mean in plain words and how is it risky for us.”',
            de: '„Was bedeutet Ziffer 5.4 in einfachen Worten und worin liegt das Risiko für uns?“',
            ar: '«ماذا يعني البند 5.4 بكلمات بسيطة وما خطره علينا».',
            kk: '«5.4-тармақ қарапайым сөзбен не білдіреді және бізге қауіпі неде».',
            uz: '«5.4-band oddiy soʻz bilan nimani anglatadi va bizga xavfi nimada».',
          },
        },
        {
          title: { ru: 'Сравнение с требованием закона', en: 'Comparison against a statutory requirement', de: 'Abgleich mit einer Gesetzesvorgabe', ar: 'المقارنة بمتطلب قانوني', kk: 'Заң талабымен салыстыру', uz: 'Qonun talabi bilan solishtirish' },
          body: {
            ru: '«Соответствует ли срок оплаты требованиям законодательства нашей юрисдикции».',
            en: '“Does the payment term meet the requirements of our jurisdiction’s law.”',
            de: '„Entspricht die Zahlungsfrist den Vorgaben unserer Rechtsordnung?“',
            ar: '«هل تتوافق مهلة السداد مع متطلبات قانون ولايتنا».',
            kk: '«Төлем мерзімі юрисдикциямыздың заң талаптарына сай ма».',
            uz: '«Toʻlov muddati yurisdiksiyamiz qonun talablariga mos keladimi».',
          },
        },
        {
          title: { ru: 'Чего в договоре не хватает', en: 'What the contract is missing', de: 'Was im Vertrag fehlt', ar: 'ما ينقص العقد', kk: 'Шартта не жетіспейді', uz: 'Shartnomada nima yetishmaydi' },
          body: {
            ru: '«Каких условий обычно ждут в договоре такого типа, а здесь их нет».',
            en: '“Which terms are usually expected in a contract of this type but are absent here.”',
            de: '„Welche Klauseln erwartet man üblicherweise in einem solchen Vertrag, die hier fehlen?“',
            ar: '«ما الشروط المتوقعة عادة في عقد من هذا النوع وهي غائبة هنا».',
            kk: '«Мұндай шартта әдетте қандай талаптар күтіледі, ал мұнда олар жоқ».',
            uz: '«Bunday shartnomada odatda qanday shartlar kutiladi, bu yerda esa ular yoʻq».',
          },
        },
        {
          title: { ru: 'Формулировка правки', en: 'Wording for a redline', de: 'Formulierung einer Änderung', ar: 'صياغة تعديل', kk: 'Түзету тұжырымы', uz: 'Tuzatish matni' },
          body: {
            ru: '«Предложи вариант пункта, который защищает нас, и покажи, что именно меняется».',
            en: '“Propose a version of the clause that protects us and show exactly what changes.”',
            de: '„Schlage eine Fassung der Klausel vor, die uns schützt, und zeige genau, was sich ändert.“',
            ar: '«اقترح صيغة للبند تحمينا وأظهر ما الذي يتغير بالضبط».',
            kk: '«Бізді қорғайтын тармақ нұсқасын ұсын және не өзгеретінін көрсет».',
            uz: '«Bizni himoya qiladigan band variantini taklif qil va nima oʻzgarishini koʻrsat».',
          },
        },
      ],
    },

    {
      kind: 'list',
      tone: 'limits',
      title: {
        ru: 'Границы',
        en: 'Limits',
        de: 'Grenzen',
        ar: 'الحدود',
        kk: 'Шекаралар',
        uz: 'Chegaralar',
      },
      items: [
        {
          title: { ru: 'Это не юридическая консультация', en: 'This is not legal advice', de: 'Das ist keine Rechtsberatung', ar: 'هذه ليست استشارة قانونية', kk: 'Бұл заңгерлік кеңес емес', uz: 'Bu yuridik maslahat emas' },
          body: {
            ru: 'Ответ — материал для вашего решения. Подписывает документ человек, и ответственность остаётся на нём.',
            en: 'The answer is material for your decision. A human signs the document, and the responsibility stays with them.',
            de: 'Die Antwort ist Material für Ihre Entscheidung. Unterschreiben tut ein Mensch, und bei ihm bleibt die Verantwortung.',
            ar: 'الإجابة مادة لقرارك. المستند يوقّعه إنسان، وتبقى المسؤولية عليه.',
            kk: 'Жауап — шешіміңізге материал. Құжатқа адам қол қояды, жауапкершілік онда қалады.',
            uz: 'Javob — qaroringiz uchun material. Hujjatga inson imzo chekadi, javobgarlik unda qoladi.',
          },
        },
        {
          title: { ru: 'Практику суда не ищем', en: 'We do not search case law', de: 'Wir suchen keine Rechtsprechung', ar: 'لا نبحث في السوابق', kk: 'Сот практикасын іздемейміз', uz: 'Sud amaliyotini qidirmaymiz' },
          body: {
            ru: 'В базе только тексты законов: судебных решений там нет вовсе, и мы не притворяемся, что есть.',
            en: 'The base holds statutory texts only: there are no court decisions in it, and we do not pretend otherwise.',
            de: 'Die Basis enthält nur Gesetzestexte: Gerichtsentscheidungen gibt es dort nicht, und wir tun nicht so als ob.',
            ar: 'القاعدة تضم نصوص القوانين فقط: لا أحكام قضائية فيها، ولا ندّعي غير ذلك.',
            kk: 'Базада тек заң мәтіндері: сот шешімдері мүлде жоқ, біз бар сияқты көрсетпейміз.',
            uz: 'Bazada faqat qonun matnlari: sud qarorlari umuman yoʻq, biz bordek koʻrsatmaymiz.',
          },
        },
        {
          title: { ru: 'Видит только то, что вы загрузили', en: 'It sees only what you uploaded', de: 'Es sieht nur, was Sie hochgeladen haben', ar: 'يرى فقط ما رفعتَه', kk: 'Тек сіз жүктегенді көреді', uz: 'Faqat siz yuklaganingizni koʻradi' },
          body: {
            ru: 'Ни доступа к вашей почте, ни к внешним системам, ни к документам других пользователей.',
            en: 'No access to your mail, to external systems, or to other users’ documents.',
            de: 'Kein Zugriff auf Ihre Mail, auf externe Systeme oder auf Dokumente anderer Nutzer.',
            ar: 'لا وصول إلى بريدك ولا إلى أنظمة خارجية ولا إلى مستندات مستخدمين آخرين.',
            kk: 'Поштаңызға да, сыртқы жүйелерге де, басқа пайдаланушылардың құжаттарына да қолжетімділік жоқ.',
            uz: 'Pochtangizga ham, tashqi tizimlarga ham, boshqa foydalanuvchilar hujjatlariga ham kirish yoʻq.',
          },
        },
      ],
    },

    {
      kind: 'faq',
      title: { ru: 'Частые вопросы', en: 'Frequently asked questions', de: 'Häufige Fragen', ar: 'أسئلة متكررة', kk: 'Жиі қойылатын сұрақтар', uz: 'Koʻp beriladigan savollar' },
      items: [
        {
          q: { ru: 'Сколько вопросов входит в бесплатный тариф?', en: 'How many questions does the free plan include?', de: 'Wie viele Fragen umfasst der kostenlose Tarif?', ar: 'كم سؤالًا تشمل الباقة المجانية؟', kk: 'Тегін тарифке қанша сұрақ кіреді?', uz: 'Bepul tarifga nechta savol kiradi?' },
          a: {
            ru: '20 обращений к ИИ в месяц. Каждый вопрос в диалоге и каждый разбор договора расходуют по одному обращению — счётчик общий.',
            en: '20 AI requests a month. Each question in a conversation and each contract review consumes one — the counter is shared.',
            de: '20 KI-Anfragen pro Monat. Jede Frage im Dialog und jede Vertragsprüfung verbraucht eine — der Zähler ist gemeinsam.',
            ar: '20 طلبًا شهريًا. كل سؤال في المحادثة وكل مراجعة عقد يستهلك طلبًا واحدًا — العدّاد مشترك.',
            kk: 'Айына 20 ИИ сұрауы. Диалогтағы әр сұрақ пен әр шарт талдауы бір сұрау жұмсайды — есептегіш ортақ.',
            uz: 'Oyiga 20 ta AI soʻrovi. Suhbatdagi har bir savol va har bir shartnoma tahlili bittadan sarflaydi — hisoblagich umumiy.',
          },
        },
        {
          q: { ru: 'Что будет, если по моей юрисдикции нет корпуса?', en: 'What if there is no corpus for my jurisdiction?', de: 'Was, wenn es für meine Rechtsordnung keinen Korpus gibt?', ar: 'ماذا لو لم تكن هناك مجموعة لولايتي؟', kk: 'Юрисдикциям бойынша корпус болмаса ше?', uz: 'Yurisdiksiyam boʻyicha korpus boʻlmasa-chi?' },
          a: {
            ru: 'Ответ будет построен только по тексту вашего документа, без ссылок на нормы. Придумывать статьи несуществующего корпуса система не станет.',
            en: 'The answer is built from your document text alone, without statutory citations. The system will not invent articles from a corpus that does not exist.',
            de: 'Die Antwort entsteht allein aus Ihrem Dokumenttext, ohne Gesetzesverweise. Paragrafen eines nicht vorhandenen Korpus erfindet das System nicht.',
            ar: 'ستُبنى الإجابة من نص مستندك وحده، بلا إحالات قانونية. ولن يخترع النظام موادَّ من مجموعة غير موجودة.',
            kk: 'Жауап тек құжатыңыздың мәтіні бойынша, нормаларға сілтемесіз құрылады. Жүйе жоқ корпустың баптарын ойлап таппайды.',
            uz: 'Javob faqat hujjatingiz matni asosida, normalarga havolasiz quriladi. Tizim yoʻq korpus moddalarini oʻylab topmaydi.',
          },
        },
        {
          q: { ru: 'Сохраняется ли переписка?', en: 'Is the conversation stored?', de: 'Wird der Verlauf gespeichert?', ar: 'هل تُحفَظ المحادثة؟', kk: 'Хат алмасу сақтала ма?', uz: 'Yozishmalar saqlanadimi?' },
          a: {
            ru: 'Да, диалоги хранятся в вашем кабинете, чтобы к ним можно было вернуться. Текст документа хранится зашифрованным ключом, который принадлежит вашей учётной записи.',
            en: 'Yes, conversations are kept in your workspace so you can return to them. The document text is stored encrypted with a key that belongs to your account.',
            de: 'Ja, Dialoge bleiben in Ihrem Arbeitsbereich, damit Sie darauf zurückkommen können. Der Dokumenttext liegt verschlüsselt mit einem Schlüssel Ihres Kontos.',
            ar: 'نعم، تُحفَظ المحادثات في مساحتك لتعود إليها. ونص المستند مُخزَّن مشفَّرًا بمفتاح يخص حسابك.',
            kk: 'Иә, диалогтар кабинетіңізде сақталады. Құжат мәтіні тіркелгіңізге тиесілі кілтпен шифрланып сақталады.',
            uz: 'Ha, suhbatlar kabinetingizda saqlanadi. Hujjat matni hisobingizga tegishli kalit bilan shifrlanib saqlanadi.',
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
            ru: 'Полный разбор по пунктам, когда вопросов слишком много, чтобы задавать их по одному.',
            en: 'A full clause-by-clause review, for when there are too many questions to ask one by one.',
            de: 'Eine vollständige klauselweise Prüfung, wenn es zu viele Fragen für einzelne Nachfragen sind.',
            ar: 'مراجعة كاملة بندًا بندًا حين تكثر الأسئلة على أن تُطرح واحدًا واحدًا.',
            kk: 'Сұрақ тым көп болғанда — тармақ бойынша толық талдау.',
            uz: 'Savollar juda koʻp boʻlganda — band boʻyicha toʻliq tahlil.',
          },
          to: '/contract-analysis',
        },
        {
          title: { ru: 'База законов', en: 'Legal base', de: 'Gesetzesbasis', ar: 'قاعدة القوانين', kk: 'Заң базасы', uz: 'Qonunlar bazasi' },
          body: {
            ru: 'Что именно загружено по каждой юрисдикции и чего в базе нет.',
            en: 'Exactly what is loaded per jurisdiction and what the base does not have.',
            de: 'Was je Rechtsordnung geladen ist und was der Basis fehlt.',
            ar: 'ما المُحمَّل لكل ولاية وما الذي لا تملكه القاعدة.',
            kk: 'Әр юрисдикция бойынша не жүктелген және базада не жоқ.',
            uz: 'Har bir yurisdiksiya boʻyicha nima yuklangan va bazada nima yoʻq.',
          },
          to: '/legal-base',
        },
        {
          title: { ru: 'Безопасность', en: 'Security', de: 'Sicherheit', ar: 'الأمان', kk: 'Қауіпсіздік', uz: 'Xavfsizlik' },
          body: {
            ru: 'Как хранится текст договора и кто имеет к нему доступ.',
            en: 'How the contract text is stored and who has access to it.',
            de: 'Wie der Vertragstext gespeichert wird und wer Zugriff hat.',
            ar: 'كيف يُخزَّن نص العقد ومن يصل إليه.',
            kk: 'Шарт мәтіні қалай сақталады және оған кім қол жеткізе алады.',
            uz: 'Shartnoma matni qanday saqlanadi va unga kim kira oladi.',
          },
          to: '/security',
        },
      ],
    },

    {
      kind: 'cta',
      title: { ru: 'Спросите свой договор', en: 'Ask your own contract', de: 'Fragen Sie Ihren Vertrag', ar: 'اسأل عقدك', kk: 'Өз шартыңыздан сұраңыз', uz: 'Oʻz shartnomangizdan soʻrang' },
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
