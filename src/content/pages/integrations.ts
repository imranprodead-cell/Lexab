/**
 * Публичная страница «Интеграции».
 *
 * Проверено по коду и по настройкам развёртывания 05.08.2026:
 *  - подключение облачных дисков живёт в integrations.routes.ts, гейта по
 *    тарифу у него НЕТ — доступно и на бесплатном;
 *  - Google Drive запрашивается со скоупом drive.file: приложение видит ТОЛЬКО
 *    файлы, которые пользователь сам выбрал в диалоге Google;
 *  - НАСТРОЕНЫ И РАБОТАЮТ: Google Drive и Dropbox (ключи заданы). Код умеет и
 *    Microsoft/OneDrive, но MS_CLIENT_ID в этом развёртывании пуст — поэтому
 *    OneDrive на сайте НЕ ОБЕЩАЕМ, пока ключи не появятся;
 *  - приём договоров по почте (inbound.routes.ts) требует INBOUND_EMAIL_TOKEN,
 *    он не задан → раздела на сайте нет;
 *  - выгрузка DOCX — гейт 'docxExport' → Standard и выше.
 */
import type { PageContent } from '../types';

export const integrations: PageContent = {
  slug: 'integrations',
  pageTitle: {
    ru: 'Интеграции — Lexab',
    en: 'Integrations — Lexab',
    de: 'Integrationen — Lexab',
    ar: 'التكاملات — Lexab',
    kk: 'Интеграциялар — Lexab',
    uz: 'Integratsiyalar — Lexab',
  },
  blocks: [
    {
      kind: 'hero',
      title: {
        ru: 'Договоры приходят из вашего облака',
        en: 'Contracts come in from your cloud',
        de: 'Verträge kommen aus Ihrer Cloud',
        ar: 'العقود تأتي من سحابتك',
        kk: 'Шарттар бұлтыңыздан келеді',
        uz: 'Shartnomalar bulutingizdan keladi',
      },
      lead: {
        ru: 'Подключаете Google Диск или Dropbox и берёте документы прямо оттуда — без скачивания на компьютер и повторной загрузки. Права запрашиваются минимальные: приложение видит только те файлы, которые вы сами выбрали, а не всё содержимое диска.',
        en: 'Connect Google Drive or Dropbox and pull documents straight from there — no downloading to your computer and re-uploading. Permissions requested are minimal: the app sees only the files you pick yourself, not the whole drive.',
        de: 'Verbinden Sie Google Drive oder Dropbox und holen Sie Dokumente direkt von dort — ohne Herunterladen und erneutes Hochladen. Die angefragten Rechte sind minimal: Die App sieht nur die von Ihnen ausgewählten Dateien, nicht den gesamten Speicher.',
        ar: 'اربط Google Drive أو Dropbox واسحب المستندات مباشرة — بلا تنزيل على حاسوبك ثم رفع من جديد. الصلاحيات المطلوبة أدنى ما يمكن: يرى التطبيق الملفات التي تختارها أنت فقط، لا محتوى القرص كله.',
        kk: 'Google Диск немесе Dropbox қосып, құжаттарды тікелей сол жерден аласыз — компьютерге жүктеп, қайта салудың қажеті жоқ. Сұралатын құқық ең азы: қосымша тек сіз таңдаған файлдарды көреді, дискінің бәрін емес.',
        uz: 'Google Disk yoki Dropbox ni ulab, hujjatlarni toʻgʻridan-toʻgʻri oʻsha yerdan olasiz — kompyuterga yuklab, qayta joylash shart emas. Soʻraladigan huquq eng kami: ilova faqat siz tanlagan fayllarni koʻradi, diskning hammasini emas.',
      },
      planNote: {
        ru: 'Облачные диски доступны на всех тарифах, включая бесплатный.',
        en: 'Cloud drives are available on every plan, including the free one.',
        de: 'Cloud-Speicher sind in allen Tarifen enthalten, auch im kostenlosen.',
        ar: 'التخزين السحابي متاح في جميع الباقات بما فيها المجانية.',
        kk: 'Бұлттық дискілер барлық тарифте, тегінін қоса.',
        uz: 'Bulutli disklar barcha tariflarda, bepulini ham qoʻshib.',
      },
      cta: [
        {
          label: { ru: 'Подключить диск', en: 'Connect a drive', de: 'Speicher verbinden', ar: 'اربط قرصًا', kk: 'Дискіні қосу', uz: 'Diskni ulash' },
          to: '/login',
          variant: 'primary',
        },
        {
          label: { ru: 'Программный доступ', en: 'Programmatic access', de: 'Programmatischer Zugriff', ar: 'الوصول البرمجي', kk: 'Бағдарламалық қолжетімділік', uz: 'Dasturiy kirish' },
          to: '/for-developers',
          variant: 'secondary',
        },
      ],
    },

    {
      kind: 'list',
      title: { ru: 'Что подключается сейчас', en: 'What connects today', de: 'Was heute verbunden werden kann', ar: 'ما يمكن ربطه اليوم', kk: 'Қазір не қосылады', uz: 'Hozir nima ulanadi' },
      items: [
        {
          title: { ru: 'Google Диск', en: 'Google Drive', de: 'Google Drive', ar: 'Google Drive', kk: 'Google Диск', uz: 'Google Disk' },
          body: {
            ru: 'Право доступа — только к файлам, выбранным вами в окне Google. Приложение не запрашивает чтение всего диска, и это осознанное решение, а не забывчивость.',
            en: 'Access is limited to files you pick in Google’s own dialog. The app never asks to read the entire drive — a deliberate choice, not an oversight.',
            de: 'Der Zugriff beschränkt sich auf Dateien, die Sie im Google-Dialog auswählen. Die App verlangt kein Lesen des gesamten Speichers — bewusst so entschieden.',
            ar: 'الوصول مقصور على الملفات التي تختارها في نافذة Google. ولا يطلب التطبيق قراءة القرص كله — وهذا اختيار مقصود لا سهو.',
            kk: 'Қолжетімділік — Google терезесінде сіз таңдаған файлдарға ғана. Қосымша бүкіл дискіні оқуды сұрамайды, бұл — саналы шешім.',
            uz: 'Kirish — Google oynasida siz tanlagan fayllarga. Ilova butun diskni oʻqishni soʻramaydi, bu — ongli qaror.',
          },
        },
        {
          title: { ru: 'Dropbox', en: 'Dropbox', de: 'Dropbox', ar: 'Dropbox', kk: 'Dropbox', uz: 'Dropbox' },
          body: {
            ru: 'Подключение по стандартной авторизации Dropbox: договоры берутся из вашего хранилища и попадают в кабинет уже зашифрованными.',
            en: 'Standard Dropbox authorisation: contracts are pulled from your storage and land in the workspace already encrypted.',
            de: 'Standard-Autorisierung von Dropbox: Verträge werden aus Ihrem Speicher geholt und landen bereits verschlüsselt im Arbeitsbereich.',
            ar: 'تفويض Dropbox القياسي: تُسحب العقود من مساحتك وتصل إلى حسابك مشفَّرة.',
            kk: 'Dropbox-тың стандартты авторизациясы: шарттар қоймаңыздан алынып, кабинетке шифрланған күйде түседі.',
            uz: 'Dropbox ning standart avtorizatsiyasi: shartnomalar omboringizdan olinadi va kabinetga shifrlangan holda tushadi.',
          },
        },
        {
          title: { ru: 'Ссылка на файл', en: 'A link to a file', de: 'Ein Link zur Datei', ar: 'رابط إلى ملف', kk: 'Файлға сілтеме', uz: 'Faylga havola' },
          body: {
            ru: 'Если диск подключать не хочется, договор можно добавить обычной ссылкой на документ — система заберёт содержимое сама.',
            en: 'If you would rather not connect a drive, a contract can be added by an ordinary document link — the system fetches the content itself.',
            de: 'Wer keinen Speicher verbinden möchte, kann einen Vertrag per gewöhnlichem Dokumentlink hinzufügen — das System holt den Inhalt selbst.',
            ar: 'إن لم ترغب بربط قرص، يمكن إضافة العقد برابط مستند عادي — والنظام يجلب المحتوى بنفسه.',
            kk: 'Дискіні қосқыңыз келмесе, шартты кәдімгі құжат сілтемесімен қосуға болады — жүйе мазмұнын өзі алады.',
            uz: 'Diskni ulashni istamasangiz, shartnomani oddiy hujjat havolasi bilan qoʻshish mumkin — tizim mazmunini oʻzi oladi.',
          },
        },
        {
          title: { ru: 'Выгрузка отчёта в DOCX', en: 'Export the report to DOCX', de: 'Bericht als DOCX exportieren', ar: 'تصدير التقرير إلى DOCX', kk: 'Есепті DOCX-ке шығару', uz: 'Hisobotni DOCX ga chiqarish' },
          body: {
            ru: 'Готовый разбор выгружается файлом, чтобы отправить клиенту или приложить к делу. Доступно на платных тарифах.',
            en: 'A finished review exports as a file to send to a client or attach to a matter. Available on paid plans.',
            de: 'Eine fertige Prüfung lässt sich als Datei exportieren — für Mandanten oder die Akte. In den bezahlten Tarifen.',
            ar: 'تُصدَّر المراجعة الجاهزة كملف لإرسالها إلى العميل أو ضمّها للملف. متاحة في الباقات المدفوعة.',
            kk: 'Дайын талдау файл болып шығарылады — клиентке жіберуге немесе іске тіркеуге. Ақылы тарифтерде.',
            uz: 'Tayyor tahlil fayl boʻlib chiqariladi — mijozga yuborish yoki ishga ilova qilish uchun. Pullik tariflarda.',
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
          title: { ru: 'Синхронизации папок нет', en: 'There is no folder sync', de: 'Es gibt keine Ordnersynchronisation', ar: 'لا مزامنة للمجلدات', kk: 'Қалталарды үндестіру жоқ', uz: 'Papkalarni sinxronlash yoʻq' },
          body: {
            ru: 'Мы не следим за вашей папкой и не забираем новые файлы сами. Документ добавляете вы — так понятнее, за что списан лимит.',
            en: 'We do not watch your folder or pull new files by ourselves. You add a document — that way it is clear what consumed your allowance.',
            de: 'Wir überwachen Ihren Ordner nicht und holen keine neuen Dateien von selbst. Sie fügen ein Dokument hinzu — so ist klar, wofür das Kontingent verbraucht wurde.',
            ar: 'لا نراقب مجلدك ولا نسحب ملفات جديدة تلقائيًا. أنت من يضيف المستند — فيتضح ما الذي استهلك حصتك.',
            kk: 'Біз қалтаңызды бақыламаймыз және жаңа файлдарды өзіміз алмаймыз. Құжатты сіз қосасыз — лимит неге жұмсалғаны түсінікті болады.',
            uz: 'Biz papkangizni kuzatmaymiz va yangi fayllarni oʻzimiz olmaymiz. Hujjatni siz qoʻshasiz — limit nimaga sarflangani tushunarli boʻladi.',
          },
        },
        {
          title: { ru: 'Обратно в облако мы ничего не пишем', en: 'We write nothing back to your cloud', de: 'Wir schreiben nichts in Ihre Cloud zurück', ar: 'لا نكتب شيئًا إلى سحابتك', kk: 'Бұлтқа кері ештеңе жазбаймыз', uz: 'Bulutga qaytib hech nima yozmaymiz' },
          body: {
            ru: 'Разбор и правки остаются в Lexab, файлы в вашем хранилище не изменяются.',
            en: 'Reviews and redlines stay in Lexab; files in your storage are never modified.',
            de: 'Prüfungen und Änderungen bleiben in Lexab; Dateien in Ihrem Speicher werden nicht verändert.',
            ar: 'تبقى المراجعات والتعديلات داخل Lexab، ولا تُعدَّل ملفاتك في مساحتك.',
            kk: 'Талдау мен түзетулер Lexab-та қалады, қоймаңыздағы файлдар өзгермейді.',
            uz: 'Tahlil va tuzatishlar Lexabda qoladi, omboringizdagi fayllar oʻzgarmaydi.',
          },
        },
      ],
    },

    {
      kind: 'faq',
      title: { ru: 'Частые вопросы', en: 'Frequently asked questions', de: 'Häufige Fragen', ar: 'أسئلة متكررة', kk: 'Жиі қойылатын сұрақтар', uz: 'Koʻp beriladigan savollar' },
      items: [
        {
          q: { ru: 'Что именно получает приложение от Google?', en: 'What exactly does the app get from Google?', de: 'Was genau erhält die App von Google?', ar: 'ما الذي يحصل عليه التطبيق من Google بالضبط؟', kk: 'Қосымша Google-дан нақты нені алады?', uz: 'Ilova Google dan aniq nimani oladi?' },
          a: {
            ru: 'Право на файлы, которые вы отметили в окне выбора Google, и адрес вашей почты. Доступа ко всему диску приложение не просит, поэтому и не имеет.',
            en: 'Rights to the files you ticked in Google’s picker and your email address. The app does not ask for whole-drive access, and therefore does not have it.',
            de: 'Rechte an den in Googles Auswahl markierten Dateien und Ihre E-Mail-Adresse. Zugriff auf den gesamten Speicher fragt die App nicht an — und hat ihn folglich nicht.',
            ar: 'صلاحيات على الملفات التي حدّدتها في نافذة اختيار Google وعنوان بريدك. ولا يطلب التطبيق وصولًا إلى القرص كله، لذا لا يملكه.',
            kk: 'Google таңдау терезесінде белгілеген файлдарыңызға құқық және пошта мекенжайыңыз. Бүкіл дискіге қолжетімділікті қосымша сұрамайды, демек оған ие емес.',
            uz: 'Google tanlov oynasida belgilagan fayllaringizga huquq va pochta manzilingiz. Butun diskka kirishni ilova soʻramaydi, demak unga ega emas.',
          },
        },
        {
          q: { ru: 'Можно ли отключить диск?', en: 'Can a drive be disconnected?', de: 'Lässt sich ein Speicher trennen?', ar: 'هل يمكن فصل القرص؟', kk: 'Дискіні ажыратуға бола ма?', uz: 'Diskni uzish mumkinmi?' },
          a: {
            ru: 'Да, в любой момент из настроек. Уже загруженные документы остаются у вас в кабинете — они хранятся отдельно от подключения.',
            en: 'Yes, at any time from settings. Documents already imported stay in your workspace — they are stored independently of the connection.',
            de: 'Ja, jederzeit in den Einstellungen. Bereits importierte Dokumente bleiben im Arbeitsbereich — sie liegen unabhängig von der Verbindung.',
            ar: 'نعم، في أي وقت من الإعدادات. وتبقى المستندات المستوردة في مساحتك — فهي مخزَّنة بمعزل عن الربط.',
            kk: 'Иә, кез келген уақытта баптаулардан. Жүктелген құжаттар кабинетте қалады — олар қосылымнан бөлек сақталады.',
            uz: 'Ha, istalgan vaqtda sozlamalardan. Yuklangan hujjatlar kabinetda qoladi — ular ulanishdan alohida saqlanadi.',
          },
        },
      ],
    },

    {
      kind: 'related',
      title: { ru: 'Дальше по теме', en: 'Related', de: 'Weiterlesen', ar: 'مواضيع ذات صلة', kk: 'Тақырып бойынша әрі қарай', uz: 'Mavzu boʻyicha davomi' },
      items: [
        {
          title: { ru: 'Разработчикам', en: 'Developers', de: 'Entwickler', ar: 'للمطورين', kk: 'Әзірлеушілерге', uz: 'Dasturchilarga' },
          body: {
            ru: 'Если нужна связка с вашей системой, а не с диском.',
            en: 'If you need a link to your own system rather than a drive.',
            de: 'Wenn Sie eine Anbindung an Ihr System statt an einen Speicher brauchen.',
            ar: 'إن كنت تحتاج ربطًا بنظامك لا بقرص.',
            kk: 'Дискімен емес, өз жүйеңізбен байланыс қажет болса.',
            uz: 'Disk bilan emas, oʻz tizimingiz bilan bogʻlanish kerak boʻlsa.',
          },
          to: '/for-developers',
        },
        {
          title: { ru: 'Безопасность', en: 'Security', de: 'Sicherheit', ar: 'الأمان', kk: 'Қауіпсіздік', uz: 'Xavfsizlik' },
          body: {
            ru: 'Что происходит с файлом после того, как он попал к нам.',
            en: 'What happens to a file once it reaches us.',
            de: 'Was mit einer Datei geschieht, sobald sie bei uns ist.',
            ar: 'ماذا يحدث للملف بعد وصوله إلينا.',
            kk: 'Файл бізге түскеннен кейін онымен не болады.',
            uz: 'Fayl bizga tushgach u bilan nima boʻladi.',
          },
          to: '/security',
        },
        {
          title: { ru: 'Пакетная проверка', en: 'Bulk review', de: 'Stapelprüfung', ar: 'مراجعة دفعية', kk: 'Топтама тексеру', uz: 'Paketli tekshiruv' },
          body: {
            ru: 'Когда из облака нужно разобрать сразу много договоров.',
            en: 'When many contracts from the cloud need reviewing at once.',
            de: 'Wenn viele Verträge aus der Cloud auf einmal zu prüfen sind.',
            ar: 'حين تحتاج إلى مراجعة عقود كثيرة من السحابة دفعة واحدة.',
            kk: 'Бұлттан бірден көп шартты талдау қажет болғанда.',
            uz: 'Bulutdan birdan koʻp shartnomani tahlil qilish kerak boʻlganda.',
          },
          to: '/bulk-review',
        },
      ],
    },

    {
      kind: 'cta',
      title: { ru: 'Возьмите договор прямо из облака', en: 'Take a contract straight from the cloud', de: 'Holen Sie einen Vertrag direkt aus der Cloud', ar: 'خذ عقدًا مباشرة من السحابة', kk: 'Шартты бұлттан бірден алыңыз', uz: 'Shartnomani bulutdan darrov oling' },
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
