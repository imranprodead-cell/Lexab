/**
 * Публичная страница «Пакетная проверка».
 *
 * Проверено по коду 05.08.2026 (server/src/routes/batch.routes.ts):
 *  - файлы сначала загружаются обычным способом (POST /uploads), затем
 *    POST /batch создаёт задание из списка идентификаторов;
 *  - задание идёт в фоне ПО ОДНОМУ файлу, best-effort: битый или превысивший
 *    лимит файл помечается ошибкой, остальные продолжают;
 *  - прогресс — опросом GET /batch/:id (не поток);
 *  - каждый готовый разбор — обычная строка в «Документах» и в аналитике;
 *  - гейт 'batch' → Pro, Business, Enterprise.
 */
import type { PageContent } from '../types';

export const bulkReview: PageContent = {
  slug: 'bulk-review',
  pageTitle: {
    ru: 'Пакетная проверка договоров — Lexab',
    en: 'Bulk contract review — Lexab',
    de: 'Stapelprüfung von Verträgen — Lexab',
    ar: 'مراجعة عقود دفعية — Lexab',
    kk: 'Шарттарды топтап тексеру — Lexab',
    uz: 'Shartnomalarni paketli tekshirish — Lexab',
  },
  blocks: [
    {
      kind: 'hero',
      title: {
        ru: 'Пачка договоров одним заданием',
        en: 'A stack of contracts in one job',
        de: 'Ein Stapel Verträge in einem Auftrag',
        ar: 'حزمة عقود في مهمة واحدة',
        kk: 'Бір тапсырмамен шарттар тобы',
        uz: 'Bitta topshiriq bilan shartnomalar toʻdasi',
      },
      lead: {
        ru: 'Загружаете сразу несколько договоров и запускаете один разбор на всех. Файлы обрабатываются по очереди в фоне: можно закрыть вкладку и вернуться позже. Готовые разборы ложатся в «Документы» как обычные — их видно в поиске, в аналитике и в общей работе команды.',
        en: 'Upload several contracts at once and start a single job for all of them. Files are processed one after another in the background: you can close the tab and come back later. Finished reviews land in Documents like any other — searchable, counted in analytics, shared with your team.',
        de: 'Laden Sie mehrere Verträge auf einmal hoch und starten Sie einen Auftrag für alle. Die Dateien werden nacheinander im Hintergrund verarbeitet: Sie können den Tab schließen und später zurückkommen. Fertige Prüfungen landen wie gewohnt in „Dokumente“ — durchsuchbar, in der Auswertung gezählt, im Team geteilt.',
        ar: 'ارفع عدة عقود دفعة واحدة وابدأ مهمة واحدة لها جميعًا. تُعالَج الملفات تباعًا في الخلفية: يمكنك إغلاق التبويب والعودة لاحقًا. وتُدرَج المراجعات الجاهزة في «المستندات» كغيرها — قابلة للبحث ومحسوبة في التحليلات ومتاحة للفريق.',
        kk: 'Бірнеше шартты бірден жүктеп, бәріне бір талдау іске қосасыз. Файлдар фонда кезекпен өңделеді: қойындыны жауып, кейін оралуға болады. Дайын талдаулар «Құжаттарға» кәдімгідей түседі — іздеуден, аналитикадан және команда жұмысынан көрінеді.',
        uz: 'Bir nechta shartnomani birdan yuklab, hammasiga bitta tahlil ishga tushirasiz. Fayllar fonda navbat bilan qayta ishlanadi: varaqni yopib, keyin qaytish mumkin. Tayyor tahlillar «Hujjatlar»ga odatdagidek tushadi — qidiruvda, tahlilda va jamoa ishida koʻrinadi.',
      },
      planNote: {
        ru: 'Доступно на тарифах Pro и Business (и на Enterprise). Каждый файл в пачке расходует обращение к ИИ и место в лимите документов.',
        en: 'Available on Pro and Business (and Enterprise). Each file in a batch consumes one AI request and one document slot.',
        de: 'Verfügbar in Pro und Business (sowie Enterprise). Jede Datei im Stapel verbraucht eine KI-Anfrage und einen Dokumentplatz.',
        ar: 'متاحة في Pro وBusiness (وEnterprise). كل ملف في الدفعة يستهلك طلب ذكاء اصطناعي ومكانًا في حصة المستندات.',
        kk: 'Pro және Business тарифтерінде (және Enterprise). Топтамадағы әр файл бір ИИ сұрауын және құжат лимитінен орын жұмсайды.',
        uz: 'Pro va Business tariflarida (hamda Enterprise). Paketdagi har bir fayl bitta AI soʻrovi va hujjat limitidan joy sarflaydi.',
      },
      cta: [
        {
          label: { ru: 'Запустить пакет', en: 'Start a batch', de: 'Stapel starten', ar: 'ابدأ دفعة', kk: 'Топтаманы бастау', uz: 'Paketni boshlash' },
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
          value: { ru: '1 из N', en: '1 of N', de: '1 von N', ar: '1 من N', kk: 'N-нің 1-і', uz: 'N dan 1' },
          label: { ru: 'битый файл не роняет пачку', en: 'a broken file does not kill the batch', de: 'eine defekte Datei stoppt den Stapel nicht', ar: 'ملف تالف لا يُسقط الدفعة', kk: 'бүлінген файл топтаманы құлатпайды', uz: 'buzilgan fayl paketni yiqitmaydi' },
          proof: {
            ru: 'Файл, который не читается или не влезает в лимит, помечается ошибкой — остальные продолжают обрабатываться.',
            en: 'A file that cannot be read or exceeds a limit is marked with an error — the rest keep processing.',
            de: 'Eine unlesbare oder zu große Datei wird als Fehler markiert — die übrigen laufen weiter.',
            ar: 'الملف غير المقروء أو المتجاوز للحد يُوسَم بخطأ — وتستمر البقية.',
            kk: 'Оқылмайтын немесе лимитке сыймайтын файл қате деп белгіленеді — қалғаны жалғаса береді.',
            uz: 'Oʻqilmaydigan yoki limitga sigʻmaydigan fayl xato deb belgilanadi — qolganlari davom etadi.',
          },
        },
        {
          value: { ru: '700', en: '700', de: '700', ar: '700', kk: '700', uz: '700' },
          label: { ru: 'документов в месяц на Business', en: 'documents a month on Business', de: 'Dokumente pro Monat bei Business', ar: 'مستندًا شهريًا في Business', kk: 'Business-те айына құжат', uz: 'Business da oyiga hujjat' },
          proof: {
            ru: 'На Pro — 80 документов и 500 обращений к ИИ в месяц. Пачка расходует их так же, как обычные разборы.',
            en: 'On Pro it is 80 documents and 500 AI requests a month. A batch consumes them just like ordinary reviews.',
            de: 'Bei Pro sind es 80 Dokumente und 500 KI-Anfragen pro Monat. Ein Stapel verbraucht sie wie normale Prüfungen.',
            ar: 'في Pro: 80 مستندًا و500 طلب شهريًا. والدفعة تستهلكها كالمراجعات العادية.',
            kk: 'Pro-да — айына 80 құжат және 500 ИИ сұрауы. Топтама оларды кәдімгі талдаулар сияқты жұмсайды.',
            uz: 'Pro da — oyiga 80 hujjat va 500 AI soʻrovi. Paket ularni oddiy tahlillar kabi sarflaydi.',
          },
        },
        {
          value: { ru: '0', en: '0', de: '0', ar: '0', kk: '0', uz: '0' },
          label: { ru: 'отдельных мест хранения', en: 'separate storage places', de: 'gesonderte Speicherorte', ar: 'أماكن تخزين منفصلة', kk: 'бөлек сақтау орны', uz: 'alohida saqlash joyi' },
          proof: {
            ru: 'Результат пакета — те же документы и разборы, что и при обычной загрузке: отдельного раздела, где они потеряются, нет.',
            en: 'A batch produces the same documents and reviews as a normal upload: there is no separate corner where they get lost.',
            de: 'Ein Stapel erzeugt dieselben Dokumente und Prüfungen wie ein normaler Upload: kein Extra-Bereich, in dem sie verschwinden.',
            ar: 'تنتج الدفعة المستندات والمراجعات نفسها كالرفع العادي: لا قسم منفصل تضيع فيه.',
            kk: 'Топтама нәтижесі — кәдімгі жүктеудегі құжаттар мен талдаулар: олар жоғалатын бөлек бөлім жоқ.',
            uz: 'Paket natijasi — oddiy yuklashdagi hujjatlar va tahlillar: ular yoʻqoladigan alohida boʻlim yoʻq.',
          },
        },
      ],
    },

    {
      kind: 'steps',
      title: { ru: 'Как это работает', en: 'How it works', de: 'So funktioniert es', ar: 'كيف يعمل', kk: 'Бұл қалай жұмыс істейді', uz: 'Bu qanday ishlaydi' },
      items: [
        {
          title: { ru: 'Загружаете файлы', en: 'You upload the files', de: 'Sie laden die Dateien hoch', ar: 'ترفع الملفات', kk: 'Файлдарды жүктейсіз', uz: 'Fayllarni yuklaysiz' },
          body: {
            ru: 'Обычной загрузкой: та же сверка содержимого с расширением, то же шифрование, то же извлечение текста, что и для одиночного договора.',
            en: 'Through the usual upload: the same content-versus-extension check, the same encryption, the same text extraction as for a single contract.',
            de: 'Über den normalen Upload: dieselbe Prüfung von Inhalt gegen Dateiendung, dieselbe Verschlüsselung, dieselbe Textextraktion wie bei einem Einzelvertrag.',
            ar: 'بالرفع المعتاد: نفس مطابقة المحتوى مع الامتداد، ونفس التشفير، ونفس استخراج النص كعقد مفرد.',
            kk: 'Кәдімгі жүктеумен: мазмұнның кеңейтімге сәйкестігін сол тексеру, сол шифрлау, сол мәтін алу.',
            uz: 'Oddiy yuklash bilan: mazmunning kengaytmaga mosligini oʻsha tekshirish, oʻsha shifrlash, oʻsha matn ajratish.',
          },
        },
        {
          title: { ru: 'Создаёте задание', en: 'You create the job', de: 'Sie legen den Auftrag an', ar: 'تنشئ المهمة', kk: 'Тапсырма жасайсыз', uz: 'Topshiriq yaratasiz' },
          body: {
            ru: 'Отмечаете, какие файлы войдут в пачку. Дальше можно закрыть вкладку — задание живёт на сервере.',
            en: 'You mark which files go into the batch. After that you can close the tab — the job lives on the server.',
            de: 'Sie markieren, welche Dateien in den Stapel gehören. Danach können Sie den Tab schließen — der Auftrag läuft auf dem Server.',
            ar: 'تحدد الملفات التي تدخل الدفعة. بعدها يمكنك إغلاق التبويب — فالمهمة تعمل على الخادم.',
            kk: 'Топтамаға қай файлдар кіретінін белгілейсіз. Одан әрі қойындыны жабуға болады — тапсырма серверде.',
            uz: 'Paketga qaysi fayllar kirishini belgilaysiz. Keyin varaqni yopish mumkin — topshiriq serverda.',
          },
        },
        {
          title: { ru: 'Файлы идут по очереди', en: 'Files run one after another', de: 'Dateien laufen nacheinander', ar: 'تُعالَج الملفات تباعًا', kk: 'Файлдар кезекпен өтеді', uz: 'Fayllar navbat bilan oʻtadi' },
          body: {
            ru: 'Каждый проходит тот же конвейер разбора, что и одиночный договор, — без «упрощённого» режима для пачек.',
            en: 'Each goes through the same review pipeline as a single contract — there is no “lite” mode for batches.',
            de: 'Jede durchläuft dieselbe Prüfstrecke wie ein Einzelvertrag — einen „Sparmodus“ für Stapel gibt es nicht.',
            ar: 'كل ملف يمر بمسار المراجعة نفسه كعقد مفرد — لا وضع «مبسّط» للدفعات.',
            kk: 'Әрқайсысы жеке шарттағыдай талдау конвейерінен өтеді — топтамаға «жеңілдетілген» режим жоқ.',
            uz: 'Har biri yakka shartnomadagi kabi tahlil konveyeridan oʻtadi — paketlar uchun «yengillashtirilgan» rejim yoʻq.',
          },
        },
        {
          title: { ru: 'Смотрите прогресс и результаты', en: 'You watch progress and results', de: 'Sie sehen Fortschritt und Ergebnisse', ar: 'تتابع التقدم والنتائج', kk: 'Барысы мен нәтижелерін көресіз', uz: 'Jarayon va natijalarni koʻrasiz' },
          body: {
            ru: 'Видно, сколько готово, сколько в работе и что пошло не так у конкретного файла.',
            en: 'You can see how many are done, how many are running and what went wrong with a specific file.',
            de: 'Sie sehen, wie viele fertig sind, wie viele laufen und was bei einer bestimmten Datei schiefging.',
            ar: 'ترى كم اكتمل وكم قيد التنفيذ وما الخطأ في ملف بعينه.',
            kk: 'Қаншасы дайын, қаншасы жұмыста және нақты файлда не болғаны көрінеді.',
            uz: 'Nechtasi tayyor, nechtasi ishda va aniq faylda nima boʻlgani koʻrinadi.',
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
          title: { ru: 'Пачка не обходит лимиты тарифа', en: 'A batch does not bypass plan limits', de: 'Ein Stapel umgeht keine Tariflimits', ar: 'الدفعة لا تتجاوز حدود الباقة', kk: 'Топтама тариф лимитін айналып өтпейді', uz: 'Paket tarif limitini chetlab oʻtmaydi' },
          body: {
            ru: 'Двадцать файлов — это двадцать обращений к ИИ и двадцать документов из вашего месячного лимита.',
            en: 'Twenty files are twenty AI requests and twenty documents out of your monthly allowance.',
            de: 'Zwanzig Dateien sind zwanzig KI-Anfragen und zwanzig Dokumente aus Ihrem Monatskontingent.',
            ar: 'عشرون ملفًا تعني عشرين طلبًا وعشرين مستندًا من حصتك الشهرية.',
            kk: 'Жиырма файл — айлық лимитіңізден жиырма ИИ сұрауы және жиырма құжат.',
            uz: 'Yigirma fayl — oylik limitingizdan yigirma AI soʻrovi va yigirma hujjat.',
          },
        },
        {
          title: { ru: 'Сканы без текста не разбираются', en: 'Scans without text are not reviewed', de: 'Scans ohne Text werden nicht geprüft', ar: 'المسوحات بلا نص لا تُراجَع', kk: 'Мәтінсіз скандар талданбайды', uz: 'Matnsiz skanlar tahlil qilinmaydi' },
          body: {
            ru: 'Распознавания изображений нет: такой файл в пачке будет помечен ошибкой, а не разобран наугад.',
            en: 'There is no image recognition: such a file in a batch is flagged as an error rather than guessed at.',
            de: 'Es gibt keine Texterkennung aus Bildern: Eine solche Datei wird als Fehler markiert statt geraten.',
            ar: 'لا تعرّف ضوئي: يُوسَم مثل هذا الملف بخطأ بدل تخمين محتواه.',
            kk: 'Кескінді тану жоқ: мұндай файл қате деп белгіленеді, болжаммен талданбайды.',
            uz: 'Tasvirni tanish yoʻq: bunday fayl xato deb belgilanadi, taxmin bilan tahlil qilinmaydi.',
          },
        },
      ],
    },

    {
      kind: 'faq',
      title: { ru: 'Частые вопросы', en: 'Frequently asked questions', de: 'Häufige Fragen', ar: 'أسئلة متكررة', kk: 'Жиі қойылатын сұрақтар', uz: 'Koʻp beriladigan savollar' },
      items: [
        {
          q: { ru: 'Что будет, если закрыть браузер?', en: 'What if I close the browser?', de: 'Was, wenn ich den Browser schließe?', ar: 'ماذا لو أغلقت المتصفح؟', kk: 'Браузерді жапсам не болады?', uz: 'Brauzerni yopsam nima boʻladi?' },
          a: {
            ru: 'Задание продолжит идти на сервере. Вернётесь — увидите готовые разборы; если сервер перезапускался, незавершённые задания подхватываются заново.',
            en: 'The job keeps running on the server. When you return you will find the finished reviews; if the server restarted, unfinished jobs are picked up again.',
            de: 'Der Auftrag läuft auf dem Server weiter. Bei Ihrer Rückkehr sind die Prüfungen fertig; nach einem Serverneustart werden offene Aufträge erneut aufgenommen.',
            ar: 'تستمر المهمة على الخادم. وعند عودتك تجد المراجعات جاهزة؛ وإن أُعيد تشغيل الخادم تُستأنف المهام غير المكتملة.',
            kk: 'Тапсырма серверде жалғасады. Оралғанда дайын талдауларды көресіз; сервер қайта іске қосылса, аяқталмаған тапсырмалар қайта алынады.',
            uz: 'Topshiriq serverda davom etadi. Qaytganingizda tayyor tahlillarni koʻrasiz; server qayta ishga tushsa, tugallanmagan topshiriqlar qayta olinadi.',
          },
        },
        {
          q: { ru: 'Разбор в пачке хуже обычного?', en: 'Is a review in a batch worse than a normal one?', de: 'Ist eine Prüfung im Stapel schlechter als einzeln?', ar: 'هل المراجعة ضمن دفعة أضعف من المفردة؟', kk: 'Топтамадағы талдау кәдімгіден нашар ма?', uz: 'Paketdagi tahlil oddiysidan yomonroqmi?' },
          a: {
            ru: 'Нет. Каждый файл проходит тот же конвейер: те же ссылки на нормы, та же проверка цитат, те же правила вашей фирмы.',
            en: 'No. Every file goes through the same pipeline: the same statutory citations, the same citation checks, the same rules of your firm.',
            de: 'Nein. Jede Datei durchläuft dieselbe Strecke: dieselben Gesetzesverweise, dieselbe Zitatprüfung, dieselben Kanzleiregeln.',
            ar: 'لا. كل ملف يمر بالمسار نفسه: الإحالات نفسها وفحص الاقتباس نفسه وقواعد مكتبك نفسها.',
            kk: 'Жоқ. Әр файл сол конвейерден өтеді: сол сілтемелер, сол дәйексөз тексерісі, фирмаңыздың сол ережелері.',
            uz: 'Yoʻq. Har bir fayl oʻsha konveyerdan oʻtadi: oʻsha havolalar, oʻsha iqtibos tekshiruvi, firmangizning oʻsha qoidalari.',
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
            ru: 'Что именно делает конвейер с каждым файлом пачки.',
            en: 'What the pipeline actually does with each file in the batch.',
            de: 'Was die Prüfstrecke mit jeder Datei des Stapels tut.',
            ar: 'ما الذي يفعله المسار فعليًا بكل ملف في الدفعة.',
            kk: 'Конвейер топтамадағы әр файлмен нақты не істейді.',
            uz: 'Konveyer paketdagi har bir fayl bilan aniq nima qiladi.',
          },
          to: '/contract-analysis',
        },
        {
          title: { ru: 'Правила по пунктам', en: 'Clause playbooks', de: 'Klausel-Playbooks', ar: 'أدلة البنود', kk: 'Тармақтар бойынша ережелер', uz: 'Bandlar boʻyicha qoidalar' },
          body: {
            ru: 'Чтобы на сотне договоров проверялись именно ваши позиции.',
            en: 'So that a hundred contracts are checked against your positions.',
            de: 'Damit bei hundert Verträgen genau Ihre Positionen geprüft werden.',
            ar: 'كي تُفحص مئة عقد وفق مواقفك أنت.',
            kk: 'Жүз шартта дәл сіздің ұстанымдарыңыз тексерілуі үшін.',
            uz: 'Yuzta shartnomada aynan sizning pozitsiyalaringiz tekshirilishi uchun.',
          },
          to: '/clause-playbooks',
        },
        {
          title: { ru: 'Разработчикам', en: 'Developers', de: 'Entwickler', ar: 'للمطورين', kk: 'Әзірлеушілерге', uz: 'Dasturchilarga' },
          body: {
            ru: 'Если пачки нужно запускать из своей системы, а не руками.',
            en: 'If batches should be launched from your own system rather than by hand.',
            de: 'Wenn Stapel aus dem eigenen System statt von Hand starten sollen.',
            ar: 'إذا كنت تريد إطلاق الدفعات من نظامك لا يدويًا.',
            kk: 'Топтамаларды қолмен емес, өз жүйеңізден іске қосу керек болса.',
            uz: 'Paketlarni qoʻlda emas, oʻz tizimingizdan ishga tushirish kerak boʻlsa.',
          },
          to: '/for-developers',
        },
      ],
    },

    {
      kind: 'cta',
      title: { ru: 'Разберите накопившуюся стопку', en: 'Clear the pile that has piled up', de: 'Arbeiten Sie den Stapel ab', ar: 'صفِّ الكومة المتراكمة', kk: 'Жиналып қалған үйіндіні талдаңыз', uz: 'Yigʻilib qolgan uyumni tahlil qiling' },
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
