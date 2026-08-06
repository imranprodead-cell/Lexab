/**
 * Публичная страница «База законов» — центр доверия всего сайта.
 *
 * ВСЕ ЧИСЛА ЗДЕСЬ — ИЗ ЖИВОГО ЗАПРОСА К БОЕВОЙ БАЗЕ 05.08.2026:
 *   100 документов · 17 248 норм · 14 357 фрагментов · у 14 357 есть вектор
 *   UZ 83/8131 · DE 1/2798 · UK 8/2148 · AE 1/1526 · KZ 4/1328 · CA 1/1271 · US 2/46
 *   7 официальных хостов-источников · 0 судебных дел (практики в корпусе НЕТ)
 * Меняется корпус — сначала перезапросить базу, потом править эту страницу.
 *
 * Страница намеренно показывает СЛАБЫЕ места (США — 46 норм, нет практики, нет
 * редакций на дату): читатель, сам нашедший дыру, теряет доверие ко всей
 * странице; читатель, которому дыру показали, верит остальным строкам.
 */
import type { PageContent } from '../types';

export const legalBase: PageContent = {
  slug: 'legal-base',
  pageTitle: {
    ru: 'База законов — Lexab',
    en: 'Legal base — Lexab',
    de: 'Gesetzesbasis — Lexab',
    ar: 'قاعدة القوانين — Lexab',
    kk: 'Заң базасы — Lexab',
    uz: 'Qonunlar bazasi — Lexab',
  },
  blocks: [
    {
      kind: 'hero',
      title: {
        ru: 'На чём основаны выводы о вашем договоре',
        en: 'What the conclusions about your contract rest on',
        de: 'Worauf die Aussagen zu Ihrem Vertrag beruhen',
        ar: 'على ماذا تستند الاستنتاجات بشأن عقدك',
        kk: 'Шартыңыз туралы тұжырымдар неге негізделген',
        uz: 'Shartnomangiz haqidagi xulosalar nimaga asoslanadi',
      },
      lead: {
        ru: 'Корпус из 17 248 норм, загруженных с официальных государственных сайтов семи юрисдикций. Тексты законов никогда не пишет модель: норма попадает в базу только файлом с официального источника, с адресом, контрольной суммой и датой загрузки. Строка без источника физически не сохраняется — это запрещено ограничением базы данных.',
        en: 'A corpus of 17,248 provisions loaded from the official government sites of seven jurisdictions. Statutory text is never written by the model: a provision enters the base only as a file from an official source, with its address, checksum and retrieval date. A row without a source physically cannot be saved — a database constraint forbids it.',
        de: 'Ein Korpus aus 17 248 Normen, geladen von den amtlichen Websites von sieben Rechtsordnungen. Gesetzestext schreibt das Modell nie: Eine Norm gelangt nur als Datei aus amtlicher Quelle in die Basis — mit Adresse, Prüfsumme und Ladedatum. Ein Datensatz ohne Quelle lässt sich schlicht nicht speichern; das verbietet eine Datenbank-Bedingung.',
        ar: 'مجموعة من 17٬248 نصًا قانونيًا محمَّلة من المواقع الحكومية الرسمية لسبع ولايات قضائية. النموذج لا يكتب نصوص القوانين أبدًا: النص يدخل القاعدة كملف من مصدر رسمي فقط، مع عنوانه وبصمته وتاريخ تحميله. الصف بلا مصدر لا يُحفَظ أصلًا — قيد في قاعدة البيانات يمنع ذلك.',
        kk: '17 248 нормадан тұратын корпус жеті юрисдикцияның ресми мемлекеттік сайттарынан жүктелген. Заң мәтінін модель ешқашан жазбайды: норма базаға тек ресми дереккөзден файл түрінде, мекенжайымен, бақылау сомасымен және жүктелген күнімен түседі. Дереккөзсіз жол сақталмайды — оған дерекқор шектеуі жол бермейді.',
        uz: '17 248 normadan iborat korpus yettita yurisdiksiyaning rasmiy davlat saytlaridan yuklangan. Qonun matnini model hech qachon yozmaydi: norma bazaga faqat rasmiy manbadan fayl sifatida, manzili, nazorat summasi va yuklangan sanasi bilan tushadi. Manbasiz satr saqlanmaydi — buni maʼlumotlar bazasi cheklovi taqiqlaydi.',
      },
      cta: [
        {
          label: {
            ru: 'Проверить на своём договоре',
            en: 'Try it on your contract',
            de: 'Am eigenen Vertrag testen',
            ar: 'جرِّبها على عقدك',
            kk: 'Өз шартыңызда тексеру',
            uz: 'Oʻz shartnomangizda tekshirish',
          },
          to: '/login',
          variant: 'primary',
        },
        {
          label: {
            ru: 'Как устроен разбор',
            en: 'How the review works',
            de: 'Wie die Prüfung abläuft',
            ar: 'كيف تعمل المراجعة',
            kk: 'Талдау қалай жұмыс істейді',
            uz: 'Tahlil qanday ishlaydi',
          },
          to: '/contract-analysis',
          variant: 'secondary',
        },
      ],
    },

    {
      kind: 'prose',
      title: {
        ru: 'Мы считаем не юрисдикции, а нормы',
        en: 'We count provisions, not jurisdictions',
        de: 'Wir zählen Normen, nicht Rechtsordnungen',
        ar: 'نحن نَعُدّ النصوص، لا الولايات القضائية',
        kk: 'Біз юрисдикцияларды емес, нормаларды санаймыз',
        uz: 'Biz yurisdiksiyalarni emas, normalarni sanaymiz',
      },
      paragraphs: [
        {
          ru: '«Семь юрисдикций» — цифра, которая ничего не говорит. Один акт даёт 2798 норм (Гражданское уложение Германии), другой — 23. Поэтому единица измерения у нас одна: норма, то есть статья, параграф или пункт, у которого есть свой номер и свой текст.',
          en: '“Seven jurisdictions” is a number that tells you nothing. One act yields 2,798 provisions (the German Civil Code), another yields 23. So we use a single unit of measure: the provision — an article, section or paragraph with its own number and its own text.',
          de: '„Sieben Rechtsordnungen“ ist eine Zahl, die nichts aussagt. Ein Gesetz liefert 2798 Normen (das BGB), ein anderes 23. Deshalb gilt bei uns eine einzige Maßeinheit: die Norm — ein Paragraf, Artikel oder Absatz mit eigener Nummer und eigenem Text.',
          ar: '«سبع ولايات قضائية» رقم لا يقول شيئًا. تشريع واحد يعطي 2798 نصًا (القانون المدني الألماني)، وآخر يعطي 23. لذلك نعتمد وحدة قياس واحدة: النص — مادة أو فقرة لها رقمها ونصها.',
          kk: '«Жеті юрисдикция» — ештеңе айтпайтын сан. Бір акт 2798 норма береді (Германияның Азаматтық кодексі), басқасы — 23. Сондықтан бізде өлшем бірлігі біреу: норма, яғни өз нөмірі мен өз мәтіні бар бап немесе тармақ.',
          uz: '«Yettita yurisdiksiya» — hech nima aytmaydigan raqam. Bitta hujjat 2798 norma beradi (Germaniya Fuqarolik kodeksi), boshqasi — 23. Shuning uchun bizda oʻlchov birligi bitta: norma, yaʼni oʻz raqami va oʻz matni bor modda yoki band.',
        },
        {
          ru: 'Акт загружается целиком или не загружается вовсе. Мы не берём «избранные статьи»: выборка создаёт ложное впечатление полноты и прячет пробел ровно там, где он опаснее всего.',
          en: 'An act is loaded in full or not at all. We do not take “selected articles”: a selection creates a false sense of completeness and hides the gap exactly where it is most dangerous.',
          de: 'Ein Gesetz wird vollständig geladen oder gar nicht. Wir nehmen keine „ausgewählten Paragrafen“: Eine Auswahl erzeugt den falschen Eindruck von Vollständigkeit und verbirgt die Lücke genau dort, wo sie am gefährlichsten ist.',
          ar: 'يُحمَّل التشريع كاملًا أو لا يُحمَّل إطلاقًا. لا نأخذ «مواد مختارة»: الانتقاء يخلق انطباعًا زائفًا بالاكتمال ويخفي الثغرة في أخطر موضع بالضبط.',
          kk: 'Акт толығымен жүктеледі немесе мүлде жүктелмейді. Біз «таңдамалы баптарды» алмаймыз: таңдау толықтық туралы жалған әсер қалдырады және олқылықты дәл ең қауіпті жерде жасырады.',
          uz: 'Hujjat toʻliq yuklanadi yoki umuman yuklanmaydi. Biz «tanlangan moddalarni» olmaymiz: tanlov toʻliqlik haqida yolgʻon taassurot qoldiradi va boʻshliqni aynan eng xavfli joyda yashiradi.',
        },
      ],
    },

    {
      kind: 'facts',
      title: {
        ru: 'Корпус в цифрах',
        en: 'The corpus in numbers',
        de: 'Der Korpus in Zahlen',
        ar: 'القاعدة بالأرقام',
        kk: 'Корпус сандармен',
        uz: 'Korpus raqamlarda',
      },
      items: [
        {
          value: { ru: '17 248', en: '17,248', de: '17 248', ar: '17٬248', kk: '17 248', uz: '17 248' },
          label: {
            ru: 'норм в базе',
            en: 'provisions in the base',
            de: 'Normen in der Basis',
            ar: 'نصًا في القاعدة',
            kk: 'норма базада',
            uz: 'norma bazada',
          },
          proof: {
            ru: 'Статьи, параграфы и пункты из 100 официальных документов. Замер по базе 05.08.2026.',
            en: 'Articles, sections and paragraphs from 100 official documents. Measured 5 Aug 2026.',
            de: 'Paragrafen, Artikel und Absätze aus 100 amtlichen Dokumenten. Messung vom 05.08.2026.',
            ar: 'مواد وفقرات من 100 وثيقة رسمية. القياس بتاريخ 05.08.2026.',
            kk: '100 ресми құжаттағы баптар мен тармақтар. 05.08.2026 өлшемі.',
            uz: '100 ta rasmiy hujjatdagi moddalar va bandlar. 05.08.2026 oʻlchovi.',
          },
        },
        {
          value: { ru: '7', en: '7', de: '7', ar: '7', kk: '7', uz: '7' },
          label: {
            ru: 'официальных источников',
            en: 'official sources',
            de: 'amtliche Quellen',
            ar: 'مصادر رسمية',
            kk: 'ресми дереккөз',
            uz: 'rasmiy manba',
          },
          proof: {
            ru: 'Государственные правовые порталы. Загрузка с любого другого адреса в коде запрещена — список ниже.',
            en: 'Government legal portals. Loading from any other address is forbidden in code — the list is below.',
            de: 'Staatliche Rechtsportale. Das Laden von jeder anderen Adresse ist im Code untersagt — Liste unten.',
            ar: 'بوابات قانونية حكومية. التحميل من أي عنوان آخر ممنوع في الشيفرة — القائمة أدناه.',
            kk: 'Мемлекеттік құқықтық порталдар. Кез келген басқа мекенжайдан жүктеу кодта тыйым салынған — тізім төменде.',
            uz: 'Davlat huquqiy portallari. Boshqa har qanday manzildan yuklash kodda taqiqlangan — roʻyxat quyida.',
          },
        },
        {
          value: { ru: '100 %', en: '100%', de: '100 %', ar: '100٪', kk: '100 %', uz: '100 %' },
          label: {
            ru: 'фрагментов с векторным индексом',
            en: 'of fragments carry a vector index',
            de: 'der Fragmente mit Vektorindex',
            ar: 'من المقاطع لها فهرس متجهي',
            kk: 'фрагменттің векторлық индексі бар',
            uz: 'fragmentda vektor indeksi bor',
          },
          proof: {
            ru: '14 357 фрагментов, у всех 14 357 построен вектор — поиск по смыслу работает по всему корпусу, а не по его части.',
            en: '14,357 fragments, all 14,357 vectorised — semantic search covers the whole corpus, not a part of it.',
            de: '14 357 Fragmente, alle 14 357 vektorisiert — die semantische Suche deckt den gesamten Korpus ab, nicht nur einen Teil.',
            ar: '14٬357 مقطعًا، وجميعها 14٬357 مُتَّجهة — البحث الدلالي يغطي القاعدة كلها لا جزءًا منها.',
            kk: '14 357 фрагмент, барлық 14 357-інде вектор бар — мағыналық іздеу бүкіл корпус бойынша жұмыс істейді.',
            uz: '14 357 fragment, barchasi 14 357 tasi vektorlangan — maʼno boʻyicha qidiruv butun korpus boʻylab ishlaydi.',
          },
        },
        {
          value: { ru: '0', en: '0', de: '0', ar: '0', kk: '0', uz: '0' },
          label: {
            ru: 'норм, написанных моделью',
            en: 'provisions written by the model',
            de: 'vom Modell verfasste Normen',
            ar: 'نصوص كتبها النموذج',
            kk: 'модель жазған норма',
            uz: 'model yozgan norma',
          },
          proof: {
            ru: 'Недоступен источник — документ помечается «отсутствует». Восстанавливать текст закона «по памяти» в коде запрещено.',
            en: 'If a source is unavailable, the document is marked “missing”. Reconstructing statutory text “from memory” is forbidden in code.',
            de: 'Ist eine Quelle nicht erreichbar, wird das Dokument als „fehlend“ markiert. Gesetzestext „aus dem Gedächtnis“ zu rekonstruieren, ist im Code untersagt.',
            ar: 'إذا تعذَّر الوصول إلى المصدر، تُوسَم الوثيقة بـ«مفقودة». إعادة كتابة نص القانون «من الذاكرة» ممنوعة في الشيفرة.',
            kk: 'Дереккөз қолжетімсіз болса, құжат «жоқ» деп белгіленеді. Заң мәтінін «жадынан» қалпына келтіру кодта тыйым салынған.',
            uz: 'Manba mavjud boʻlmasa, hujjat «yoʻq» deb belgilanadi. Qonun matnini «xotiradan» tiklash kodda taqiqlangan.',
          },
        },
      ],
    },

    {
      kind: 'table',
      title: {
        ru: 'Что именно загружено по каждой юрисдикции',
        en: 'Exactly what is loaded for each jurisdiction',
        de: 'Was genau je Rechtsordnung geladen ist',
        ar: 'ما المُحمَّل بالضبط لكل ولاية قضائية',
        kk: 'Әр юрисдикция бойынша нақты не жүктелген',
        uz: 'Har bir yurisdiksiya boʻyicha aniq nima yuklangan',
      },
      intro: {
        ru: 'Колонка «чего нет» — не мелкий шрифт внизу страницы, а часть таблицы. Пробел, о котором вы узнали здесь, дешевле пробела, найденного в работе.',
        en: 'The “what is missing” column is part of the table, not small print at the bottom. A gap you learn about here is cheaper than a gap found mid-work.',
        de: 'Die Spalte „was fehlt“ ist Teil der Tabelle, nicht Kleingedrucktes am Seitenende. Eine Lücke, die Sie hier erfahren, ist billiger als eine, die Sie bei der Arbeit finden.',
        ar: 'عمود «ما الناقص» جزء من الجدول لا حاشية في أسفل الصفحة. الثغرة التي تعرفها هنا أرخص من ثغرة تكتشفها أثناء العمل.',
        kk: '«Не жоқ» бағаны — беттің төменіндегі ұсақ жазу емес, кестенің бір бөлігі. Осында білген олқылық жұмыс үстінде табылғаннан арзан.',
        uz: '«Nima yoʻq» ustuni — sahifa pastidagi mayda yozuv emas, jadvalning bir qismi. Shu yerda bilgan boʻshliq ish vaqtida topilganidan arzon.',
      },
      columns: [
        { ru: 'Юрисдикция', en: 'Jurisdiction', de: 'Rechtsordnung', ar: 'الولاية القضائية', kk: 'Юрисдикция', uz: 'Yurisdiksiya' },
        { ru: 'Документов', en: 'Documents', de: 'Dokumente', ar: 'وثائق', kk: 'Құжат', uz: 'Hujjat' },
        { ru: 'Норм', en: 'Provisions', de: 'Normen', ar: 'نصوص', kk: 'Норма', uz: 'Norma' },
        { ru: 'Чего нет', en: 'What is missing', de: 'Was fehlt', ar: 'ما الناقص', kk: 'Не жоқ', uz: 'Nima yoʻq' },
      ],
      rows: [
        [
          { ru: 'Узбекистан', en: 'Uzbekistan', de: 'Usbekistan', ar: 'أوزبكستان', kk: 'Өзбекстан', uz: 'Oʻzbekiston' },
          { ru: '83', en: '83', de: '83', ar: '83', kk: '83', uz: '83' },
          { ru: '8131', en: '8,131', de: '8131', ar: '8٬131', kk: '8131', uz: '8131' },
          {
            ru: 'Постановлений Кабинета Министров нет; редакций на прошедшую дату нет',
            en: 'No Cabinet of Ministers resolutions; no point-in-time versions',
            de: 'Keine Beschlüsse des Ministerkabinetts; keine Fassungen zu einem Stichtag',
            ar: 'لا قرارات لمجلس الوزراء؛ ولا نسخ بتاريخ سابق',
            kk: 'Министрлер Кабинетінің қаулылары жоқ; өткен күнгі редакциялар жоқ',
            uz: 'Vazirlar Mahkamasi qarorlari yoʻq; oʻtgan sanadagi tahrirlar yoʻq',
          },
        ],
        [
          { ru: 'Германия', en: 'Germany', de: 'Deutschland', ar: 'ألمانيا', kk: 'Германия', uz: 'Germaniya' },
          { ru: '1', en: '1', de: '1', ar: '1', kk: '1', uz: '1' },
          { ru: '2798', en: '2,798', de: '2798', ar: '2٬798', kk: '2798', uz: '2798' },
          {
            ru: 'Только Гражданское уложение (BGB): нет HGB, нет трудового и корпоративного права',
            en: 'Civil Code (BGB) only: no HGB, no employment or corporate law',
            de: 'Nur das BGB: kein HGB, kein Arbeits- oder Gesellschaftsrecht',
            ar: 'القانون المدني (BGB) فقط: لا قانون تجاري ولا عمل ولا شركات',
            kk: 'Тек Азаматтық кодекс (BGB): HGB жоқ, еңбек және корпоративтік құқық жоқ',
            uz: 'Faqat Fuqarolik kodeksi (BGB): HGB yoʻq, mehnat va korporativ huquq yoʻq',
          },
        ],
        [
          { ru: 'Великобритания', en: 'United Kingdom', de: 'Vereinigtes Königreich', ar: 'المملكة المتحدة', kk: 'Ұлыбритания', uz: 'Buyuk Britaniya' },
          { ru: '8', en: '8', de: '8', ar: '8', kk: '8', uz: '8' },
          { ru: '2148', en: '2,148', de: '2148', ar: '2٬148', kk: '2148', uz: '2148' },
          {
            ru: 'Восемь актов договорного и потребительского блока; приложения (schedules) и исторические редакции не загружены',
            en: 'Eight contract- and consumer-law acts; schedules and historical versions are not loaded',
            de: 'Acht Gesetze zum Vertrags- und Verbraucherrecht; Schedules und historische Fassungen fehlen',
            ar: 'ثمانية تشريعات في العقود وحماية المستهلك؛ الجداول والنسخ التاريخية غير محمَّلة',
            kk: 'Шарт және тұтынушылық сегіз акт; қосымшалар мен тарихи редакциялар жүктелмеген',
            uz: 'Shartnoma va isteʼmolchi sohasidagi sakkiz hujjat; ilovalar va tarixiy tahrirlar yuklanmagan',
          },
        ],
        [
          { ru: 'ОАЭ', en: 'UAE', de: 'VAE', ar: 'الإمارات', kk: 'БАӘ', uz: 'BAA' },
          { ru: '1', en: '1', de: '1', ar: '1', kk: '1', uz: '1' },
          { ru: '1526', en: '1,526', de: '1526', ar: '1٬526', kk: '1526', uz: '1526' },
          {
            ru: 'Только Гражданский кодекс (закон № 5 от 1985 г.) в официальном английском переводе; арабский оригинал не загружен',
            en: 'Civil Code only (Federal Law No. 5 of 1985) in the official English translation; the Arabic original is not loaded',
            de: 'Nur das Zivilgesetzbuch (Gesetz Nr. 5/1985) in der amtlichen englischen Übersetzung; das arabische Original fehlt',
            ar: 'القانون المدني فقط (القانون الاتحادي رقم 5 لسنة 1985) بالترجمة الإنجليزية الرسمية؛ الأصل العربي غير محمَّل',
            kk: 'Тек Азаматтық кодекс (1985 ж. № 5 заң) ресми ағылшын аудармасында; араб түпнұсқасы жүктелмеген',
            uz: 'Faqat Fuqarolik kodeksi (1985-yil 5-son qonun) rasmiy ingliz tarjimasida; arab asli yuklanmagan',
          },
        ],
        [
          { ru: 'Казахстан', en: 'Kazakhstan', de: 'Kasachstan', ar: 'كازاخستان', kk: 'Қазақстан', uz: 'Qozogʻiston' },
          { ru: '4', en: '4', de: '4', ar: '4', kk: '4', uz: '4' },
          { ru: '1328', en: '1,328', de: '1328', ar: '1٬328', kk: '1328', uz: '1328' },
          {
            ru: 'Гражданский кодекс (обе части), права потребителей, электронная подпись — и всё; налогового и трудового нет',
            en: 'Civil Code (both parts), consumer rights, e-signature — and that is all; no tax or employment law',
            de: 'Zivilgesetzbuch (beide Teile), Verbraucherrechte, elektronische Signatur — mehr nicht; kein Steuer- oder Arbeitsrecht',
            ar: 'القانون المدني (بجزأيه)، وحقوق المستهلك، والتوقيع الإلكتروني — لا غير؛ لا ضرائب ولا عمل',
            kk: 'Азаматтық кодекс (екі бөлім), тұтынушы құқықтары, электрондық қолтаңба — бары осы; салық және еңбек құқығы жоқ',
            uz: 'Fuqarolik kodeksi (ikkala qism), isteʼmolchi huquqlari, elektron imzo — shu xolos; soliq va mehnat huquqi yoʻq',
          },
        ],
        [
          { ru: 'Канада', en: 'Canada', de: 'Kanada', ar: 'كندا', kk: 'Канада', uz: 'Kanada' },
          { ru: '1', en: '1', de: '1', ar: '1', kk: '1', uz: '1' },
          { ru: '1271', en: '1,271', de: '1271', ar: '1٬271', kk: '1271', uz: '1271' },
          {
            ru: 'Только Квебек: книга «Обязательства» Гражданского кодекса. Общее право остальных провинций — вне корпуса',
            en: 'Quebec only: the “Obligations” book of the Civil Code. The common law of other provinces is outside the corpus',
            de: 'Nur Québec: das Buch „Obligationen“ des Zivilgesetzbuchs. Das Common Law der übrigen Provinzen liegt außerhalb',
            ar: 'كيبيك فقط: كتاب «الالتزامات» من القانون المدني. القانون العام لبقية المقاطعات خارج القاعدة',
            kk: 'Тек Квебек: Азаматтық кодекстің «Міндеттемелер» кітабы. Басқа провинциялардың жалпы құқығы корпустан тыс',
            uz: 'Faqat Kvebek: Fuqarolik kodeksining «Majburiyatlar» kitobi. Boshqa provinsiyalarning umumiy huquqi korpusdan tashqarida',
          },
        ],
        [
          { ru: 'США (федеральный уровень)', en: 'USA (federal level)', de: 'USA (Bundesebene)', ar: 'الولايات المتحدة (المستوى الاتحادي)', kk: 'АҚШ (федералдық деңгей)', uz: 'AQSh (federal daraja)' },
          { ru: '2', en: '2', de: '2', ar: '2', kk: '2', uz: '2' },
          { ru: '46', en: '46', de: '46', ar: '46', kk: '46', uz: '46' },
          {
            ru: 'Только арбитраж и электронные подписи. Ядро договорного права США — право штатов, его нет',
            en: 'Arbitration and e-signatures only. The core of US contract law is state law and is absent',
            de: 'Nur Schiedsverfahren und elektronische Signaturen. Der Kern des US-Vertragsrechts ist Landesrecht und fehlt',
            ar: 'التحكيم والتوقيعات الإلكترونية فقط. جوهر قانون العقود الأمريكي قانون ولايات وهو غير موجود',
            kk: 'Тек арбитраж және электрондық қолтаңбалар. АҚШ шарт құқығының өзегі — штаттар құқығы, ол жоқ',
            uz: 'Faqat arbitraj va elektron imzolar. AQSh shartnoma huquqining oʻzagi — shtatlar huquqi, u yoʻq',
          },
        ],
      ],
      note: {
        ru: 'Замер по боевой базе 5 августа 2026 года. Корпус пополняется — цифры на этой странице обновляются вместе с ним.',
        en: 'Measured against the production database on 5 August 2026. The corpus grows — the figures on this page are updated with it.',
        de: 'Messung an der Produktionsdatenbank am 5. August 2026. Der Korpus wächst — die Zahlen auf dieser Seite werden mitgeführt.',
        ar: 'قياس على قاعدة البيانات الإنتاجية في 5 أغسطس 2026. القاعدة تنمو — والأرقام هنا تُحدَّث معها.',
        kk: '2026 жылғы 5 тамыздағы өндірістік база бойынша өлшем. Корпус толығады — беттегі сандар онымен бірге жаңарады.',
        uz: '2026-yil 5-avgustdagi ishchi baza boʻyicha oʻlchov. Korpus toʻlib boradi — sahifadagi raqamlar u bilan birga yangilanadi.',
      },
    },

    {
      kind: 'note',
      title: {
        ru: '46 норм по США — это не обрезанные США',
        en: '46 US provisions is not a truncated USA',
        de: '46 Normen für die USA sind keine gekürzten USA',
        ar: '46 نصًا للولايات المتحدة ليست «أمريكا مقتطعة»',
        kk: 'АҚШ бойынша 46 норма — қиылған АҚШ емес',
        uz: 'AQSh boʻyicha 46 norma — qirqilgan AQSh emas',
      },
      body: {
        ru: 'Это два коротких федеральных акта целиком: закон об арбитраже (FAA) и закон об электронных подписях (E-SIGN). Договорное право США живёт в праве штатов — прежде всего в статье 2 Единообразного торгового кодекса. Мы не добавляем её, пока нет официального машиночитаемого источника штата: зеркала вроде Cornell или Justia официальными не являются, а выдавать неофициальный текст за закон в юридическом продукте недопустимо.',
        en: 'These are two short federal acts in full: the Federal Arbitration Act and the E-SIGN Act. US contract law lives in state law — above all in Article 2 of the Uniform Commercial Code. We will not add it until an official machine-readable state source exists: mirrors such as Cornell or Justia are not official, and passing off unofficial text as law is unacceptable in a legal product.',
        de: 'Das sind zwei kurze Bundesgesetze in Gänze: der Federal Arbitration Act und der E-SIGN Act. Das US-Vertragsrecht liegt im Recht der Bundesstaaten — vor allem in Artikel 2 des Uniform Commercial Code. Wir nehmen ihn erst auf, wenn eine amtliche maschinenlesbare Quelle eines Bundesstaates vorliegt: Spiegel wie Cornell oder Justia sind nicht amtlich, und inoffiziellen Text als Gesetz auszugeben, ist in einem Rechtsprodukt inakzeptabel.',
        ar: 'هما تشريعان اتحاديان قصيران بالكامل: قانون التحكيم الاتحادي وقانون التوقيع الإلكتروني. قانون العقود الأمريكي يقع في قوانين الولايات — وخاصة المادة 2 من القانون التجاري الموحد. لن نضيفه قبل توفر مصدر رسمي للولاية قابل للقراءة آليًا: مرايا مثل Cornell أو Justia ليست رسمية، وتقديم نص غير رسمي على أنه قانون غير مقبول في منتج قانوني.',
        kk: 'Бұл — екі қысқа федералдық акт толығымен: арбитраж туралы заң (FAA) және электрондық қолтаңба туралы заң (E-SIGN). АҚШ шарт құқығы штаттар құқығында — ең алдымен Бірыңғай сауда кодексінің 2-бабында. Штаттың ресми машинамен оқылатын дереккөзі пайда болғанша оны қоспаймыз: Cornell немесе Justia сияқты айналар ресми емес, ал бейресми мәтінді заң деп ұсыну құқықтық өнімде жол берілмейді.',
        uz: 'Bular — ikkita qisqa federal hujjat toʻliq holda: arbitraj toʻgʻrisidagi qonun (FAA) va elektron imzo toʻgʻrisidagi qonun (E-SIGN). AQSh shartnoma huquqi shtatlar huquqida — avvalo Yagona savdo kodeksining 2-moddasida. Shtatning rasmiy mashinada oʻqiladigan manbasi paydo boʻlmaguncha uni qoʻshmaymiz: Cornell yoki Justia kabi koʻzgular rasmiy emas, norasmiy matnni qonun sifatida taqdim etish esa huquqiy mahsulotda mumkin emas.',
      },
    },

    {
      kind: 'steps',
      title: {
        ru: 'Как норма попадает в базу',
        en: 'How a provision gets into the base',
        de: 'Wie eine Norm in die Basis gelangt',
        ar: 'كيف يدخل النص إلى القاعدة',
        kk: 'Норма базаға қалай түседі',
        uz: 'Norma bazaga qanday tushadi',
      },
      items: [
        {
          title: {
            ru: 'Адрес из белого списка',
            en: 'An address from the whitelist',
            de: 'Adresse aus der Positivliste',
            ar: 'عنوان من القائمة البيضاء',
            kk: 'Ақ тізімдегі мекенжай',
            uz: 'Oq roʻyxatdagi manzil',
          },
          body: {
            ru: 'Загрузчик умеет ходить только на государственные правовые порталы из списка ниже. Другого адреса в коде просто нет.',
            en: 'The loader can only reach the government legal portals listed below. No other address exists in the code.',
            de: 'Der Lader erreicht ausschließlich die unten genannten staatlichen Rechtsportale. Eine andere Adresse gibt es im Code nicht.',
            ar: 'المُحمِّل لا يصل إلا إلى البوابات القانونية الحكومية المذكورة أدناه. لا يوجد عنوان آخر في الشيفرة.',
            kk: 'Жүктеуші тек төмендегі мемлекеттік құқықтық порталдарға бара алады. Кодта басқа мекенжай жоқ.',
            uz: 'Yuklovchi faqat quyidagi davlat huquqiy portallariga bora oladi. Kodda boshqa manzil yoʻq.',
          },
        },
        {
          title: {
            ru: 'Отпечаток и дата',
            en: 'Fingerprint and date',
            de: 'Prüfsumme und Datum',
            ar: 'بصمة وتاريخ',
            kk: 'Із және күн',
            uz: 'Iz va sana',
          },
          body: {
            ru: 'Считается контрольная сумма файла и записывается дата загрузки. Без адреса, суммы и даты строка не сохраняется — это условие в самой базе, а не проверка в коде, которую можно обойти.',
            en: 'The file checksum is computed and the retrieval date recorded. Without address, checksum and date the row is not saved — this is a condition in the database itself, not a code check that can be bypassed.',
            de: 'Die Prüfsumme der Datei wird berechnet und das Ladedatum festgehalten. Ohne Adresse, Prüfsumme und Datum wird der Datensatz nicht gespeichert — das ist eine Bedingung in der Datenbank selbst, keine umgehbare Codeprüfung.',
            ar: 'تُحسب بصمة الملف ويُسجَّل تاريخ التحميل. بدون العنوان والبصمة والتاريخ لا يُحفَظ الصف — وهذا شرط في قاعدة البيانات نفسها لا فحص برمجي يمكن تجاوزه.',
            kk: 'Файлдың бақылау сомасы есептеліп, жүктелген күні жазылады. Мекенжайсыз, сомасыз және күнсіз жол сақталмайды — бұл дерекқордың өз шарты, айналып өтуге болатын код тексерісі емес.',
            uz: 'Fayl nazorat summasi hisoblanadi va yuklangan sana yoziladi. Manzil, summa va sanasiz satr saqlanmaydi — bu maʼlumotlar bazasining oʻz sharti, chetlab oʻtish mumkin boʻlgan kod tekshiruvi emas.',
          },
        },
        {
          title: {
            ru: 'Разбор на нормы',
            en: 'Parsing into provisions',
            de: 'Zerlegung in Normen',
            ar: 'التفكيك إلى نصوص',
            kk: 'Нормаларға бөлу',
            uz: 'Normalarga ajratish',
          },
          body: {
            ru: 'Документ режется на отдельные статьи и пункты со своими номерами. Пропуски в нумерации сохраняются как есть: исключённая статья — это факт закона, а не ошибка разбора.',
            en: 'The document is split into individual articles and paragraphs with their own numbers. Gaps in numbering are kept as they are: a repealed article is a fact of the law, not a parsing error.',
            de: 'Das Dokument wird in einzelne Paragrafen und Absätze mit eigenen Nummern zerlegt. Lücken in der Nummerierung bleiben erhalten: Ein aufgehobener Paragraf ist eine Tatsache des Gesetzes, kein Parsingfehler.',
            ar: 'تُقسَّم الوثيقة إلى مواد وفقرات لكل منها رقمها. تُحفَظ الفجوات في الترقيم كما هي: المادة الملغاة حقيقة قانونية لا خطأ تفكيك.',
            kk: 'Құжат өз нөмірлері бар жеке баптар мен тармақтарға бөлінеді. Нөмірлеудегі олқылықтар сол күйі сақталады: алынып тасталған бап — заң фактісі, талдау қатесі емес.',
            uz: 'Hujjat oʻz raqamlari bor alohida moddalar va bandlarga boʻlinadi. Raqamlashdagi boʻshliqlar shundayligicha saqlanadi: chiqarib tashlangan modda — qonun fakti, tahlil xatosi emas.',
          },
        },
        {
          title: {
            ru: 'Два индекса поиска',
            en: 'Two search indexes',
            de: 'Zwei Suchindizes',
            ar: 'فهرسان للبحث',
            kk: 'Іздеудің екі индексі',
            uz: 'Qidiruvning ikki indeksi',
          },
          body: {
            ru: 'Каждый фрагмент попадает и в словесный поиск с учётом морфологии языка, и в поиск по смыслу. Результаты двух поисков объединяются и переупорядочиваются отдельной моделью — так находится норма, в которой нет ни одного слова из вашего вопроса.',
            en: 'Every fragment enters both a keyword index that respects the morphology of its language and a semantic index. The two result sets are merged and re-ranked by a separate model — that is how a provision containing none of your query words still gets found.',
            de: 'Jedes Fragment landet sowohl in einer Wortsuche mit Sprachmorphologie als auch in einer Bedeutungssuche. Beide Ergebnismengen werden zusammengeführt und von einem eigenen Modell neu sortiert — so wird auch eine Norm gefunden, die kein einziges Wort Ihrer Frage enthält.',
            ar: 'كل مقطع يدخل بحثًا لفظيًا يراعي صرف اللغة وبحثًا دلاليًا معًا. تُدمج النتيجتان ويُعاد ترتيبهما بنموذج منفصل — وهكذا يُعثر على نص لا يحوي أي كلمة من سؤالك.',
            kk: 'Әр фрагмент тіл морфологиясын ескеретін сөздік іздеуге де, мағыналық іздеуге де түседі. Екі нәтиже біріктіріліп, бөлек модельмен қайта реттеледі — осылайша сұрағыңыздағы бірде-бір сөз жоқ норма да табылады.',
            uz: 'Har bir fragment til morfologiyasini hisobga oluvchi soʻzli qidiruvga ham, maʼnoviy qidiruvga ham tushadi. Ikki natija birlashtirilib, alohida model bilan qayta tartiblanadi — shu tarzda savolingizdagi birorta soʻz yoʻq norma ham topiladi.',
          },
        },
      ],
    },

    {
      kind: 'list',
      title: {
        ru: 'Как проверяется цитата',
        en: 'How a citation is verified',
        de: 'Wie eine Fundstelle geprüft wird',
        ar: 'كيف يُتحقَّق من الإحالة',
        kk: 'Дәйексөз қалай тексеріледі',
        uz: 'Iqtibos qanday tekshiriladi',
      },
      intro: {
        ru: 'Проверка живёт в коде, а не в инструкции для модели. Инструкцию модель может «забыть»; код — нет.',
        en: 'The check lives in code, not in an instruction to the model. A model can “forget” an instruction; code cannot.',
        de: 'Die Prüfung steckt im Code, nicht in einer Anweisung an das Modell. Eine Anweisung kann das Modell „vergessen“, Code nicht.',
        ar: 'الفحص في الشيفرة لا في تعليمات النموذج. النموذج قد «ينسى» التعليمة؛ الشيفرة لا تنسى.',
        kk: 'Тексеру модельге берілген нұсқаулықта емес, кодта. Нұсқаулықты модель «ұмытуы» мүмкін, код — жоқ.',
        uz: 'Tekshiruv modelga berilgan koʻrsatmada emas, kodda. Koʻrsatmani model «unutishi» mumkin, kod — yoʻq.',
      },
      items: [
        {
          title: {
            ru: 'Ссылка разбирается на номер и акт',
            en: 'The citation is parsed into number and act',
            de: 'Die Fundstelle wird in Nummer und Gesetz zerlegt',
            ar: 'تُفكَّك الإحالة إلى رقم وتشريع',
            kk: 'Сілтеме нөмір мен актіге бөлінеді',
            uz: 'Havola raqam va hujjatga ajratiladi',
          },
          body: {
            ru: '«ст. 353 ГК», «§ 433 BGB», «9 U.S.C. § 2», «п. 5 УП-6079» — форматы разных юрисдикций распознаются отдельно.',
            en: '“art. 353 Civil Code”, “§ 433 BGB”, “9 U.S.C. § 2”, “clause 5 of Decree UP-6079” — each jurisdiction’s format is recognised separately.',
            de: '„Art. 353 ZGB“, „§ 433 BGB“, „9 U.S.C. § 2“, „Ziff. 5 des Dekrets UP-6079“ — die Formate der Rechtsordnungen werden je einzeln erkannt.',
            ar: '«المادة 353 من القانون المدني»، «§ 433 BGB»، «9 U.S.C. § 2»، «البند 5 من المرسوم UP-6079» — كل صيغة ولاية تُميَّز على حدة.',
            kk: '«353-бап АК», «§ 433 BGB», «9 U.S.C. § 2», «УП-6079 5-тармақ» — әр юрисдикцияның пішімі бөлек танылады.',
            uz: '«353-modda FK», «§ 433 BGB», «9 U.S.C. § 2», «UP-6079 5-band» — har bir yurisdiksiya formati alohida tanib olinadi.',
          },
        },
        {
          title: {
            ru: 'Норма ищется в базе по точному номеру',
            en: 'The provision is looked up by exact number',
            de: 'Die Norm wird über die exakte Nummer gesucht',
            ar: 'يُبحث عن النص بالرقم الدقيق',
            kk: 'Норма нақты нөмір бойынша ізделеді',
            uz: 'Norma aniq raqam boʻyicha qidiriladi',
          },
          body: {
            ru: 'Совпадения «примерно похоже» не засчитываются: либо норма с таким номером в этом акте есть, либо ссылки нет.',
            en: 'Approximate matches do not count: either a provision with that number exists in that act, or there is no citation.',
            de: 'Ungefähre Treffer zählen nicht: Entweder existiert eine Norm mit dieser Nummer in diesem Gesetz — oder es gibt keine Fundstelle.',
            ar: 'التطابق «التقريبي» لا يُحتسب: إما أن يوجد نص بهذا الرقم في ذلك التشريع، أو لا إحالة.',
            kk: '«Шамамен ұқсас» сәйкестік есептелмейді: не осы актіде сондай нөмірлі норма бар, не сілтеме жоқ.',
            uz: '«Taxminan oʻxshash» moslik hisobga olinmaydi: yo shu hujjatda oʻsha raqamli norma bor, yo havola yoʻq.',
          },
        },
        {
          title: {
            ru: 'Неподтверждённая ссылка понижается и помечается',
            en: 'An unconfirmed citation is downgraded and flagged',
            de: 'Eine unbestätigte Fundstelle wird herabgestuft und markiert',
            ar: 'الإحالة غير المؤكدة تُخفَّض وتُوسَم',
            kk: 'Расталмаған сілтеме төмендетіліп, белгіленеді',
            uz: 'Tasdiqlanmagan havola pasaytiriladi va belgilanadi',
          },
          body: {
            ru: 'Находка остаётся видимой — но с меткой «не проверено», чтобы юрист сразу знал, где нужен собственный взгляд. Тихо удалять её было бы обманом другого рода.',
            en: 'The finding stays visible — but marked “unverified”, so a lawyer immediately knows where their own eyes are needed. Silently deleting it would be a different kind of deception.',
            de: 'Der Befund bleibt sichtbar — aber als „nicht geprüft“ markiert, damit die Anwältin sofort weiß, wo eigener Blick nötig ist. Ihn stillschweigend zu löschen wäre eine Täuschung anderer Art.',
            ar: 'تبقى الملاحظة ظاهرة — لكن موسومة بـ«غير مُتحقَّق منها»، ليعرف المحامي فورًا أين تلزم عينه. حذفها بصمت خداع من نوع آخر.',
            kk: 'Табылған нәрсе көрінеді — бірақ «тексерілмеген» белгісімен, заңгер өз көзі қажет жерді бірден білсін. Оны үнсіз жою — басқа түрдегі алдау.',
            uz: 'Topilma koʻrinib turadi — ammo «tekshirilmagan» belgisi bilan, yurist oʻz koʻzi kerak joyni darrov bilsin. Uni jimgina oʻchirish — boshqacha aldov.',
          },
        },
      ],
    },

    {
      kind: 'list',
      tone: 'limits',
      title: {
        ru: 'Границы базы',
        en: 'Limits of the base',
        de: 'Grenzen der Basis',
        ar: 'حدود القاعدة',
        kk: 'База шекаралары',
        uz: 'Baza chegaralari',
      },
      items: [
        {
          title: {
            ru: 'Судебной практики нет вовсе',
            en: 'There is no case law at all',
            de: 'Rechtsprechung gibt es überhaupt nicht',
            ar: 'لا توجد سوابق قضائية إطلاقًا',
            kk: 'Сот практикасы мүлде жоқ',
            uz: 'Sud amaliyoti umuman yoʻq',
          },
          body: {
            ru: 'В базе 0 судебных дел. Мы не ищем позиции судов и не проверяем ваш договор против практики — только против текста законов.',
            en: 'The base holds 0 court cases. We do not search for judicial positions and do not check your contract against case law — only against statutory text.',
            de: 'Die Basis enthält 0 Gerichtsentscheidungen. Wir suchen keine Rechtsprechung und prüfen Ihren Vertrag nicht gegen sie — nur gegen Gesetzestext.',
            ar: 'تحوي القاعدة 0 قضية. لا نبحث في مواقف المحاكم ولا نفحص عقدك في ضوء السوابق — بل في ضوء نصوص القوانين فقط.',
            kk: 'Базада 0 сот ісі. Біз соттардың ұстанымын іздемейміз және шартыңызды практикаға қарсы тексермейміз — тек заң мәтініне қарсы.',
            uz: 'Bazada 0 ta sud ishi. Biz sudlar pozitsiyasini qidirmaymiz va shartnomangizni amaliyotga qarshi tekshirmaymiz — faqat qonun matniga qarshi.',
          },
        },
        {
          title: {
            ru: 'Нет редакции на прошедшую дату',
            en: 'No point-in-time versions',
            de: 'Keine Fassung zu einem Stichtag',
            ar: 'لا نسخ بتاريخ سابق',
            kk: 'Өткен күнгі редакция жоқ',
            uz: 'Oʻtgan sanadagi tahrir yoʻq',
          },
          body: {
            ru: 'Хранится снимок действующей редакции. Вопрос «как эта статья выглядела в 2019 году» база не поддерживает.',
            en: 'A snapshot of the version in force is stored. The base cannot answer “how did this article read in 2019”.',
            de: 'Gespeichert ist ein Abbild der geltenden Fassung. Die Frage „Wie lautete der Paragraf 2019?“ beantwortet die Basis nicht.',
            ar: 'تُخزَّن لقطة من النسخة النافذة. لا تجيب القاعدة عن «كيف كانت هذه المادة عام 2019».',
            kk: 'Қолданыстағы редакцияның суреті сақталады. «Бұл бап 2019 жылы қалай болды» деген сұраққа база жауап бермейді.',
            uz: 'Amaldagi tahrir surati saqlanadi. «Bu modda 2019-yilda qanday edi» degan savolga baza javob bermaydi.',
          },
        },
        {
          title: {
            ru: 'Смысловые пометки построены не везде',
            en: 'Semantic annotations are not built everywhere',
            de: 'Semantische Anmerkungen sind nicht überall gebaut',
            ar: 'الشروح الدلالية ليست مبنيّة في كل مكان',
            kk: 'Мағыналық белгілер барлық жерде жасалмаған',
            uz: 'Maʼnoviy izohlar hamma joyda qurilmagan',
          },
          body: {
            ru: 'Для Великобритании и Узбекистана к каждому фрагменту достроен короткий контекст, который улучшает поиск. Для Казахстана, Германии, США, Канады и ОАЭ его нет — там поиск работает на тексте статьи, векторе и переупорядочивании.',
            en: 'For the UK and Uzbekistan each fragment carries a short generated context that improves retrieval. For Kazakhstan, Germany, the USA, Canada and the UAE it is absent — there search runs on the article text, the vector and re-ranking.',
            de: 'Für das Vereinigte Königreich und Usbekistan trägt jedes Fragment einen kurzen erzeugten Kontext, der die Suche verbessert. Für Kasachstan, Deutschland, die USA, Kanada und die VAE fehlt er — dort arbeitet die Suche mit Artikeltext, Vektor und Neuordnung.',
            ar: 'للمملكة المتحدة وأوزبكستان يحمل كل مقطع سياقًا قصيرًا مولَّدًا يحسّن الاستدعاء. أما كازاخستان وألمانيا والولايات المتحدة وكندا والإمارات فلا يوجد — يعمل البحث هناك على نص المادة والمتجه وإعادة الترتيب.',
            kk: 'Ұлыбритания мен Өзбекстан үшін әр фрагментке іздеуді жақсартатын қысқа контекст жасалған. Қазақстан, Германия, АҚШ, Канада және БАӘ үшін ол жоқ — онда іздеу бап мәтіні, вектор және қайта реттеу арқылы жұмыс істейді.',
            uz: 'Buyuk Britaniya va Oʻzbekiston uchun har bir fragmentga qidiruvni yaxshilaydigan qisqa kontekst qurilgan. Qozogʻiston, Germaniya, AQSh, Kanada va BAA uchun u yoʻq — u yerda qidiruv modda matni, vektor va qayta tartiblash asosida ishlaydi.',
          },
        },
        {
          title: {
            ru: 'База не заменяет юриста',
            en: 'The base does not replace a lawyer',
            de: 'Die Basis ersetzt keine Anwältin',
            ar: 'القاعدة لا تحل محل المحامي',
            kk: 'База заңгерді алмастырмайды',
            uz: 'Baza yuristni almashtirmaydi',
          },
          body: {
            ru: 'Ссылка на норму — основание для вашего решения, а не решение. Ответственность за вывод остаётся на человеке, который подписывает документ.',
            en: 'A citation is grounds for your decision, not the decision. Responsibility for the conclusion stays with the person who signs the document.',
            de: 'Eine Fundstelle ist Grundlage Ihrer Entscheidung, nicht die Entscheidung. Die Verantwortung trägt, wer das Dokument unterschreibt.',
            ar: 'الإحالة أساس لقرارك لا القرار نفسه. تبقى المسؤولية على من يوقّع المستند.',
            kk: 'Нормаға сілтеме — шешіміңіздің негізі, шешімнің өзі емес. Жауапкершілік құжатқа қол қоятын адамда қалады.',
            uz: 'Normaga havola — qaroringiz uchun asos, qarorning oʻzi emas. Javobgarlik hujjatga imzo chekadigan odamda qoladi.',
          },
        },
      ],
    },

    {
      kind: 'prose',
      title: {
        ru: 'Официальные источники',
        en: 'Official sources',
        de: 'Amtliche Quellen',
        ar: 'المصادر الرسمية',
        kk: 'Ресми дереккөздер',
        uz: 'Rasmiy manbalar',
      },
      paragraphs: [
        {
          ru: 'legislation.gov.uk · lex.uz · adilet.zan.kz · gesetze-im-internet.de · govinfo.gov · legisquebec.gouv.qc.ca · uaelegislation.gov.ae',
          en: 'legislation.gov.uk · lex.uz · adilet.zan.kz · gesetze-im-internet.de · govinfo.gov · legisquebec.gouv.qc.ca · uaelegislation.gov.ae',
          de: 'legislation.gov.uk · lex.uz · adilet.zan.kz · gesetze-im-internet.de · govinfo.gov · legisquebec.gouv.qc.ca · uaelegislation.gov.ae',
          ar: 'legislation.gov.uk · lex.uz · adilet.zan.kz · gesetze-im-internet.de · govinfo.gov · legisquebec.gouv.qc.ca · uaelegislation.gov.ae',
          kk: 'legislation.gov.uk · lex.uz · adilet.zan.kz · gesetze-im-internet.de · govinfo.gov · legisquebec.gouv.qc.ca · uaelegislation.gov.ae',
          uz: 'legislation.gov.uk · lex.uz · adilet.zan.kz · gesetze-im-internet.de · govinfo.gov · legisquebec.gouv.qc.ca · uaelegislation.gov.ae',
        },
        {
          ru: 'Это государственные правовые порталы соответствующих стран. У каждой загруженной нормы сохранён точный адрес страницы, с которой она взята, — его видно в разборе рядом с цитатой, и по нему можно открыть первоисточник.',
          en: 'These are the government legal portals of the respective countries. Every loaded provision keeps the exact address of the page it came from — visible next to the citation in the review, and clickable through to the original.',
          de: 'Das sind die staatlichen Rechtsportale der jeweiligen Länder. Zu jeder geladenen Norm ist die genaue Adresse der Herkunftsseite gespeichert — sie steht in der Prüfung neben der Fundstelle und führt zur Originalquelle.',
          ar: 'هذه بوابات قانونية حكومية للدول المعنية. لكل نص محمَّل عنوان الصفحة التي أُخذ منها — يظهر بجوار الإحالة في المراجعة ويفتح المصدر الأصلي.',
          kk: 'Бұл — тиісті елдердің мемлекеттік құқықтық порталдары. Әрбір жүктелген норманың алынған бетінің нақты мекенжайы сақталған — ол талдауда дәйексөз жанында көрінеді және түпнұсқаны ашады.',
          uz: 'Bular — tegishli davlatlarning davlat huquqiy portallari. Har bir yuklangan normaning olingan sahifasi aniq manzili saqlangan — u tahlilda iqtibos yonida koʻrinadi va asl manbani ochadi.',
        },
      ],
    },

    {
      kind: 'faq',
      title: {
        ru: 'Частые вопросы',
        en: 'Frequently asked questions',
        de: 'Häufige Fragen',
        ar: 'أسئلة متكررة',
        kk: 'Жиі қойылатын сұрақтар',
        uz: 'Koʻp beriladigan savollar',
      },
      items: [
        {
          q: {
            ru: 'Может ли система сослаться на несуществующую статью?',
            en: 'Can the system cite an article that does not exist?',
            de: 'Kann das System einen nicht existierenden Paragrafen zitieren?',
            ar: 'هل يمكن للنظام أن يستشهد بمادة غير موجودة؟',
            kk: 'Жүйе жоқ бапқа сілтеме жасай ала ма?',
            uz: 'Tizim mavjud boʻlmagan moddaga havola qila oladimi?',
          },
          a: {
            ru: 'Показать такую ссылку как подтверждённую — нет. Ссылка сверяется с базой по номеру, и если норма не найдена, находка помечается «не проверено». Метка видна в интерфейсе рядом с самой находкой.',
            en: 'It cannot show such a citation as confirmed. Every citation is matched against the base by number, and if the provision is not found the finding is marked “unverified”. The mark is visible next to the finding itself.',
            de: 'Als bestätigt anzeigen kann es sie nicht. Jede Fundstelle wird über die Nummer mit der Basis abgeglichen; wird die Norm nicht gefunden, gilt der Befund als „nicht geprüft“. Die Markierung steht direkt am Befund.',
            ar: 'لا يمكنه عرضها كإحالة مؤكدة. تُطابَق كل إحالة مع القاعدة بالرقم، وإن لم يُعثر على النص تُوسَم الملاحظة بـ«غير مُتحقَّق منها»، والوسم ظاهر بجوارها.',
            kk: 'Оны расталған деп көрсете алмайды. Әр сілтеме нөмір бойынша базамен салыстырылады, норма табылмаса, «тексерілмеген» деп белгіленеді. Белгі интерфейсте табылған нәрсенің жанында көрінеді.',
            uz: 'Uni tasdiqlangan sifatida koʻrsata olmaydi. Har bir havola raqam boʻyicha baza bilan solishtiriladi, norma topilmasa, topilma «tekshirilmagan» deb belgilanadi. Belgi interfeysda topilma yonida koʻrinadi.',
          },
        },
        {
          q: {
            ru: 'Почему так мало документов по некоторым странам?',
            en: 'Why are there so few documents for some countries?',
            de: 'Warum gibt es für manche Länder so wenige Dokumente?',
            ar: 'لماذا عدد الوثائق قليل لبعض الدول؟',
            kk: 'Кейбір елдер бойынша құжат неге аз?',
            uz: 'Ayrim davlatlar boʻyicha hujjat nega kam?',
          },
          a: {
            ru: 'Потому что мы берём только то, что доступно машиночитаемо на официальном портале, и берём целиком. Германия — один акт, но 2798 норм. США — два акта и 46 норм, и мы прямо пишем, что ядра договорного права там нет.',
            en: 'Because we take only what is machine-readable on an official portal, and we take it whole. Germany is one act — but 2,798 provisions. The USA is two acts and 46 provisions, and we say outright that the core of contract law is not there.',
            de: 'Weil wir nur nehmen, was auf einem amtlichen Portal maschinenlesbar vorliegt — und zwar vollständig. Deutschland ist ein Gesetz, aber 2798 Normen. Die USA sind zwei Gesetze mit 46 Normen, und wir sagen offen, dass der Kern des Vertragsrechts fehlt.',
            ar: 'لأننا نأخذ فقط ما هو متاح آليًا على بوابة رسمية، ونأخذه كاملًا. ألمانيا تشريع واحد لكنه 2798 نصًا. والولايات المتحدة تشريعان و46 نصًا، ونقول صراحة إن جوهر قانون العقود غير موجود.',
            kk: 'Себебі біз ресми порталда машинамен оқылатын түрде барын ғана және толығымен аламыз. Германия — бір акт, бірақ 2798 норма. АҚШ — екі акт, 46 норма, әрі шарт құқығының өзегі жоқ екенін ашық жазамыз.',
            uz: 'Chunki biz faqat rasmiy portalda mashinada oʻqiladigan holda borini va toʻliq olamiz. Germaniya — bitta hujjat, ammo 2798 norma. AQSh — ikkita hujjat va 46 norma, shartnoma huquqi oʻzagi yoʻqligini ochiq yozamiz.',
          },
        },
        {
          q: {
            ru: 'Что будет, если официальный сайт изменит текст закона?',
            en: 'What happens if the official site changes the text of a law?',
            de: 'Was passiert, wenn die amtliche Seite den Gesetzestext ändert?',
            ar: 'ماذا لو غيّر الموقع الرسمي نص القانون؟',
            kk: 'Ресми сайт заң мәтінін өзгертсе не болады?',
            uz: 'Rasmiy sayt qonun matnini oʻzgartirsa nima boʻladi?',
          },
          a: {
            ru: 'У каждого документа сохранена контрольная сумма и дата загрузки, поэтому расхождение видно при повторной загрузке — документ обновляется целиком. Указы и постановления правятся часто, их мы перезагружаем периодически.',
            en: 'Each document keeps a checksum and a retrieval date, so a divergence shows up on the next load and the document is refreshed in full. Decrees and resolutions change often, so we re-load them periodically.',
            de: 'Zu jedem Dokument sind Prüfsumme und Ladedatum gespeichert; eine Abweichung fällt beim erneuten Laden auf, und das Dokument wird vollständig aktualisiert. Dekrete und Beschlüsse ändern sich häufig — die laden wir regelmäßig neu.',
            ar: 'لكل وثيقة بصمة وتاريخ تحميل، فيظهر الاختلاف عند إعادة التحميل وتُحدَّث الوثيقة كاملة. المراسيم والقرارات تتغير كثيرًا، لذا نعيد تحميلها دوريًا.',
            kk: 'Әр құжаттың бақылау сомасы мен жүктелген күні сақталған, сондықтан айырма қайта жүктегенде көрінеді — құжат толығымен жаңарады. Жарлықтар мен қаулылар жиі өзгереді, оларды мерзімді түрде қайта жүктейміз.',
            uz: 'Har bir hujjatning nazorat summasi va yuklangan sanasi saqlanadi, shuning uchun farq qayta yuklashda koʻrinadi — hujjat toʻliq yangilanadi. Farmon va qarorlar tez-tez oʻzgaradi, ularni davriy qayta yuklaymiz.',
          },
        },
        {
          q: {
            ru: 'На каком языке нужно задавать вопрос?',
            en: 'What language should I ask my question in?',
            de: 'In welcher Sprache soll ich fragen?',
            ar: 'بأي لغة أطرح سؤالي؟',
            kk: 'Сұрақты қай тілде қою керек?',
            uz: 'Savolni qaysi tilda berish kerak?',
          },
          a: {
            ru: 'На любом из шести языков интерфейса. Для узбекского корпуса запрос к базе всё равно строится по-русски — тексты законов там русскоязычные, и поиск по ним точнее.',
            en: 'In any of the six interface languages. For the Uzbek corpus the query to the base is still built in Russian — the statutory texts there are in Russian, and searching them that way is more accurate.',
            de: 'In jeder der sechs Oberflächensprachen. Für den usbekischen Korpus wird die Suchanfrage dennoch auf Russisch gebildet — die Gesetzestexte liegen dort auf Russisch vor, und die Suche wird so genauer.',
            ar: 'بأي من لغات الواجهة الست. أما للمجموعة الأوزبكية فيُبنى الاستعلام بالروسية — نصوص القوانين هناك بالروسية والبحث بها أدق.',
            kk: 'Интерфейстің алты тілінің кез келгенінде. Өзбек корпусы үшін базаға сұраныс бәрібір орысша құрылады — ондағы заң мәтіндері орыс тілінде, іздеу дәлірек болады.',
            uz: 'Interfeysning oltita tilidan istalganida. Oʻzbek korpusi uchun bazaga soʻrov baribir ruschada quriladi — u yerdagi qonun matnlari rus tilida, qidiruv aniqroq boʻladi.',
          },
        },
      ],
    },

    {
      kind: 'related',
      title: {
        ru: 'Дальше по теме',
        en: 'Related',
        de: 'Weiterlesen',
        ar: 'مواضيع ذات صلة',
        kk: 'Тақырып бойынша әрі қарай',
        uz: 'Mavzu boʻyicha davomi',
      },
      items: [
        {
          title: {
            ru: 'Анализ договора',
            en: 'Contract review',
            de: 'Vertragsprüfung',
            ar: 'مراجعة العقد',
            kk: 'Шартты талдау',
            uz: 'Shartnoma tahlili',
          },
          body: {
            ru: 'Как эти нормы попадают в разбор вашего договора и что вы получаете на выходе.',
            en: 'How these provisions reach the review of your contract and what you get out of it.',
            de: 'Wie diese Normen in die Prüfung Ihres Vertrags gelangen und was dabei herauskommt.',
            ar: 'كيف تصل هذه النصوص إلى مراجعة عقدك وماذا تحصل عليه.',
            kk: 'Бұл нормалар шартыңыздың талдауына қалай түседі және нәтижесінде не аласыз.',
            uz: 'Bu normalar shartnomangiz tahliliga qanday tushadi va natijada nima olasiz.',
          },
          to: '/contract-analysis',
        },
        {
          title: {
            ru: 'Вопросы по документу',
            en: 'Document Q&A',
            de: 'Fragen zum Dokument',
            ar: 'أسئلة عن المستند',
            kk: 'Құжат бойынша сұрақтар',
            uz: 'Hujjat boʻyicha savollar',
          },
          body: {
            ru: 'Диалог по загруженному договору со ссылками на нормы вашей юрисдикции.',
            en: 'A dialogue about the uploaded contract, with citations from your jurisdiction.',
            de: 'Ein Dialog zum hochgeladenen Vertrag, mit Fundstellen Ihrer Rechtsordnung.',
            ar: 'حوار حول العقد المرفوع مع إحالات من ولايتك القضائية.',
            kk: 'Жүктелген шарт бойынша диалог, өз юрисдикцияңыздың нормаларына сілтемелермен.',
            uz: 'Yuklangan shartnoma boʻyicha muloqot, oʻz yurisdiksiyangiz normalariga havolalar bilan.',
          },
          to: '/document-chat',
        },
        {
          title: {
            ru: 'Безопасность',
            en: 'Security',
            de: 'Sicherheit',
            ar: 'الأمان',
            kk: 'Қауіпсіздік',
            uz: 'Xavfsizlik',
          },
          body: {
            ru: 'Что зашифровано, что открыто и почему — точный список без обтекаемых слов.',
            en: 'What is encrypted, what is not, and why — an exact list without vague wording.',
            de: 'Was verschlüsselt ist, was offen bleibt und warum — eine genaue Liste ohne Weichzeichner.',
            ar: 'ما المشفَّر وما غير المشفَّر ولماذا — قائمة دقيقة بلا عبارات فضفاضة.',
            kk: 'Не шифрланған, не ашық және неге — жалпылама сөзсіз нақты тізім.',
            uz: 'Nima shifrlangan, nima ochiq va nega — umumiy soʻzlarsiz aniq roʻyxat.',
          },
          to: '/security',
        },
      ],
    },

    {
      kind: 'cta',
      title: {
        ru: 'Проверьте базу на своём договоре',
        en: 'Test the base on your own contract',
        de: 'Prüfen Sie die Basis an Ihrem Vertrag',
        ar: 'اختبر القاعدة على عقدك',
        kk: 'Базаны өз шартыңызда тексеріңіз',
        uz: 'Bazani oʻz shartnomangizda sinab koʻring',
      },
      body: {
        ru: 'Бесплатный тариф даёт 20 обращений к ИИ и 3 документа в месяц — этого хватает, чтобы посмотреть на цитаты и решить самому.',
        en: 'The free plan gives 20 AI requests and 3 documents a month — enough to look at the citations and judge for yourself.',
        de: 'Der kostenlose Tarif umfasst 20 KI-Anfragen und 3 Dokumente pro Monat — genug, um die Fundstellen zu prüfen und selbst zu urteilen.',
        ar: 'الباقة المجانية تمنح 20 طلبًا و3 مستندات شهريًا — يكفي لتفحص الإحالات وتحكم بنفسك.',
        kk: 'Тегін тариф айына 20 ИИ сұрауы мен 3 құжат береді — дәйексөздерді көріп, өзіңіз шешуге жеткілікті.',
        uz: 'Bepul tarif oyiga 20 ta AI soʻrovi va 3 ta hujjat beradi — iqtiboslarni koʻrib, oʻzingiz xulosa qilishga yetadi.',
      },
      cta: [
        {
          label: {
            ru: 'Начать бесплатно',
            en: 'Start free',
            de: 'Kostenlos starten',
            ar: 'ابدأ مجانًا',
            kk: 'Тегін бастау',
            uz: 'Bepul boshlash',
          },
          to: '/login',
          variant: 'primary',
        },
      ],
    },
  ],
};
