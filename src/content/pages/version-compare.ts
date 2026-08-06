/**
 * Публичная страница «Сравнение редакций».
 *
 * Проверено по коду 05.08.2026 (server/src/routes/compare.routes.ts):
 *  - гейт 'compare' → тарифы Pro, Business, Enterprise (FEATURE_MIN_PLAN);
 *  - вход: два файла — fileA (старая редакция) и fileB (новая);
 *  - форматы: DOCX, TXT и PDF с текстовым слоем; скан без текста отклоняется
 *    понятной ошибкой, а не молча;
 *  - расходуется одно обращение к ИИ, и оно ВОЗВРАЩАЕТСЯ, если модель не
 *    ответила (withAiRequest — резерв снимается при сбое).
 * Про «отслеживание изменений в Word» ничего не обещаем: это не оно.
 */
import type { PageContent } from '../types';

export const versionCompare: PageContent = {
  slug: 'version-compare',
  pageTitle: {
    ru: 'Сравнение редакций договора — Lexab',
    en: 'Contract version compare — Lexab',
    de: 'Vertragsversionen vergleichen — Lexab',
    ar: 'مقارنة نسخ العقد — Lexab',
    kk: 'Шарт редакцияларын салыстыру — Lexab',
    uz: 'Shartnoma tahrirlarini solishtirish — Lexab',
  },
  blocks: [
    {
      kind: 'hero',
      title: {
        ru: 'Что контрагент изменил во второй редакции',
        en: 'What the counterparty changed in the new version',
        de: 'Was die Gegenseite in der neuen Fassung geändert hat',
        ar: 'ما الذي غيّره الطرف الآخر في النسخة الجديدة',
        kk: 'Контрагент жаңа редакцияда нені өзгертті',
        uz: 'Kontragent yangi tahrirda nimani oʻzgartirdi',
      },
      lead: {
        ru: 'Загружаете две редакции одного договора — старую и новую. На выходе список изменений по пунктам, и рядом с каждым изменением — что оно означает для вас: усиливает вашу позицию, ослабляет или нейтрально. Это не подсветка слов, а разбор смысла правки.',
        en: 'Upload two versions of the same contract — the old one and the new one. You get a clause-by-clause list of changes, and next to each change what it means for you: strengthens your position, weakens it, or is neutral. This is not word highlighting but an analysis of what the edit does.',
        de: 'Laden Sie zwei Fassungen desselben Vertrags hoch — die alte und die neue. Sie erhalten eine klauselweise Liste der Änderungen, jeweils mit der Bedeutung für Sie: stärkt Ihre Position, schwächt sie oder ist neutral. Das ist keine Worthervorhebung, sondern eine Auswertung der Änderung.',
        ar: 'ارفع نسختين من العقد نفسه — القديمة والجديدة. تحصل على قائمة تغييرات بندًا بندًا، وبجوار كل تغيير معناه لك: يقوّي موقفك أو يضعفه أو محايد. هذه ليست إضاءة كلمات بل تحليل لأثر التعديل.',
        kk: 'Бір шарттың екі редакциясын жүктейсіз — ескісін және жаңасын. Нәтижесінде тармақ бойынша өзгерістер тізімі, әр өзгеріс жанында — оның сіз үшін мәні: ұстанымыңызды күшейте ме, әлсірете ме, әлде бейтарап па. Бұл сөз бояу емес, түзету мәнін талдау.',
        uz: 'Bitta shartnomaning ikki tahririni yuklaysiz — eskisini va yangisini. Natijada band boʻyicha oʻzgarishlar roʻyxati, har bir oʻzgarish yonida — uning siz uchun maʼnosi: pozitsiyangizni kuchaytiradimi, zaiflashtiradimi yoki betaraf. Bu soʻz boʻyash emas, tuzatish maʼnosini tahlil qilish.',
      },
      planNote: {
        ru: 'Доступно на тарифах Pro и Business (и на Enterprise). На Free и Standard раздел закрыт — и это видно сразу, до загрузки файлов.',
        en: 'Available on Pro and Business (and Enterprise). On Free and Standard the section is closed — and you see that upfront, before uploading anything.',
        de: 'Verfügbar in Pro und Business (sowie Enterprise). In Free und Standard ist der Bereich gesperrt — und das sehen Sie sofort, vor jedem Upload.',
        ar: 'متاحة في باقتَي Pro وBusiness (وEnterprise). في Free وStandard القسم مغلق — ويظهر ذلك فورًا قبل رفع أي ملف.',
        kk: 'Pro және Business тарифтерінде (және Enterprise). Free мен Standard-та бөлім жабық — бұл файл жүктемей тұрып бірден көрінеді.',
        uz: 'Pro va Business tariflarida (hamda Enterprise). Free va Standardda boʻlim yopiq — bu fayl yuklashdan oldin darrov koʻrinadi.',
      },
      cta: [
        {
          label: { ru: 'Сравнить две редакции', en: 'Compare two versions', de: 'Zwei Fassungen vergleichen', ar: 'قارن نسختين', kk: 'Екі редакцияны салыстыру', uz: 'Ikki tahrirni solishtirish' },
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
          value: { ru: '2', en: '2', de: '2', ar: '2', kk: '2', uz: '2' },
          label: { ru: 'файла на входе', en: 'files as input', de: 'Dateien als Eingabe', ar: 'ملفان كمدخل', kk: 'кірістегі файл', uz: 'kiritishdagi fayl' },
          proof: {
            ru: 'Старая редакция и новая. DOCX, TXT и PDF с текстовым слоем.',
            en: 'The old version and the new one. DOCX, TXT and PDF with a text layer.',
            de: 'Die alte und die neue Fassung. DOCX, TXT und PDF mit Textebene.',
            ar: 'النسخة القديمة والجديدة. DOCX وTXT وPDF بطبقة نصية.',
            kk: 'Ескі және жаңа редакция. DOCX, TXT және мәтін қабаты бар PDF.',
            uz: 'Eski va yangi tahrir. DOCX, TXT va matn qatlamli PDF.',
          },
        },
        {
          value: { ru: '1', en: '1', de: '1', ar: '1', kk: '1', uz: '1' },
          label: { ru: 'обращение к ИИ на сравнение', en: 'AI request per comparison', de: 'KI-Anfrage je Vergleich', ar: 'طلب ذكاء اصطناعي لكل مقارنة', kk: 'салыстыруға бір ИИ сұрауы', uz: 'solishtirishga bitta AI soʻrovi' },
          proof: {
            ru: 'Если модель не ответила, обращение возвращается в лимит — за неудачу вы не платите.',
            en: 'If the model fails, the request is returned to your allowance — you do not pay for a failure.',
            de: 'Antwortet das Modell nicht, wird die Anfrage dem Kontingent gutgeschrieben — für einen Fehlschlag zahlen Sie nicht.',
            ar: 'إن لم يستجب النموذج يُعاد الطلب إلى حصتك — لا تدفع مقابل الإخفاق.',
            kk: 'Модель жауап бермесе, сұрау лимитке қайтарылады — сәтсіздік үшін төлемейсіз.',
            uz: 'Model javob bermasa, soʻrov limitga qaytariladi — muvaffaqiyatsizlik uchun toʻlamaysiz.',
          },
        },
        {
          value: { ru: '3', en: '3', de: '3', ar: '3', kk: '3', uz: '3' },
          label: { ru: 'оценки у каждого изменения', en: 'verdicts per change', de: 'Bewertungen je Änderung', ar: 'تقييمات لكل تغيير', kk: 'әр өзгеріске үш баға', uz: 'har bir oʻzgarishga uch baho' },
          proof: {
            ru: 'В вашу пользу, против вас или нейтрально — чтобы длинный список читался за минуту, а не за час.',
            en: 'In your favour, against you, or neutral — so a long list reads in a minute instead of an hour.',
            de: 'Zu Ihren Gunsten, zu Ihren Lasten oder neutral — damit eine lange Liste in einer Minute lesbar ist statt in einer Stunde.',
            ar: 'لصالحك أو ضدك أو محايد — لتُقرأ القائمة الطويلة في دقيقة بدل ساعة.',
            kk: 'Пайдаңызға, қарсы немесе бейтарап — ұзын тізім бір сағат емес, бір минутта оқылсын.',
            uz: 'Foydangizga, qarshi yoki betaraf — uzun roʻyxat bir soat emas, bir daqiqada oʻqilsin.',
          },
        },
      ],
    },

    {
      kind: 'steps',
      title: { ru: 'Как это работает', en: 'How it works', de: 'So funktioniert es', ar: 'كيف يعمل', kk: 'Бұл қалай жұмыс істейді', uz: 'Bu qanday ishlaydi' },
      items: [
        {
          title: { ru: 'Прикладываете обе редакции', en: 'You attach both versions', de: 'Sie hängen beide Fassungen an', ar: 'ترفق النسختين', kk: 'Екі редакцияны да тіркейсіз', uz: 'Ikkala tahrirni biriktirasiz' },
          body: {
            ru: 'Первым файлом — то, что было, вторым — то, что прислали. Порядок важен: от него зависит, что считается добавленным, а что убранным.',
            en: 'The first file is what you had, the second is what came back. The order matters: it decides what counts as added and what as removed.',
            de: 'Die erste Datei ist der alte Stand, die zweite der zurückgesandte. Die Reihenfolge zählt: Sie entscheidet, was als hinzugefügt und was als entfernt gilt.',
            ar: 'الملف الأول هو ما كان، والثاني ما وصلك. الترتيب مهم: هو يحدد ما يُعد مضافًا وما يُعد محذوفًا.',
            kk: 'Бірінші файл — болғаны, екіншісі — жіберілгені. Реті маңызды: не қосылды, не алынды — соған байланысты.',
            uz: 'Birinchi fayl — bori, ikkinchisi — kelgani. Tartib muhim: nima qoʻshilgani va nima olib tashlangani shunga bogʻliq.',
          },
        },
        {
          title: { ru: 'Извлекается текст', en: 'The text is extracted', de: 'Der Text wird extrahiert', ar: 'يُستخرج النص', kk: 'Мәтін алынады', uz: 'Matn ajratib olinadi' },
          body: {
            ru: 'Из DOCX, TXT и PDF с текстовым слоем. Скан без текста система не примет и честно скажет об этом, а не выдаст пустое сравнение.',
            en: 'From DOCX, TXT and PDFs with a text layer. A scan without text is rejected with a clear message instead of producing an empty comparison.',
            de: 'Aus DOCX, TXT und PDFs mit Textebene. Ein Scan ohne Text wird mit klarer Meldung abgelehnt, statt einen leeren Vergleich zu liefern.',
            ar: 'من DOCX وTXT وPDF بطبقة نصية. المسح الضوئي بلا نص يُرفض برسالة واضحة بدل مقارنة فارغة.',
            kk: 'DOCX, TXT және мәтін қабаты бар PDF-тен. Мәтінсіз сканды жүйе қабылдамай, бос салыстыру берудің орнына ашық айтады.',
            uz: 'DOCX, TXT va matn qatlamli PDF dan. Matnsiz skanni tizim qabul qilmaydi va boʻsh solishtirish oʻrniga ochiq aytadi.',
          },
        },
        {
          title: { ru: 'Сопоставляются пункты', en: 'Clauses are matched', de: 'Klauseln werden zugeordnet', ar: 'تُطابق البنود', kk: 'Тармақтар салыстырылады', uz: 'Bandlar solishtiriladi' },
          body: {
            ru: 'Сравнение идёт по смыслу пунктов, а не по строкам файла: переставленный или переименованный пункт не выглядит как «удалили и добавили».',
            en: 'Matching goes by the meaning of clauses, not by file lines: a moved or renamed clause does not look like “deleted and added”.',
            de: 'Verglichen wird nach dem Sinn der Klauseln, nicht nach Dateizeilen: Eine verschobene oder umbenannte Klausel erscheint nicht als „gelöscht und hinzugefügt“.',
            ar: 'تجري المطابقة بمعنى البنود لا بأسطر الملف: البند المنقول أو المعاد تسميته لا يبدو «محذوفًا ومضافًا».',
            kk: 'Салыстыру файл жолдары емес, тармақ мәні бойынша: орны ауысқан немесе атауы өзгерген тармақ «жойылды және қосылды» болып көрінбейді.',
            uz: 'Solishtirish fayl satrlari emas, band maʼnosi boʻyicha: oʻrni almashgan yoki nomi oʻzgargan band «oʻchirildi va qoʻshildi» boʻlib koʻrinmaydi.',
          },
        },
        {
          title: { ru: 'Каждая правка получает оценку', en: 'Every edit gets a verdict', de: 'Jede Änderung erhält eine Bewertung', ar: 'كل تعديل يحصل على تقييم', kk: 'Әр түзетуге баға беріледі', uz: 'Har bir tuzatishga baho beriladi' },
          body: {
            ru: 'Не только «что изменилось», но и «чем это грозит»: сдвинутый срок, снятая ответственность, новое основание для расторжения.',
            en: 'Not only “what changed” but “what it exposes you to”: a shifted deadline, a lifted liability, a new ground for termination.',
            de: 'Nicht nur „was sich geändert hat“, sondern „was daraus droht“: verschobene Frist, entfallene Haftung, neuer Kündigungsgrund.',
            ar: 'ليس «ما الذي تغيّر» فحسب بل «ما الذي يعرّضك له»: مهلة أُزيحت، مسؤولية رُفعت، سبب جديد للإنهاء.',
            kk: 'Тек «не өзгерді» емес, «немен қауіпті»: жылжыған мерзім, алынған жауапкершілік, бұзудың жаңа негізі.',
            uz: 'Faqat «nima oʻzgardi» emas, «nima bilan xavfli»: siljigan muddat, olib tashlangan javobgarlik, bekor qilishning yangi asosi.',
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
          title: { ru: 'Это не режим правки Word', en: 'This is not Word’s track changes', de: 'Das ist nicht „Änderungen nachverfolgen“', ar: 'هذه ليست خاصية تتبع التغييرات في Word', kk: 'Бұл Word-тың түзету режимі емес', uz: 'Bu Word tuzatish rejimi emas' },
          body: {
            ru: 'Мы не возвращаем файл с исправлениями внутри. На выходе — разбор изменений на экране.',
            en: 'We do not return a file with tracked edits inside. The output is an on-screen analysis of the changes.',
            de: 'Wir liefern keine Datei mit eingetragenen Änderungen zurück. Ergebnis ist eine Auswertung am Bildschirm.',
            ar: 'لا نعيد ملفًا يحوي التعديلات بداخله. المخرج تحليل للتغييرات على الشاشة.',
            kk: 'Біз түзетулері бар файлды қайтармаймыз. Нәтиже — экрандағы өзгерістер талдауы.',
            uz: 'Biz tuzatishlari bor faylni qaytarmaymiz. Natija — ekrandagi oʻzgarishlar tahlili.',
          },
        },
        {
          title: { ru: 'Скан без текста не сравнить', en: 'A scan without text cannot be compared', de: 'Ein Scan ohne Text lässt sich nicht vergleichen', ar: 'لا يمكن مقارنة مسح بلا نص', kk: 'Мәтінсіз сканды салыстыру мүмкін емес', uz: 'Matnsiz skanni solishtirib boʻlmaydi' },
          body: {
            ru: 'Распознавания изображений в продукте нет. Нужен файл, из которого текст читается.',
            en: 'There is no image recognition in the product. A file whose text is readable is required.',
            de: 'Eine Texterkennung aus Bildern gibt es nicht. Nötig ist eine Datei mit lesbarem Text.',
            ar: 'لا يوجد تعرّف ضوئي على الصور في المنتج. يلزم ملف نصه قابل للقراءة.',
            kk: 'Өнімде кескінді тану жоқ. Мәтіні оқылатын файл қажет.',
            uz: 'Mahsulotda tasvirni tanish yoʻq. Matni oʻqiladigan fayl kerak.',
          },
        },
        {
          title: { ru: 'Оценка не заменяет проверку человеком', en: 'A verdict does not replace human review', de: 'Eine Bewertung ersetzt keine menschliche Prüfung', ar: 'التقييم لا يغني عن مراجعة بشرية', kk: 'Баға адам тексеруін алмастырмайды', uz: 'Baho inson tekshiruvini almashtirmaydi' },
          body: {
            ru: 'Смысл правки бывает виден только из переписки и договорённостей вне текста — их система не знает.',
            en: 'The point of an edit is sometimes visible only from correspondence and understandings outside the text — the system does not know those.',
            de: 'Der Sinn einer Änderung ergibt sich manchmal nur aus Korrespondenz und Absprachen außerhalb des Textes — die kennt das System nicht.',
            ar: 'قد لا يتضح معنى التعديل إلا من المراسلات والتفاهمات خارج النص — والنظام لا يعرفها.',
            kk: 'Түзетудің мәні кейде тек хат алмасу мен мәтіннен тыс келісімдерден көрінеді — жүйе оларды білмейді.',
            uz: 'Tuzatish maʼnosi baʼzan faqat yozishmalar va matndan tashqari kelishuvlardan koʻrinadi — tizim ularni bilmaydi.',
          },
        },
      ],
    },

    {
      kind: 'faq',
      title: { ru: 'Частые вопросы', en: 'Frequently asked questions', de: 'Häufige Fragen', ar: 'أسئلة متكررة', kk: 'Жиі қойылатын сұрақтар', uz: 'Koʻp beriladigan savollar' },
      items: [
        {
          q: { ru: 'Почему сравнение не входит в бесплатный тариф?', en: 'Why is compare not in the free plan?', de: 'Warum ist der Vergleich nicht im kostenlosen Tarif?', ar: 'لماذا المقارنة ليست في الباقة المجانية؟', kk: 'Салыстыру неге тегін тарифке кірмейді?', uz: 'Solishtirish nega bepul tarifga kirmaydi?' },
          a: {
            ru: 'Сравнение читает сразу два полных договора, и это самая дорогая по вычислениям операция в продукте. Она открыта с тарифа Pro.',
            en: 'A comparison reads two full contracts at once and is the most compute-heavy operation in the product. It opens from the Pro plan.',
            de: 'Ein Vergleich liest zwei vollständige Verträge auf einmal und ist die rechenintensivste Operation im Produkt. Er ist ab Pro verfügbar.',
            ar: 'المقارنة تقرأ عقدين كاملين دفعة واحدة وهي أثقل العمليات حسابيًا في المنتج. وهي متاحة ابتداءً من باقة Pro.',
            kk: 'Салыстыру бірден екі толық шартты оқиды — өнімдегі ең қымбат есептеу операциясы. Ол Pro тарифінен ашық.',
            uz: 'Solishtirish birdan ikkita toʻliq shartnomani oʻqiydi — mahsulotdagi eng ogʻir hisoblash amali. U Pro tarifidan ochiq.',
          },
        },
        {
          q: { ru: 'Что если файлы разного формата?', en: 'What if the files are in different formats?', de: 'Was, wenn die Dateien unterschiedliche Formate haben?', ar: 'ماذا لو اختلفت صيغتا الملفين؟', kk: 'Файлдар әртүрлі пішімде болса ше?', uz: 'Fayllar turli formatda boʻlsa-chi?' },
          a: {
            ru: 'Это нормально: можно сравнить DOCX с PDF. Важно только, чтобы из обоих читался текст.',
            en: 'That is fine: you can compare a DOCX with a PDF. All that matters is that text can be read from both.',
            de: 'Das ist in Ordnung: DOCX gegen PDF geht. Wichtig ist nur, dass aus beiden Text lesbar ist.',
            ar: 'لا مشكلة: يمكن مقارنة DOCX بـPDF. المهم أن يكون النص قابلًا للقراءة من كليهما.',
            kk: 'Бұл қалыпты: DOCX пен PDF-ті салыстыруға болады. Тек екеуінен де мәтін оқылса болғаны.',
            uz: 'Bu normal: DOCX bilan PDF ni solishtirish mumkin. Faqat ikkalasidan ham matn oʻqilsa boʻldi.',
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
            ru: 'Разбор одной редакции по пунктам со ссылками на нормы.',
            en: 'A clause-by-clause review of a single version with statutory citations.',
            de: 'Klauselweise Prüfung einer Fassung mit Gesetzesverweisen.',
            ar: 'مراجعة نسخة واحدة بندًا بندًا مع إحالات قانونية.',
            kk: 'Бір редакцияны тармақ бойынша, нормаларға сілтемелермен талдау.',
            uz: 'Bitta tahrirni band boʻyicha, normalarga havolalar bilan tahlil qilish.',
          },
          to: '/contract-analysis',
        },
        {
          title: { ru: 'Вопросы по документу', en: 'Document Q&A', de: 'Fragen zum Dokument', ar: 'أسئلة عن المستند', kk: 'Құжат бойынша сұрақтар', uz: 'Hujjat boʻyicha savollar' },
          body: {
            ru: 'Уточнить смысл конкретной правки в диалоге.',
            en: 'Clarify the meaning of a specific edit in a conversation.',
            de: 'Die Bedeutung einer konkreten Änderung im Dialog klären.',
            ar: 'توضيح معنى تعديل بعينه في محادثة.',
            kk: 'Нақты түзетудің мәнін диалогта нақтылау.',
            uz: 'Aniq tuzatish maʼnosini suhbatda aniqlashtirish.',
          },
          to: '/document-chat',
        },
        {
          title: { ru: 'База законов', en: 'Legal base', de: 'Gesetzesbasis', ar: 'قاعدة القوانين', kk: 'Заң базасы', uz: 'Qonunlar bazasi' },
          body: {
            ru: 'На какие нормы опирается оценка изменений.',
            en: 'Which provisions the assessment of changes relies on.',
            de: 'Auf welche Normen sich die Bewertung stützt.',
            ar: 'على أي نصوص يستند تقييم التغييرات.',
            kk: 'Өзгерістер бағасы қандай нормаларға сүйенеді.',
            uz: 'Oʻzgarishlar bahosi qaysi normalarga tayanadi.',
          },
          to: '/legal-base',
        },
      ],
    },

    {
      kind: 'cta',
      title: { ru: 'Посмотрите, что изменилось на самом деле', en: 'See what actually changed', de: 'Sehen Sie, was sich wirklich geändert hat', ar: 'اطّلع على ما تغيّر فعلًا', kk: 'Шын мәнінде не өзгергенін көріңіз', uz: 'Aslida nima oʻzgarganini koʻring' },
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
