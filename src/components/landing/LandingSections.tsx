import { useEffect, useState, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { Icon, type IconName } from '@/components/icons/Icon';
import { Avatar } from '@/components/ui/Avatar';
import { useI18n } from '@/i18n/I18nProvider';
import { pickText } from '@/i18n/messages';
import { prefersReducedMotion, scrollBehavior } from '@/lib/scroll';
import { LandingDemo, DEMO_NOTE } from './LandingDemo';
import styles from './landing.module.css';

/** Bilingual copy lives next to the markup (same idiom as PlansPage.PLANS). */
type Text2 = { ru: string; en: string; de?: string; ar?: string; kk?: string; uz?: string };

const TELEGRAM_URL = 'https://t.me/MANAGER_CIVIS';

interface SectionHead {
  eyebrow: Text2;
  title: Text2;
  sub: Text2;
}

const HEADS: Record<string, SectionHead> = {
  features: {
    eyebrow: { ru: 'Возможности', en: 'Features', de: 'Funktionen', ar: 'المزايا', kk: 'Мүмкіндіктер', uz: 'Imkoniyatlar' },
    title: { ru: 'Что умеет Lexab', en: 'What Lexab does', de: 'Was Lexab kann', ar: 'ما الذي يقدّمه Lexab', kk: 'Lexab не істей алады', uz: 'Lexab nimalarga qodir' },
    sub: {
      ru: 'Анализ, правки, проверяемые цитаты и экспорт — полный цикл работы с договором.',
      en: 'Analysis, redlines, verifiable citations and export — the full contract workflow.', de: 'Analyse, Redlines, überprüfbare Zitate und Export – der komplette Workflow für Ihre Verträge.', ar: 'تحليل وتعديلات واستشهادات قابلة للتحقق وتصدير — دورة العمل الكاملة على العقد.', kk: 'Талдау, түзетулер, тексерілетін дәйексөздер және экспорт — шартпен жұмыстың толық циклі.', uz: 'Tahlil, tahrirlar, tekshiriladigan iqtiboslar va eksport — shartnoma bilan ishlashning toʻliq sikli.',
    },
  },
  how: {
    eyebrow: { ru: 'Процесс', en: 'Process', de: 'Ablauf', ar: 'آلية العمل', kk: 'Процесс', uz: 'Jarayon' },
    title: { ru: 'Как это работает', en: 'How it works', de: 'So funktioniert es', ar: 'كيف يعمل', kk: 'Бұл қалай жұмыс істейді', uz: 'Bu qanday ishlaydi' },
    sub: {
      ru: 'От загрузки до готового документа — четыре шага.',
      en: 'From upload to final document in four steps.', de: 'Vom Upload zum fertigen Dokument – in vier Schritten.', ar: 'من رفع الملف إلى المستند الجاهز — أربع خطوات.', kk: 'Жүктеуден дайын құжатқа дейін — төрт қадам.', uz: 'Yuklashdan tayyor hujjatgacha — toʻrt qadam.',
    },
  },
  demo: {
    eyebrow: { ru: 'Демо', en: 'Demo', de: 'Demo', ar: 'عرض توضيحي', kk: 'Демо', uz: 'Demo' },
    title: { ru: 'Так выглядит анализ', en: 'What a review looks like', de: 'So sieht eine Analyse aus', ar: 'هكذا يبدو التحليل', kk: 'Талдау осылай көрінеді', uz: 'Tahlil shunday koʻrinadi' },
    sub: {
      ru: 'Пример того, что вы получаете по каждому рискованному пункту.',
      en: 'An example of what you get for every risky clause.', de: 'Ein Beispiel dafür, was Sie zu jeder riskanten Klausel erhalten.', ar: 'مثال على ما تحصل عليه لكل بند ينطوي على مخاطر.', kk: 'Әр тәуекелді тармақ бойынша не алатыныңыздың мысалы.', uz: 'Har bir xavfli band boʻyicha nima olishingizni koʻrsatuvchi namuna.',
    },
  },
  solutions: {
    eyebrow: { ru: 'Для кого', en: 'Who it’s for', de: 'Für wen', ar: 'الفئات المستفيدة', kk: 'Кімге арналған', uz: 'Kimlar uchun' },
    title: { ru: 'Кому полезен Lexab', en: 'Who Lexab helps', de: 'Wem Lexab hilft', ar: 'من يستفيد من Lexab', kk: 'Lexab кімге пайдалы', uz: 'Lexab kimlarga foydali' },
    sub: {
      ru: 'От юрфирм до частных лиц — везде, где договоры отнимают время.',
      en: 'From law firms to individuals — wherever contracts eat time.', de: 'Von Kanzleien bis zu Privatpersonen – überall dort, wo Verträge Zeit kosten.', ar: 'من مكاتب المحاماة إلى الأفراد — أينما كانت العقود تستهلك الوقت.', kk: 'Заң фирмаларынан жеке тұлғаларға дейін — шарттар уақыт алатын барлық жерде.', uz: 'Yuridik firmalardan jismoniy shaxslargacha — shartnomalar vaqtni olayotgan har qanday joyda.',
    },
  },
  security: {
    eyebrow: { ru: 'Безопасность', en: 'Security', de: 'Sicherheit', ar: 'الأمان', kk: 'Қауіпсіздік', uz: 'Xavfsizlik' },
    title: { ru: 'Ваши документы — под вашим контролем', en: 'Your documents, under your control', de: 'Ihre Dokumente – unter Ihrer Kontrolle', ar: 'مستنداتك تحت سيطرتك', kk: 'Құжаттарыңыз — өз бақылауыңызда', uz: 'Hujjatlaringiz — oʻz nazoratingizda' },
    sub: {
      ru: 'Для юридического продукта это не опция. Вот как Lexab обращается с данными — честно и по делу.',
      en: 'For a legal product this isn’t optional. Here is how Lexab handles your data — plainly and honestly.', de: 'Für ein juristisches Produkt ist das nicht optional. So geht Lexab mit Ihren Daten um – ehrlich und auf den Punkt.', ar: 'بالنسبة إلى منتج قانوني، هذا ليس خياراً إضافياً. إليك كيف يتعامل Lexab مع البيانات — بصراحة ووضوح.', kk: 'Заң өнімі үшін бұл — таңдау емес, міндет. Міне, Lexab деректеріңізбен қалай жұмыс істейді — адал әрі нақты.', uz: 'Yuridik mahsulot uchun bu qoʻshimcha imkoniyat emas, zarurat. Mana, Lexab maʼlumotlar bilan qanday ishlaydi — halol va ochiq.',
    },
  },
  plans: {
    eyebrow: { ru: 'Тарифы', en: 'Pricing', de: 'Preise', ar: 'الأسعار', kk: 'Тарифтер', uz: 'Tariflar' },
    title: { ru: 'Планы под ваш объём работы', en: 'Plans for your workload', de: 'Tarife für Ihr Arbeitsvolumen', ar: 'باقات تناسب حجم عملك', kk: 'Жұмыс көлеміңізге сай жоспарлар', uz: 'Ish hajmingizga mos tariflar' },
    sub: {
      ru: 'Начните бесплатно — карта не нужна. При годовой оплате — скидка 15%.',
      en: 'Start free — no card required. Annual billing saves 15%.', de: 'Starten Sie kostenlos – ohne Kreditkarte. Bei jährlicher Zahlung sparen Sie 15 %.', ar: 'ابدأ مجاناً — لا حاجة إلى بطاقة. وعند الدفع السنوي خصم 15%.', kk: 'Тегін бастаңыз — карта қажет емес. Жылдық төлемде — 15% жеңілдік.', uz: 'Bepul boshlang — karta shart emas. Yillik toʻlovda — 15% chegirma.',
    },
  },
  faq: {
    eyebrow: { ru: 'FAQ', en: 'FAQ', de: 'FAQ', ar: 'الأسئلة الشائعة', kk: 'FAQ', uz: 'FAQ' },
    title: { ru: 'Частые вопросы', en: 'Frequently asked questions', de: 'Häufige Fragen', ar: 'الأسئلة المتكررة', kk: 'Жиі қойылатын сұрақтар', uz: 'Koʻp beriladigan savollar' },
    sub: {
      ru: 'Коротко и честно — о безопасности, анализе и старте.',
      en: 'Short, honest answers about security, analysis and getting started.', de: 'Kurz und ehrlich – zu Sicherheit, Analyse und dem Einstieg.', ar: 'إجابات موجزة وصادقة عن الأمان والتحليل وبدء الاستخدام.', kk: 'Қауіпсіздік, талдау және бастау туралы — қысқаша әрі адал.', uz: 'Xavfsizlik, tahlil va ishni boshlash haqida — qisqa va halol javoblar.',
    },
  },
};

const FEATURES: { icon: IconName; title: Text2; text: Text2 }[] = [
  {
    icon: 'alert',
    title: { ru: 'Анализ договоров', en: 'Contract analysis', de: 'Vertragsanalyse', ar: 'تحليل العقود', kk: 'Шарттарды талдау', uz: 'Shartnomalar tahlili' },
    text: {
      ru: 'Загрузите договор — Lexab разберёт его по пунктам и отметит риски: высокий, средний, низкий.',
      en: 'Upload a contract — Lexab reviews it clause by clause and flags risks as high, medium or low.', de: 'Laden Sie einen Vertrag hoch – Lexab prüft ihn Klausel für Klausel und markiert Risiken als hoch, mittel oder niedrig.', ar: 'ارفع العقد — يحلّله Lexab بنداً بنداً ويحدّد المخاطر: عالية أو متوسطة أو منخفضة.', kk: 'Шартты жүктеңіз — Lexab оны тармақтап талдап, тәуекелдерді белгілейді: жоғары, орташа, төмен.', uz: 'Shartnomani yuklang — Lexab uni band-band tahlil qilib, xavflarni belgilaydi: yuqori, oʻrta, past.',
    },
  },
  {
    icon: 'pen',
    title: { ru: 'Редлайнинг', en: 'Redlining', de: 'Redlining', ar: 'التنقيح (Redlining)', kk: 'Редлайнинг', uz: 'Redlayning' },
    text: {
      ru: 'ИИ предлагает конкретные правки: что убрать и чем заменить. Каждую можно принять или отклонить.',
      en: 'The AI drafts concrete edits: what to remove and what to put instead. Accept or reject each one.', de: 'Die KI schlägt konkrete Änderungen vor: was gestrichen und was stattdessen eingesetzt werden sollte. Jede lässt sich annehmen oder ablehnen.', ar: 'يقترح الذكاء الاصطناعي تعديلات محددة: ما الذي يُحذف وما الذي يحلّ محلّه. ويمكنك قبول كل تعديل أو رفضه.', kk: 'ЖИ нақты түзетулер ұсынады: нені алып тастап, немен алмастыру керек. Әр түзетуді қабылдауға немесе қабылдамауға болады.', uz: 'AI aniq tahrirlarni taklif qiladi: nimani olib tashlash va oʻrniga nima qoʻyish kerakligini. Har birini qabul qilish yoki rad etish mumkin.',
    },
  },
  {
    icon: 'shield',
    title: { ru: 'Цитаты на законодательство', en: 'Legal citations', de: 'Gesetzeszitate', ar: 'استشهادات بالتشريعات', kk: 'Заңнамадан дәйексөздер', uz: 'Qonunchilikka havolalar' },
    text: {
      ru: 'Каждый вывод подкреплён ссылкой на конкретную норму. Цитаты автоматически сверяются с официальными текстами законов.',
      en: 'Every finding is backed by a reference to a specific provision, automatically checked against official law texts.', de: 'Jedes Ergebnis ist mit einem Verweis auf eine konkrete Rechtsnorm belegt. Die Zitate werden automatisch mit den offiziellen Gesetzestexten abgeglichen.', ar: 'كل استنتاج مدعوم بإحالة إلى نص قانوني محدد، وتُقارن الاستشهادات تلقائياً بالنصوص الرسمية للقوانين.', kk: 'Әр тұжырым нақты нормаға сілтемемен бекітілген. Дәйексөздер заңдардың ресми мәтіндерімен автоматты түрде салыстырылып тексеріледі.', uz: 'Har bir xulosa aniq normaga havola bilan asoslanadi. Iqtiboslar qonunlarning rasmiy matnlari bilan avtomatik solishtiriladi.',
    },
  },
  {
    icon: 'download',
    title: { ru: 'Экспорт в DOCX и PDF', en: 'DOCX & PDF export', de: 'Export als DOCX und PDF', ar: 'تصدير بصيغتي DOCX وPDF', kk: 'DOCX және PDF форматына экспорт', uz: 'DOCX va PDFga eksport' },
    text: {
      ru: 'Документ с принятыми правками скачивается в DOCX или PDF — форматирование сохраняется, файл открывается в Word.',
      en: 'Download the document with accepted edits as DOCX or PDF — formatting preserved, opens in Word.', de: 'Das Dokument mit den angenommenen Änderungen laden Sie als DOCX oder PDF herunter – die Formatierung bleibt erhalten, die Datei öffnet sich in Word.', ar: 'يمكن تنزيل المستند مع التعديلات المقبولة بصيغة DOCX أو PDF — مع الحفاظ على التنسيق، ويفتح الملف في Word.', kk: 'Қабылданған түзетулері бар құжат DOCX немесе PDF форматында жүктеледі — пішімдеу сақталады, файл Word-та ашылады.', uz: 'Qabul qilingan tahrirlar kiritilgan hujjat DOCX yoki PDF formatida yuklab olinadi — formatlash saqlanadi, fayl Wordda ochiladi.',
    },
  },
];

const STEPS: { title: Text2; text: Text2 }[] = [
  {
    title: { ru: 'Загрузите договор', en: 'Upload your contract', de: 'Laden Sie Ihren Vertrag hoch', ar: 'ارفع عقدك', kk: 'Шартты жүктеңіз', uz: 'Shartnomani yuklang' },
    text: {
      ru: 'Или вставьте текст прямо в чат — Lexab работает с вашими документами.',
      en: 'Or paste the text straight into the chat — Lexab works with your documents.', de: 'Oder fügen Sie den Text direkt in den Chat ein – Lexab arbeitet mit Ihren Dokumenten.', ar: 'أو الصق النص مباشرة في المحادثة — يعمل Lexab مع مستنداتك.', kk: 'Немесе мәтінді тікелей чатқа қойыңыз — Lexab сіздің құжаттарыңызбен жұмыс істейді.', uz: 'Yoki matnni toʻgʻridan-toʻgʻri chatga joylashtiring — Lexab sizning hujjatlaringiz bilan ishlaydi.',
    },
  },
  {
    title: { ru: 'ИИ находит риски', en: 'The AI finds risks', de: 'Die KI findet die Risiken', ar: 'يكتشف الذكاء الاصطناعي المخاطر', kk: 'ЖИ тәуекелдерді табады', uz: 'AI xavflarni topadi' },
    text: {
      ru: 'Разбор по пунктам: что опасно, почему и насколько это серьёзно.',
      en: 'A clause-by-clause breakdown: what is risky, why, and how serious it is.', de: 'Eine Analyse Klausel für Klausel: was riskant ist, warum – und wie schwerwiegend.', ar: 'تحليل بنداً بنداً: ما الخطر، ولماذا، وما مدى جسامته.', kk: 'Тармақ бойынша талдау: не қауіпті, неліктен және бұл қаншалықты елеулі.', uz: 'Band-band tahlil: nima xavfli, nega va bu qanchalik jiddiy.',
    },
  },
  {
    title: { ru: 'Проверяете цитаты', en: 'Verify the citations', de: 'Sie prüfen die Zitate', ar: 'تحقّق من الاستشهادات', kk: 'Дәйексөздерді тексересіз', uz: 'Iqtiboslarni tekshirasiz' },
    text: {
      ru: 'Каждый вывод — со ссылкой на норму закона, которую можно открыть и проверить.',
      en: 'Every finding cites a legal provision you can open and check yourself.', de: 'Jedes Ergebnis verweist auf eine konkrete Rechtsnorm, die Sie öffnen und selbst überprüfen können.', ar: 'كل استنتاج مصحوب بإحالة إلى نص قانوني يمكنك فتحه والتحقق منه بنفسك.', kk: 'Әр тұжырым — ашып тексеруге болатын заң нормасына сілтемемен беріледі.', uz: 'Har bir xulosa — ochib, oʻzingiz tekshirishingiz mumkin boʻlgan qonun normasiga havola bilan.',
    },
  },
  {
    title: { ru: 'Принимаете правки', en: 'Accept the redlines', de: 'Sie übernehmen die Änderungen', ar: 'اعتمد التعديلات', kk: 'Түзетулерді қабылдайсыз', uz: 'Tahrirlarni qabul qilasiz' },
    text: {
      ru: 'Примите или отклоните предложенные правки и экспортируйте готовый документ.',
      en: 'Accept or reject the suggested edits and export the final document.', de: 'Nehmen Sie die vorgeschlagenen Änderungen an oder lehnen Sie sie ab – und exportieren Sie das fertige Dokument.', ar: 'اقبل التعديلات المقترحة أو ارفضها، ثم صدّر المستند النهائي.', kk: 'Ұсынылған түзетулерді қабылдап немесе қабылдамай, дайын құжатты экспорттаңыз.', uz: 'Taklif qilingan tahrirlarni qabul qiling yoki rad eting va tayyor hujjatni eksport qiling.',
    },
  },
];

/** Audience cards (photo-10 layout): an optional headline metric top-right,
 *  plus a "learn more" link. Metrics are product-positioning figures — the
 *  Individuals card intentionally carries none (no number to stand behind). */
const AUDIENCES: { icon: IconName; metric?: Text2; title: Text2; text: Text2 }[] = [
  {
    icon: 'users',
    metric: { ru: '10×', en: '10×', de: '10×', ar: '10×', kk: '10×', uz: '10×' },
    title: { ru: 'In-house юристы', en: 'In-house counsel', de: 'Unternehmensjuristen', ar: 'المستشارون القانونيون الداخليون', kk: 'In-house заңгерлер', uz: 'In-house yuristlar' },
    text: {
      ru: 'Ускорьте обзор входящих контрактов в 10 раз. Освободите время на стратегию.',
      en: 'Review incoming contracts 10× faster. Free up time for strategy.', de: 'Prüfen Sie eingehende Verträge zehnmal schneller. Gewinnen Sie Zeit für strategische Aufgaben.', ar: 'سرّع مراجعة العقود الواردة عشرة أضعاف، وحرّر وقتك للاستراتيجية.', kk: 'Келіп түсетін шарттарды қарауды 10 есе жеделдетіңіз. Стратегияға уақыт босатыңыз.', uz: 'Kiruvchi shartnomalarni koʻrib chiqishni 10 barobar tezlashtiring. Vaqtingizni strategiyaga boʻshating.',
    },
  },
  {
    icon: 'layout',
    metric: { ru: '3,5×', en: '3.5×', de: '3,5×', ar: '3.5×', kk: '3,5×', uz: '3,5×' },
    title: { ru: 'Юридические фирмы', en: 'Law firms', de: 'Kanzleien', ar: 'مكاتب المحاماة', kk: 'Заң фирмалары', uz: 'Yuridik firmalar' },
    text: {
      ru: 'Стандартизируйте качество due diligence в команде любого размера.',
      en: 'Standardise due-diligence quality across a team of any size.', de: 'Standardisieren Sie die Qualität der Due Diligence – in Teams jeder Größe.', ar: 'وحّد جودة الفحص النافي للجهالة (Due Diligence) في فريق من أي حجم.', kk: 'Кез келген көлемдегі командада due diligence сапасын бірыңғай стандартқа келтіріңіз.', uz: 'Har qanday hajmdagi jamoada due diligence sifatini standartlashtiring.',
    },
  },
  {
    icon: 'shield',
    metric: { ru: '99,9%', en: '99.9%', de: '99,9 %', ar: '99.9%', kk: '99,9%', uz: '99,9%' },
    title: { ru: 'Compliance & Risk', en: 'Compliance & Risk', de: 'Compliance & Risk', ar: 'الامتثال والمخاطر', kk: 'Compliance & Risk', uz: 'Compliance & Risk' },
    text: {
      ru: 'Автоматический мониторинг соответствия локальному законодательству.',
      en: 'Automatic monitoring of compliance with local legislation.', de: 'Automatische Überwachung der Einhaltung lokaler Rechtsvorschriften.', ar: 'مراقبة تلقائية للامتثال للتشريعات المحلية.', kk: 'Жергілікті заңнамаға сәйкестіктің автоматты мониторингі.', uz: 'Mahalliy qonunchilikka muvofiqlikning avtomatik monitoringi.',
    },
  },
  {
    icon: 'chat',
    title: { ru: 'Частные лица', en: 'Individuals', de: 'Privatpersonen', ar: 'الأفراد', kk: 'Жеке тұлғалар', uz: 'Jismoniy shaxslar' },
    text: {
      ru: 'Аренда, оферта, трудовой договор — понятный разбор без юридического жаргона.',
      en: 'A lease, an offer, an employment contract — a clear breakdown without legal jargon.', de: 'Mietvertrag, Angebot, Arbeitsvertrag – eine verständliche Analyse ohne Juristendeutsch.', ar: 'عقد إيجار أو عرض تعاقدي أو عقد عمل — تحليل واضح من دون مصطلحات قانونية معقدة.', kk: 'Жалдау шарты, оферта, еңбек шарты — заң жаргонынсыз түсінікті талдау.', uz: 'Ijara, oferta, mehnat shartnomasi — yuridik jargonsiz tushunarli tahlil.',
    },
  },
];

/** Every claim below is implemented in the product — no marketing invention. */
const SECURITY: { icon: IconName; title: Text2; text: Text2 }[] = [
  {
    icon: 'shield',
    title: { ru: 'Приватное хранилище', en: 'Private storage', de: 'Privater Speicher', ar: 'تخزين خاص', kk: 'Жеке қойма', uz: 'Yopiq (privat) xotira' },
    text: {
      ru: 'Файлы хранятся в приватном облачном хранилище; доступ — только по временным подписанным ссылкам.',
      en: 'Files live in a private cloud bucket; access is via expiring signed links only.', de: 'Ihre Dateien liegen in einem privaten Cloud-Speicher; der Zugriff erfolgt ausschließlich über zeitlich begrenzte signierte Links.', ar: 'تُحفظ الملفات في مساحة تخزين سحابية خاصة، ولا يتم الوصول إليها إلا عبر روابط موقّعة مؤقتة.', kk: 'Файлдар жеке бұлттық қоймада сақталады; қол жеткізу — тек мерзімі шектеулі қол қойылған сілтемелер арқылы.', uz: 'Fayllar yopiq bulut xotirasida saqlanadi; kirish — faqat muddati cheklangan imzolangan havolalar orqali.',
    },
  },
  {
    icon: 'eyeOff',
    title: { ru: 'Без обучения на ваших данных', en: 'No training on your data', de: 'Kein Training mit Ihren Daten', ar: 'لا تدريب على بياناتك', kk: 'Деректеріңізде модельдер оқытылмайды', uz: 'Maʼlumotlaringizda model oʻqitilmaydi' },
    text: {
      ru: 'Документы не используются для обучения моделей и не передаются третьим лицам. Условия наших ИИ-провайдеров исключают обучение моделей на переданных данных.',
      en: 'Your documents are not used to train models and are not shared with third parties. Our AI providers’ terms preclude training models on submitted data.', de: 'Ihre Dokumente werden weder zum Trainieren von Modellen verwendet noch an Dritte weitergegeben. Die Bedingungen unserer KI-Anbieter schließen ein Training der Modelle mit übermittelten Daten aus.', ar: 'لا تُستخدم مستنداتك لتدريب النماذج ولا تُشارك مع أطراف ثالثة، كما تستبعد شروط مزوّدي الذكاء الاصطناعي لدينا تدريب النماذج على البيانات المرسلة.', kk: 'Құжаттар модельдерді оқытуға пайдаланылмайды және үшінші тұлғаларға берілмейді. ЖИ-провайдерлеріміздің шарттары жіберілген деректерде модельдерді оқытуды болдырмайды.', uz: 'Hujjatlar modellarni oʻqitish uchun ishlatilmaydi va uchinchi shaxslarga berilmaydi. AI provayderlarimizning shartlari yuborilgan maʼlumotlarda model oʻqitishni istisno qiladi.',
    },
  },
  {
    icon: 'users',
    title: { ru: 'Доступ контролируете вы', en: 'You control access', de: 'Den Zugriff kontrollieren Sie', ar: 'أنت من يتحكم في الوصول', kk: 'Қол жеткізуді өзіңіз бақылайсыз', uz: 'Kirishni siz nazorat qilasiz' },
    text: {
      ru: 'По умолчанию документ видите только вы. На тарифе Business его можно открыть команде — с ролями: администратор, редактор, просмотр.',
      en: 'By default only you can see a document. On the Business plan you can share it with your team — with admin, editor or viewer roles.', de: 'Standardmäßig sehen nur Sie ein Dokument. Im Business-Tarif können Sie es für Ihr Team freigeben – mit Rollen: Administrator, Bearbeiter, Betrachter.', ar: 'افتراضياً، أنت وحدك من يرى المستند. وعلى باقة Business يمكنك مشاركته مع فريقك — بأدوار: مسؤول ومحرر وعارض.', kk: 'Әдепкіде құжатты тек өзіңіз көресіз. Business тарифінде оны командаға ашуға болады — рөлдермен: әкімші, редактор, қарау.', uz: 'Sukut boʻyicha hujjatni faqat siz koʻrasiz. Business tarifida uni jamoaga ochish mumkin — rollar bilan: administrator, muharrir, koʻruvchi.',
    },
  },
  {
    icon: 'check',
    title: { ru: 'Проверяемые цитаты', en: 'Verifiable citations', de: 'Überprüfbare Zitate', ar: 'استشهادات قابلة للتحقق', kk: 'Тексерілетін дәйексөздер', uz: 'Tekshiriladigan iqtiboslar' },
    text: {
      ru: 'Ссылки на законы проверяются кодом по официальным государственным источникам законодательства. Неподтверждённое помечается.',
      en: 'Legal citations are validated in code against official government sources. Anything unconfirmed is flagged.', de: 'Gesetzesverweise werden programmatisch anhand offizieller staatlicher Rechtsquellen validiert. Unbestätigtes wird gekennzeichnet.', ar: 'يجري التحقق برمجياً من الإحالات إلى القوانين بمقارنتها بالمصادر الحكومية الرسمية للتشريعات، ويوسَم كل ما لم يتأكد.', kk: 'Заңдарға сілтемелер заңнаманың ресми мемлекеттік дереккөздері бойынша кодпен тексеріледі. Расталмағаны белгіленеді.', uz: 'Qonunlarga havolalar kod darajasida rasmiy davlat qonunchilik manbalari boʻyicha tekshiriladi. Tasdiqlanmaganlari belgilab qoʻyiladi.',
    },
  },
  {
    icon: 'trash',
    title: { ru: 'Удаление в один клик', en: 'One-click deletion', de: 'Löschen mit einem Klick', ar: 'حذف بنقرة واحدة', kk: 'Бір басумен жою', uz: 'Bir bosishda oʻchirish' },
    text: {
      ru: 'Удалите документ — он исчезнет из аккаунта и базы данных. Можно удалить и аккаунт целиком вместе со всеми данными.',
      en: 'Delete a document and it disappears from your account and the database. You can also delete your entire account with all its data.', de: 'Löschen Sie ein Dokument – es verschwindet aus Ihrem Konto und aus der Datenbank. Sie können auch Ihr gesamtes Konto mit allen Daten löschen.', ar: 'احذف المستند فيختفي من حسابك ومن قاعدة البيانات، ويمكنك أيضاً حذف حسابك بالكامل مع جميع بياناته.', kk: 'Құжатты жойыңыз — ол аккаунттан да, дерекқордан да жоғалады. Аккаунтты барлық деректерімен қоса толығымен жоюға да болады.', uz: 'Hujjatni oʻchiring — u akkauntdan ham, maʼlumotlar bazasidan ham yoʻqoladi. Akkauntni barcha maʼlumotlari bilan butunlay oʻchirish ham mumkin.',
    },
  },
  {
    icon: 'globe',
    title: { ru: 'SSO', en: 'SSO', de: 'SSO', ar: 'SSO', kk: 'SSO', uz: 'SSO' },
    text: {
      ru: 'Единый корпоративный вход через вашего провайдера (SAML/OIDC) — на тарифе Business.',
      en: 'Single sign-on through your corporate identity provider (SAML/OIDC) on the Business plan.', de: 'Single Sign-on über Ihren Unternehmens-Identity-Provider (SAML/OIDC) – im Business-Tarif.', ar: 'تسجيل دخول مؤسسي موحّد عبر مزوّد الهوية لديكم (SAML/OIDC) — على باقة Business.', kk: 'Өз провайдеріңіз арқылы бірыңғай корпоративтік кіру (SAML/OIDC) — Business тарифінде.', uz: 'Oʻz provayderingiz orqali yagona korporativ kirish (SAML/OIDC) — Business tarifida.',
    },
  },
  {
    icon: 'users',
    title: { ru: 'RBAC', en: 'RBAC', de: 'RBAC', ar: 'RBAC', kk: 'RBAC', uz: 'RBAC' },
    text: {
      ru: 'Роли доступа: администратор, редактор, просмотр — каждый видит только то, что ему разрешено.',
      en: 'Role-based access: admin, editor, viewer — each teammate sees only what they’re allowed to.', de: 'Zugriffsrollen: Administrator, Bearbeiter, Betrachter – jeder sieht nur das, was für ihn freigegeben ist.', ar: 'أدوار وصول: مسؤول ومحرر وعارض — لا يرى كل عضو إلا ما هو مصرّح له به.', kk: 'Қол жеткізу рөлдері: әкімші, редактор, қарау — әркім тек өзіне рұқсат етілгенді көреді.', uz: 'Kirish rollari: administrator, muharrir, koʻruvchi — har kim faqat oʻziga ruxsat etilganini koʻradi.',
    },
  },
  {
    icon: 'shield',
    title: { ru: 'MFA', en: 'MFA', de: 'MFA', ar: 'MFA', kk: 'MFA', uz: 'MFA' },
    text: {
      ru: 'Двухфакторная защита входа через ваш аккаунт Google или корпоративный SSO-провайдер.',
      en: 'Two-factor protection at sign-in via your Google account or corporate SSO provider.', de: 'Zwei-Faktor-Schutz bei der Anmeldung über Ihr Google-Konto oder Ihren Unternehmens-SSO-Provider.', ar: 'حماية ثنائية العوامل لتسجيل الدخول عبر حسابك في Google أو مزوّد SSO المؤسسي لديكم.', kk: 'Google аккаунтыңыз немесе корпоративтік SSO-провайдер арқылы кіруді екі факторлы қорғау.', uz: 'Google akkauntingiz yoki korporativ SSO-provayderingiz orqali kirishni ikki bosqichli himoyalash.',
    },
  },
  {
    icon: 'history',
    title: { ru: 'Audit Logs', en: 'Audit Logs', de: 'Audit Logs', ar: 'سجلات التدقيق (Audit Logs)', kk: 'Audit Logs', uz: 'Audit Logs' },
    text: {
      ru: 'Журнал действий: кто открыл, изменил, скачал или удалил документ — с поиском и фильтром.',
      en: 'Audit trail: who opened, edited, downloaded or deleted a document — with search and filters.', de: 'Aktivitätsprotokoll: wer ein Dokument geöffnet, geändert, heruntergeladen oder gelöscht hat – mit Suche und Filtern.', ar: 'سجل للإجراءات: من فتح المستند أو عدّله أو نزّله أو حذفه — مع بحث وتصفية.', kk: 'Әрекеттер журналы: құжатты кім ашты, өзгертті, жүктеп алды немесе жойды — іздеуі мен сүзгісі бар.', uz: 'Harakatlar jurnali: hujjatni kim ochgani, oʻzgartirgani, yuklab olgani yoki oʻchirgani — qidiruv va filtr bilan.',
    },
  },
  {
    icon: 'cloud',
    title: { ru: 'Secure Cloud Infrastructure', en: 'Secure Cloud Infrastructure', de: 'Secure Cloud Infrastructure', ar: 'بنية تحتية سحابية آمنة', kk: 'Secure Cloud Infrastructure', uz: 'Secure Cloud Infrastructure' },
    text: {
      ru: 'Данные — в защищённой облачной инфраструктуре; доступ к файлам только по временным подписанным ссылкам.',
      en: 'Data lives in secure cloud infrastructure; files are reachable only via expiring signed links.', de: 'Ihre Daten liegen in einer geschützten Cloud-Infrastruktur; der Zugriff auf Dateien erfolgt nur über zeitlich begrenzte signierte Links.', ar: 'تُحفظ البيانات في بنية تحتية سحابية آمنة، ولا يمكن الوصول إلى الملفات إلا عبر روابط موقّعة مؤقتة.', kk: 'Деректер — қорғалған бұлттық инфрақұрылымда; файлдарға қол жеткізу тек мерзімі шектеулі қол қойылған сілтемелер арқылы.', uz: 'Maʼlumotlar himoyalangan bulut infratuzilmasida saqlanadi; fayllarga kirish faqat muddati cheklangan imzolangan havolalar orqali.',
    },
  },
  {
    icon: 'layout',
    title: { ru: 'Workspace Permissions', en: 'Workspace Permissions', de: 'Workspace Permissions', ar: 'صلاحيات مساحات العمل', kk: 'Workspace Permissions', uz: 'Workspace Permissions' },
    text: {
      ru: 'Документ виден только вам, пока вы сами не откроете доступ команде и не назначите роли.',
      en: 'A document is private to you until you share it with your team and assign roles.', de: 'Ein Dokument sehen nur Sie – bis Sie es selbst für Ihr Team freigeben und Rollen zuweisen.', ar: 'يبقى المستند مرئياً لك وحدك حتى تشاركه بنفسك مع فريقك وتعيّن الأدوار.', kk: 'Өзіңіз командаға қол жеткізуді ашып, рөлдерді тағайындағанша, құжат тек сізге көрінеді.', uz: 'Toki oʻzingiz jamoaga ruxsat berib, rollarni tayinlamaguningizcha, hujjat faqat sizga koʻrinadi.',
    },
  },
];

interface LandingPlan {
  name: string;
  dot: string;
  /** Monthly price in USD; yearly billing shows it with the 15% discount. */
  monthly: number;
  popular?: boolean;
  tagline: Text2;
  /** "Everything in X, plus:" line shown above the feature list. */
  inherits?: Text2;
  features: Text2[];
}

/** Mirrors the in-app Plans page (PlansPage.tsx) — same taglines, features and
 *  gates — so the descriptions stay identical on the landing and inside the app. */
const YEARLY_DISCOUNT = 0.15;

const PLANS: LandingPlan[] = [
  {
    name: 'Free',
    dot: '#5F5F6A',
    monthly: 0,
    tagline: { ru: 'Узнайте, что Lexab может сделать для вас', en: 'See what Lexab can do for you', de: 'Erfahren Sie, was Lexab für Sie tun kann', ar: 'اكتشف ما يمكن أن يقدّمه لك Lexab', kk: 'Lexab сіз үшін не істей алатынын біліңіз', uz: 'Lexab siz uchun nimalar qila olishini bilib oling' },
    features: [
      { ru: '10 AI-запросов в месяц', en: '10 AI requests per month', de: '10 KI-Anfragen pro Monat', ar: '10 طلبات ذكاء اصطناعي شهرياً', kk: 'Айына 10 AI-сұрау', uz: 'Oyiga 10 ta AI soʻrov' },
      { ru: 'До 3 документов', en: 'Up to 3 documents', de: 'Bis zu 3 Dokumente', ar: 'حتى 3 مستندات', kk: '3 құжатқа дейін', uz: '3 tagacha hujjat' },
      { ru: 'AI Chat с документами', en: 'AI Chat with documents', de: 'AI Chat mit Dokumenten', ar: 'محادثة AI Chat مع المستندات', kk: 'Құжаттармен AI Chat', uz: 'Hujjatlar bilan AI Chat' },
      { ru: 'AI Summary', en: 'AI Summary', de: 'AI Summary', ar: 'ملخص AI Summary', kk: 'AI Summary', uz: 'AI Summary' },
      { ru: 'Экспорт в PDF', en: 'PDF export', de: 'PDF-Export', ar: 'تصدير إلى PDF', kk: 'PDF форматына экспорт', uz: 'PDFga eksport' },
    ],
  },
  {
    name: 'Standard',
    dot: '#3FB8AF',
    monthly: 15,
    tagline: { ru: 'Для студентов, фрилансеров и стартапов', en: 'For students, freelancers and startups', de: 'Für Studierende, Freelancer und Start-ups', ar: 'للطلاب والمستقلين والشركات الناشئة', kk: 'Студенттерге, фрилансерлерге және стартаптарға арналған', uz: 'Talabalar, frilanserlar va startaplar uchun' },
    features: [
      { ru: 'До 100 AI-запросов в месяц', en: 'Up to 100 AI requests per month', de: 'Bis zu 100 KI-Anfragen pro Monat', ar: 'حتى 100 طلب ذكاء اصطناعي شهرياً', kk: 'Айына 100 AI-сұрауға дейін', uz: 'Oyiga 100 tagacha AI soʻrov' },
      { ru: 'До 20 документов в месяц', en: 'Up to 20 documents per month', de: 'Bis zu 20 Dokumente pro Monat', ar: 'حتى 20 مستنداً شهرياً', kk: 'Айына 20 құжатқа дейін', uz: 'Oyiga 20 tagacha hujjat' },
      { ru: 'AI Chat с документами', en: 'AI Chat with documents', de: 'AI Chat mit Dokumenten', ar: 'محادثة AI Chat مع المستندات', kk: 'Құжаттармен AI Chat', uz: 'Hujjatlar bilan AI Chat' },
      { ru: 'AI Contract Generator', en: 'AI Contract Generator', de: 'AI Contract Generator', ar: 'مولّد العقود AI Contract Generator', kk: 'AI Contract Generator', uz: 'AI Contract Generator' },
      { ru: 'AI Risk Analysis', en: 'AI Risk Analysis', de: 'AI Risk Analysis', ar: 'تحليل المخاطر AI Risk Analysis', kk: 'AI Risk Analysis', uz: 'AI Risk Analysis' },
      { ru: 'AI Summary', en: 'AI Summary', de: 'AI Summary', ar: 'ملخص AI Summary', kk: 'AI Summary', uz: 'AI Summary' },
      { ru: 'Экспорт в PDF и DOCX', en: 'PDF & DOCX export', de: 'Export als PDF und DOCX', ar: 'تصدير إلى PDF وDOCX', kk: 'PDF және DOCX форматына экспорт', uz: 'PDF va DOCXga eksport' },
      { ru: '2 GB защищённого хранилища', en: '2 GB secure storage', de: '2 GB geschützter Speicherplatz', ar: '‏2 GB من التخزين الآمن', kk: '2 GB қорғалған қойма', uz: '2 GB himoyalangan xotira' },
      { ru: 'Email-поддержка', en: 'Email support', de: 'E-Mail-Support', ar: 'دعم عبر البريد الإلكتروني', kk: 'Email арқылы қолдау', uz: 'Email orqali qoʻllab-quvvatlash' },
    ],
  },
  {
    name: 'Pro',
    dot: '#5B8DEF',
    monthly: 50,
    popular: true,
    tagline: { ru: 'Для юристов и малого бизнеса', en: 'For lawyers and small businesses', de: 'Für Juristen und kleine Unternehmen', ar: 'للمحامين والأعمال الصغيرة', kk: 'Заңгерлер мен шағын бизнеске арналған', uz: 'Yuristlar va kichik biznes uchun' },
    inherits: { ru: 'Всё из Standard, плюс:', en: 'Everything in Standard, plus:', de: 'Alles aus Standard, plus:', ar: 'كل ما في Standard، بالإضافة إلى:', kk: 'Standard тарифіндегінің бәрі, оған қоса:', uz: 'Standard tarifidagi hammasi, qoʻshimcha:' },
    features: [
      { ru: 'Безлимитные AI-чаты', en: 'Unlimited AI chats', de: 'Unbegrenzte AI-Chats', ar: 'محادثات ذكاء اصطناعي غير محدودة', kk: 'Шексіз AI-чаттар', uz: 'Cheklanmagan AI chatlar' },
      { ru: 'До 80 документов в месяц', en: 'Up to 80 documents per month', de: 'Bis zu 80 Dokumente pro Monat', ar: 'حتى 80 مستنداً شهرياً', kk: 'Айына 80 құжатқа дейін', uz: 'Oyiga 80 tagacha hujjat' },
      { ru: 'Redline (сравнение версий)', en: 'Redline (version compare)', de: 'Redline (Versionsvergleich)', ar: 'Redline (مقارنة الإصدارات)', kk: 'Redline (нұсқаларды салыстыру)', uz: 'Redline (versiyalarni solishtirish)' },
      { ru: 'AI Contract Review', en: 'AI Contract Review', de: 'AI Contract Review', ar: 'مراجعة العقود AI Contract Review', kk: 'AI Contract Review', uz: 'AI Contract Review' },
      { ru: 'AI Clause Suggestions', en: 'AI Clause Suggestions', de: 'AI Clause Suggestions', ar: 'اقتراحات البنود AI Clause Suggestions', kk: 'AI Clause Suggestions', uz: 'AI Clause Suggestions' },
      { ru: 'Version History', en: 'Version History', de: 'Version History', ar: 'سجل الإصدارات (Version History)', kk: 'Version History', uz: 'Version History' },
      { ru: 'Электронная подпись', en: 'E-signature', de: 'Elektronische Signatur', ar: 'التوقيع الإلكتروني', kk: 'Электрондық қолтаңба', uz: 'Elektron imzo' },
      { ru: 'Маршруты согласования (цепочки утверждения с дедлайнами)', en: 'Approval workflows (multi-step sign-off with deadlines)', de: 'Freigabe-Workflows (mehrstufige Genehmigungsketten mit Fristen)', ar: 'مسارات الموافقة (سلاسل اعتماد متعددة الخطوات بمواعيد نهائية)', kk: 'Келісу маршруттары (дедлайндары бар бекіту тізбектері)', uz: 'Kelishuv marshrutlari (muddatlar bilan tasdiqlash zanjirlari)' },
      { ru: '50 GB защищённого хранилища', en: '50 GB secure storage', de: '50 GB geschützter Speicherplatz', ar: '‏50 GB من التخزين الآمن', kk: '50 GB қорғалған қойма', uz: '50 GB himoyalangan xotira' },
      { ru: 'Приоритетная поддержка', en: 'Priority support', de: 'Priorisierter Support', ar: 'دعم ذو أولوية', kk: 'Приоритетті қолдау', uz: 'Ustuvor qoʻllab-quvvatlash' },
      { ru: 'Ранний доступ к новым функциям', en: 'Early access to new features', de: 'Früher Zugriff auf neue Funktionen', ar: 'وصول مبكر إلى الميزات الجديدة', kk: 'Жаңа функцияларға ерте қол жеткізу', uz: 'Yangi funksiyalarga erta kirish' },
    ],
  },
  {
    name: 'Business',
    dot: '#8B7CF6',
    monthly: 499,
    tagline: { ru: 'Для юридических фирм и компаний', en: 'For law firms and companies', de: 'Für Kanzleien und Unternehmen', ar: 'لمكاتب المحاماة والشركات', kk: 'Заң фирмалары мен компанияларға арналған', uz: 'Yuridik firmalar va kompaniyalar uchun' },
    inherits: { ru: 'Всё из Pro, плюс:', en: 'Everything in Pro, plus:', de: 'Alles aus Pro, plus:', ar: 'كل ما في Pro، بالإضافة إلى:', kk: 'Pro тарифіндегінің бәрі, оған қоса:', uz: 'Pro tarifidagi hammasi, qoʻshimcha:' },
    features: [
      { ru: 'Доступ к самым мощным AI-моделям', en: 'Access to the most capable AI models', de: 'Zugriff auf die leistungsstärksten KI-Modelle', ar: 'الوصول إلى أقوى نماذج الذكاء الاصطناعي', kk: 'Ең қуатты AI-модельдерге қол жеткізу', uz: 'Eng kuchli AI modellaridan foydalanish' },
      { ru: 'До 5 пользователей', en: 'Up to 5 users', de: 'Bis zu 5 Nutzer', ar: 'حتى 5 مستخدمين', kk: '5 пайдаланушыға дейін', uz: '5 tagacha foydalanuvchi' },
      { ru: 'До 700 документов в месяц', en: 'Up to 700 documents per month', de: 'Bis zu 700 Dokumente pro Monat', ar: 'حتى 700 مستند شهرياً', kk: 'Айына 700 құжатқа дейін', uz: 'Oyiga 700 tagacha hujjat' },
      { ru: 'Общие Workspaces', en: 'Shared workspaces', de: 'Gemeinsame Workspaces', ar: 'مساحات عمل مشتركة (Workspaces)', kk: 'Ортақ Workspaces', uz: 'Umumiy Workspaces' },
      { ru: 'Управление ролями и правами доступа', en: 'Roles & access management', de: 'Rollen- und Rechteverwaltung', ar: 'إدارة الأدوار وصلاحيات الوصول', kk: 'Рөлдер мен қол жеткізу құқықтарын басқару', uz: 'Rollar va kirish huquqlarini boshqarish' },
      { ru: 'Совместная работа над документами', en: 'Document collaboration', de: 'Gemeinsames Arbeiten an Dokumenten', ar: 'العمل التعاوني على المستندات', kk: 'Құжаттармен бірлескен жұмыс', uz: 'Hujjatlar ustida hamkorlikda ishlash' },
      { ru: 'Audit Log', en: 'Audit log', de: 'Audit Log', ar: 'سجل التدقيق (Audit Log)', kk: 'Audit Log', uz: 'Audit Log' },
      { ru: 'Расширенная аналитика', en: 'Advanced analytics', de: 'Erweiterte Analysen', ar: 'تحليلات متقدمة', kk: 'Кеңейтілген аналитика', uz: 'Kengaytirilgan analitika' },
      { ru: 'SSO (Single Sign-On)', en: 'SSO (Single Sign-On)', de: 'SSO (Single Sign-On)', ar: 'SSO (تسجيل الدخول الموحّد)', kk: 'SSO (Single Sign-On)', uz: 'SSO (Single Sign-On)' },
      { ru: '1 TB защищённого хранилища', en: '1 TB secure storage', de: '1 TB geschützter Speicherplatz', ar: '‏1 TB من التخزين الآمن', kk: '1 TB қорғалған қойма', uz: '1 TB himoyalangan xotira' },
      { ru: 'Выделенный Customer Success Manager', en: 'Dedicated Customer Success Manager', de: 'Dedizierter Customer Success Manager', ar: 'مدير مخصص لنجاح العملاء (Customer Success Manager)', kk: 'Арнайы бекітілген Customer Success Manager', uz: 'Shaxsiy Customer Success Manager' },
    ],
  },
];

/** Enterprise — custom pricing, shown as a full-width card below the grid
 *  (mirrors the in-app Enterprise card). */
const ENTERPRISE: { dot: string; priceLabel: Text2; tagline: Text2; features: Text2[] } = {
  dot: '#9A9AA6',
  priceLabel: { ru: 'По договорённости', en: 'Custom pricing', de: 'Auf Anfrage', ar: 'حسب الاتفاق', kk: 'Келісім бойынша', uz: 'Kelishuv asosida' },
  tagline: { ru: 'Индивидуальные условия и внедрение — по созвону.', en: 'Custom terms and onboarding — book a call.', de: 'Individuelle Konditionen und Onboarding – vereinbaren Sie ein Gespräch.', ar: 'شروط وتهيئة مخصصة — عبر مكالمة معنا.', kk: 'Жеке шарттар мен енгізу — қоңырау арқылы келісіледі.', uz: 'Individual shartlar va joriy etish — qoʻngʻiroqda kelishamiz.' },
  features: [
    { ru: 'Безлимитные пользователи и документы', en: 'Unlimited users and documents', de: 'Unbegrenzte Nutzer und Dokumente', ar: 'عدد غير محدود من المستخدمين والمستندات', kk: 'Шексіз пайдаланушылар мен құжаттар', uz: 'Cheklanmagan foydalanuvchilar va hujjatlar' },
    { ru: 'Приватные / self-hosted AI-модели', en: 'Private / self-hosted AI models', de: 'Private / self-hosted KI-Modelle', ar: 'نماذج ذكاء اصطناعي خاصة أو مستضافة ذاتياً', kk: 'Жеке / self-hosted AI-модельдер', uz: 'Privat / self-hosted AI modellar' },
    { ru: 'Кастомные интеграции и API', en: 'Custom integrations and API', de: 'Individuelle Integrationen und API', ar: 'تكاملات مخصصة وواجهات API', kk: 'Арнайы интеграциялар және API', uz: 'Maxsus integratsiyalar va API' },
    { ru: 'Персональный SLA и поддержка 24/7', en: 'Personal SLA and 24/7 support', de: 'Individuelles SLA und 24/7-Support', ar: 'اتفاقية مستوى خدمة (SLA) مخصصة ودعم على مدار الساعة 24/7', kk: 'Жеке SLA және 24/7 қолдау', uz: 'Shaxsiy SLA va 24/7 qoʻllab-quvvatlash' },
    { ru: 'Юридический on-boarding команды', en: 'Legal onboarding for your team', de: 'Juristisches Onboarding für Ihr Team', ar: 'تأهيل قانوني لفريقك', kk: 'Командаға арналған заңгерлік онбординг', uz: 'Jamoa uchun yuridik onboarding' },
  ],
};

interface FaqItem {
  q: Text2;
  a: Text2;
  /** Optional in-page link rendered under the answer. */
  link?: { id: string; label: Text2 };
}

const FAQ_GROUPS: { title: Text2; items: FaqItem[] }[] = [
  {
    title: { ru: 'Безопасность и конфиденциальность', en: 'Security & privacy', de: 'Sicherheit und Vertraulichkeit', ar: 'الأمان والخصوصية', kk: 'Қауіпсіздік және құпиялылық', uz: 'Xavfsizlik va maxfiylik' },
    items: [
      {
        q: { ru: 'Что происходит с моими договорами после загрузки?', en: 'What happens to my contracts after upload?', de: 'Was passiert mit meinen Verträgen nach dem Hochladen?', ar: 'ماذا يحدث لعقودي بعد رفعها؟', kk: 'Жүктегеннен кейін шарттарыма не болады?', uz: 'Yuklangandan keyin shartnomalarim bilan nima boʻladi?' },
        a: {
          ru: 'Файл сохраняется в приватном облачном хранилище (доступ — только по временным подписанным ссылкам), извлечённый текст — в защищённой базе данных. Документ используется только для анализа по вашему запросу. Удалить его — или весь аккаунт со всеми данными — можно в любой момент.',
          en: 'The file is stored in a private cloud bucket (accessible only via expiring signed links) and the extracted text in a protected database. It is used only for the analysis you request. You can delete a document — or your whole account with all its data — at any time.', de: 'Die Datei wird in einem privaten Cloud-Speicher abgelegt (Zugriff nur über zeitlich begrenzte signierte Links), der extrahierte Text in einer geschützten Datenbank. Das Dokument wird ausschließlich für die von Ihnen angeforderte Analyse verwendet. Sie können es – oder Ihr gesamtes Konto mit allen Daten – jederzeit löschen.', ar: 'يُحفظ الملف في مساحة تخزين سحابية خاصة (لا يمكن الوصول إليها إلا عبر روابط موقّعة مؤقتة)، ويُحفظ النص المستخرج في قاعدة بيانات محمية. ولا يُستخدم المستند إلا للتحليل الذي تطلبه أنت. ويمكنك في أي وقت حذف المستند — أو الحساب بأكمله مع جميع بياناته.', kk: 'Файл жеке бұлттық қоймада сақталады (қол жеткізу — тек мерзімі шектеулі қол қойылған сілтемелер арқылы), ал алынған мәтін — қорғалған дерекқорда. Құжат тек сіздің сұрауыңыз бойынша талдау үшін ғана пайдаланылады. Құжатты — немесе барлық деректерімен қоса бүкіл аккаунтты — кез келген сәтте жоюға болады.', uz: 'Fayl yopiq bulut xotirasida saqlanadi (kirish — faqat muddati cheklangan imzolangan havolalar orqali), ajratib olingan matn esa himoyalangan maʼlumotlar bazasida turadi. Hujjat faqat sizning soʻrovingiz boʻyicha tahlil uchun ishlatiladi. Uni — yoki butun akkauntni barcha maʼlumotlari bilan — istalgan payt oʻchirish mumkin.',
        },
      },
      {
        q: { ru: 'Вы используете мои документы для обучения ИИ?', en: 'Do you use my documents to train the AI?', de: 'Verwenden Sie meine Dokumente zum Trainieren der KI?', ar: 'هل تستخدمون مستنداتي لتدريب الذكاء الاصطناعي؟', kk: 'Менің құжаттарым ЖИ-ді оқытуға пайдаланыла ма?', uz: 'Hujjatlarimni AIni oʻqitish uchun ishlatasizmi?' },
        a: {
          ru: 'Нет. Документы не используются для обучения моделей и не передаются третьим лицам.',
          en: 'No. Your documents are not used for model training and are not shared with third parties.', de: 'Nein. Ihre Dokumente werden weder zum Trainieren von Modellen verwendet noch an Dritte weitergegeben.', ar: 'لا. لا تُستخدم مستنداتك لتدريب النماذج ولا تُشارك مع أطراف ثالثة.', kk: 'Жоқ. Құжаттар модельдерді оқытуға пайдаланылмайды және үшінші тұлғаларға берілмейді.', uz: 'Yoʻq. Hujjatlar modellarni oʻqitish uchun ishlatilmaydi va uchinchi shaxslarga berilmaydi.',
        },
      },
      {
        q: { ru: 'Кто может видеть мои документы?', en: 'Who can see my documents?', de: 'Wer kann meine Dokumente sehen?', ar: 'من يستطيع رؤية مستنداتي؟', kk: 'Менің құжаттарымды кім көре алады?', uz: 'Hujjatlarimni kim koʻra oladi?' },
        a: {
          ru: 'Только вы. На тарифе Business документ можно открыть своей команде: вы сами приглашаете коллег и назначаете роли — администратор, редактор или просмотр. Без вашего решения документ не увидит никто.',
          en: 'Only you. On the Business plan you can share a document with your team: you invite colleagues yourself and assign roles — admin, editor or viewer. Nobody sees a document unless you decide so.', de: 'Nur Sie. Im Business-Tarif können Sie ein Dokument für Ihr Team freigeben: Sie laden Ihre Kollegen selbst ein und vergeben die Rollen – Administrator, Bearbeiter oder Betrachter. Ohne Ihre Entscheidung sieht niemand das Dokument.', ar: 'أنت فقط. وعلى باقة Business يمكنك مشاركة المستند مع فريقك: أنت من يدعو الزملاء ويعيّن الأدوار — مسؤول أو محرر أو عارض. ولن يرى أحد المستند من دون قرارك.', kk: 'Тек өзіңіз. Business тарифінде құжатты командаңызға ашуға болады: әріптестерді өзіңіз шақырып, рөлдерді тағайындайсыз — әкімші, редактор немесе қарау. Сіздің шешіміңізсіз құжатты ешкім көрмейді.', uz: 'Faqat siz. Business tarifida hujjatni jamoangizga ochish mumkin: hamkasblarni oʻzingiz taklif qilasiz va rollarni tayinlaysiz — administrator, muharrir yoki koʻruvchi. Sizning qaroringizsiz hujjatni hech kim koʻrmaydi.',
        },
      },
    ],
  },
  {
    title: { ru: 'Как работает анализ', en: 'How the analysis works', de: 'Wie die Analyse funktioniert', ar: 'كيف يعمل التحليل', kk: 'Талдау қалай жұмыс істейді', uz: 'Tahlil qanday ishlaydi' },
    items: [
      {
        q: { ru: 'Можно ли доверять выводам ИИ? Он не ошибается?', en: 'Can I trust the AI’s conclusions? Doesn’t it make mistakes?', de: 'Kann ich den Ergebnissen der KI vertrauen? Macht sie keine Fehler?', ar: 'هل يمكن الوثوق باستنتاجات الذكاء الاصطناعي؟ ألا يخطئ؟', kk: 'ЖИ тұжырымдарына сенуге бола ма? Ол қателеспей ме?', uz: 'AI xulosalariga ishonsa boʻladimi? U xato qilmaydimi?' },
        a: {
          ru: 'Lexab не даёт «мнение из воздуха»: каждый вывод сопровождается ссылкой на конкретную норму, которую можно открыть и проверить самостоятельно. Цитаты автоматически сверяются с базой официальных текстов; не прошедшие проверку помечаются как неподтверждённые. ИИ — ускоритель работы, финальное решение всегда за юристом.',
          en: 'Lexab doesn’t give opinions out of thin air: every finding comes with a reference to a specific provision you can open and verify. Citations are automatically checked against a corpus of official texts; anything that fails the check is flagged as unverified. The AI speeds up the work — the final call is always the lawyer’s.', de: 'Lexab liefert keine Einschätzungen „aus dem Nichts“: Jedes Ergebnis wird von einem Verweis auf eine konkrete Rechtsnorm begleitet, die Sie öffnen und selbst überprüfen können. Die Zitate werden automatisch mit einer Datenbank offizieller Gesetzestexte abgeglichen; was die Prüfung nicht besteht, wird als unbestätigt gekennzeichnet. Die KI beschleunigt die Arbeit – die endgültige Entscheidung liegt immer beim Juristen.', ar: 'لا يُصدر Lexab آراءً من فراغ: فكل استنتاج مصحوب بإحالة إلى نص قانوني محدد يمكنك فتحه والتحقق منه بنفسك. وتُقارن الاستشهادات تلقائياً بقاعدة النصوص الرسمية، وما لا يجتاز التحقق يوسَم بأنه غير مؤكد. الذكاء الاصطناعي يسرّع العمل — أما القرار النهائي فيبقى دائماً للمحامي.', kk: 'Lexab ойдан пікір айтпайды: әр тұжырымға өзіңіз ашып тексере алатын нақты нормаға сілтеме қоса беріледі. Дәйексөздер ресми мәтіндер базасымен автоматты түрде салыстырылады; тексеруден өтпегендері расталмаған деп белгіленеді. ЖИ — жұмысты жеделдететін құрал, ал түпкілікті шешім әрқашан заңгердікі.', uz: 'Lexab «havodan olingan fikr» bermaydi: har bir xulosa aniq normaga havola bilan birga keladi — uni ochib, oʻzingiz tekshirishingiz mumkin. Iqtiboslar rasmiy matnlar bazasi bilan avtomatik solishtiriladi; tekshiruvdan oʻtmaganlari tasdiqlanmagan deb belgilanadi. AI — ishni tezlashtiruvchi vosita, yakuniy qaror esa har doim yuristda.',
        },
      },
      {
        q: { ru: 'Что значит «ссылки на законодательство»?', en: 'What do “legal citations” mean?', de: 'Was ist mit „Gesetzeszitaten“ gemeint?', ar: 'ما المقصود بـ«الاستشهادات بالتشريعات»؟', kk: '«Заңнамаға сілтемелер» деген нені білдіреді?', uz: '«Qonunchilikka havolalar» nimani anglatadi?' },
        a: {
          ru: 'Если система отмечает рискованный пункт, она показывает не просто «это плохо», а ссылку на статью закона, из-за которой пункт является рискованным. Тексты норм попадают в базу только из официальных государственных источников соответствующей юрисдикции, поэтому система не может «придумать» несуществующую норму, как обычный чат-бот.',
          en: 'When the system flags a risky clause, it doesn’t just say “this is bad” — it shows the specific statutory provision that makes the clause risky. Law texts enter the corpus only from official government sources for each jurisdiction, so the system cannot “invent” a non-existent provision the way a generic chatbot can.', de: 'Wenn das System eine riskante Klausel markiert, sagt es nicht bloß „das ist schlecht“, sondern zeigt die konkrete Gesetzesnorm, die die Klausel riskant macht. Gesetzestexte gelangen ausschließlich aus offiziellen staatlichen Quellen der jeweiligen Jurisdiktion in die Datenbank – das System kann daher keine nicht existierende Norm „erfinden“, wie es ein gewöhnlicher Chatbot tun kann.', ar: 'عندما يحدّد النظام بنداً ينطوي على مخاطر، فإنه لا يكتفي بالقول «هذا سيئ»، بل يعرض مادة القانون التي تجعل البند خطراً. ولا تدخل نصوص القوانين إلى القاعدة إلا من المصادر الحكومية الرسمية لكل ولاية قضائية، لذلك لا يستطيع النظام «اختلاق» نص قانوني لا وجود له كما تفعل روبوتات المحادثة العادية.', kk: 'Жүйе тәуекелді тармақты белгілегенде, жай ғана «бұл нашар» деп қоймайды — тармақты тәуекелді ететін нақты заң бабына сілтеме көрсетеді. Нормалардың мәтіндері базаға тек тиісті юрисдикцияның ресми мемлекеттік дереккөздерінен түседі, сондықтан жүйе қарапайым чат-бот сияқты жоқ норманы «ойлап шығара» алмайды.', uz: 'Tizim xavfli bandni belgilasa, u shunchaki «bu yomon» demaydi — bandni xavfli qilayotgan qonun moddasiga havolani koʻrsatadi. Norma matnlari bazaga faqat tegishli yurisdiksiyaning rasmiy davlat manbalaridan kiradi, shuning uchun tizim oddiy chat-bot kabi mavjud boʻlmagan normani «toʻqib chiqara» olmaydi.',
        },
      },
      {
        q: { ru: 'С законодательством каких стран вы работаете?', en: 'Which countries’ legislation do you cover?', de: 'Die Gesetzgebung welcher Länder decken Sie ab?', ar: 'ما الدول التي تغطون تشريعاتها؟', kk: 'Қай елдердің заңнамасымен жұмыс істейсіздер?', uz: 'Qaysi davlatlar qonunchiligi bilan ishlaysiz?' },
        a: {
          ru: 'Сейчас доступны семь юрисдикций: Великобритания, США, Германия, Канада, Казахстан, Узбекистан и ОАЭ. Новые юрисдикции подключаются как отдельные модули.',
          en: 'Seven jurisdictions are available today: the United Kingdom, the United States, Germany, Canada, Kazakhstan, Uzbekistan and the UAE. New jurisdictions are added as separate modules.', de: 'Derzeit sind sieben Jurisdiktionen verfügbar: das Vereinigte Königreich, die USA, Deutschland, Kanada, Kasachstan, Usbekistan und die VAE. Neue Jurisdiktionen werden als separate Module angebunden.', ar: 'تتوفر اليوم سبع ولايات قضائية: المملكة المتحدة والولايات المتحدة وألمانيا وكندا وكازاخستان وأوزبكستان والإمارات العربية المتحدة. وتُضاف الولايات القضائية الجديدة كوحدات مستقلة.', kk: 'Қазір жеті юрисдикция қолжетімді: Ұлыбритания, АҚШ, Германия, Канада, Қазақстан, Өзбекстан және БАӘ. Жаңа юрисдикциялар жеке модульдер ретінде қосылады.', uz: 'Hozirda yettita yurisdiksiya mavjud: Buyuk Britaniya, AQSH, Germaniya, Kanada, Qozogʻiston, Oʻzbekiston va BAA. Yangi yurisdiksiyalar alohida modullar sifatida qoʻshiladi.',
        },
      },
      {
        q: { ru: 'Lexab заменяет юриста?', en: 'Does Lexab replace a lawyer?', de: 'Ersetzt Lexab den Juristen?', ar: 'هل يحل Lexab محل المحامي؟', kk: 'Lexab заңгерді алмастыра ма?', uz: 'Lexab yuristning oʻrnini bosadimi?' },
        a: {
          ru: 'Нет. Он берёт на себя рутину — вычитку, поиск рисков, редлайнинг, — чтобы юрист тратил время на решения, а не на перечитывание типовых пунктов.',
          en: 'No. It takes over the routine — proofreading, risk-spotting, redlining — so the lawyer spends time on decisions rather than re-reading boilerplate.', de: 'Nein. Lexab übernimmt die Routine – die Durchsicht, die Risikosuche, das Redlining –, damit Juristen ihre Zeit für Entscheidungen einsetzen statt für das erneute Lesen von Standardklauseln.', ar: 'لا. إنه يتولى الأعمال الروتينية — التدقيق واكتشاف المخاطر والتنقيح — ليصرف المحامي وقته في اتخاذ القرارات بدلاً من إعادة قراءة البنود النمطية.', kk: 'Жоқ. Ол күнделікті рутинаны — мәтінді түгендеуді, тәуекелдерді іздеуді, редлайнингті — өз мойнына алады, сөйтіп заңгер уақытын типтік тармақтарды қайта оқуға емес, шешімдерге жұмсайды.', uz: 'Yoʻq. U rutin ishlarni — sinchiklab oʻqish, xavflarni izlash, redlayningni — oʻz zimmasiga oladi; shunda yurist vaqtini tipik bandlarni qayta-qayta oʻqishga emas, qaror qabul qilishga sarflaydi.',
        },
      },
    ],
  },
  {
    title: { ru: 'Практика и старт', en: 'Getting started', de: 'Praxis und Einstieg', ar: 'البدء والاستخدام', kk: 'Практика және бастау', uz: 'Amaliyot va boshlash' },
    items: [
      {
        q: { ru: 'На каком языке работает система?', en: 'What languages does it work in?', de: 'In welchen Sprachen arbeitet das System?', ar: 'بأي لغة يعمل النظام؟', kk: 'Жүйе қай тілде жұмыс істейді?', uz: 'Tizim qaysi tilda ishlaydi?' },
        a: {
          ru: 'Интерфейс доступен на 6 языках: русском, английском, немецком, арабском, казахском и узбекском. ИИ отвечает на языке вашего вопроса. Корпус законов каждой юрисдикции хранится на её официальном языке публикации.',
          en: 'The interface is available in 6 languages: English, Russian, German, Arabic, Kazakh and Uzbek. The AI replies in the language of your question. Each jurisdiction’s law corpus is stored in its official language of publication.', de: 'Die Benutzeroberfläche ist in 6 Sprachen verfügbar: Deutsch, Englisch, Russisch, Arabisch, Kasachisch und Usbekisch. Die KI antwortet in der Sprache Ihrer Frage. Der Gesetzeskorpus jeder Jurisdiktion wird in ihrer offiziellen Veröffentlichungssprache gespeichert.', ar: 'الواجهة متوفرة بست لغات: العربية والإنجليزية والروسية والألمانية والكازاخية والأوزبكية، ويجيب الذكاء الاصطناعي بلغة سؤالك. أما مجموعة قوانين كل ولاية قضائية فتُحفظ بلغة نشرها الرسمية.', kk: 'Интерфейс 6 тілде қолжетімді: қазақ, орыс, ағылшын, неміс, араб және өзбек. ЖИ сұрағыңыздың тілінде жауап береді. Әр юрисдикцияның заңдар корпусы өзінің ресми жариялану тілінде сақталады.', uz: 'Interfeys 6 tilda mavjud: oʻzbek, rus, ingliz, nemis, arab va qozoq. AI savolingiz tilida javob beradi. Har bir yurisdiksiyaning qonunlar korpusi oʻzining rasmiy nashr tilida saqlanadi.',
        },
      },
      {
        q: { ru: 'Можно ли работать в привычном Word?', en: 'Can I keep working in Word?', de: 'Kann ich weiter im gewohnten Word arbeiten?', ar: 'هل يمكنني مواصلة العمل في Word كالمعتاد؟', kk: 'Үйреншікті Word-та жұмыс істей беруге бола ма?', uz: 'Odatiy Wordda ishlashda davom etsam boʻladimi?' },
        a: {
          ru: 'Да: документ с принятыми правками экспортируется в DOCX с сохранением форматирования и открывается в Word (есть и PDF). Отдельной надстройки внутри Word пока нет.',
          en: 'Yes: the document with accepted edits exports to DOCX with formatting preserved and opens in Word (PDF is available too). There is no in-Word add-in yet.', de: 'Ja: Das Dokument mit den angenommenen Änderungen wird als DOCX mit erhaltener Formatierung exportiert und öffnet sich in Word (PDF gibt es ebenfalls). Ein eigenes Add-in direkt in Word gibt es noch nicht.', ar: 'نعم: يُصدَّر المستند مع التعديلات المقبولة بصيغة DOCX مع الحفاظ على التنسيق ويفتح في Word (وتتوفر صيغة PDF أيضاً). ولا توجد حتى الآن إضافة مدمجة داخل Word.', kk: 'Иә: қабылданған түзетулері бар құжат пішімдеуі сақталған күйде DOCX форматына экспортталады және Word-та ашылады (PDF де бар). Word ішіндегі жеке қондырма әзірге жоқ.', uz: 'Ha: qabul qilingan tahrirlar kiritilgan hujjat formatlash saqlangan holda DOCXga eksport qilinadi va Wordda ochiladi (PDF ham bor). Word ichida ishlaydigan alohida plagin hozircha yoʻq.',
        },
      },
      {
        q: { ru: 'Как начать? Нужна ли карта?', en: 'How do I start? Do I need a card?', de: 'Wie starte ich? Brauche ich eine Kreditkarte?', ar: 'كيف أبدأ؟ وهل أحتاج إلى بطاقة؟', kk: 'Қалай бастауға болады? Карта қажет пе?', uz: 'Qanday boshlash mumkin? Karta kerakmi?' },
        a: {
          ru: 'Зарегистрируйтесь по email или через Google — тариф Free включает 10 AI-запросов и 3 документа в месяц. Банковская карта не нужна.',
          en: 'Sign up with email or Google — the Free plan includes 10 AI requests and 3 documents per month. No bank card required.', de: 'Registrieren Sie sich per E-Mail oder über Google – der Free-Tarif umfasst 10 KI-Anfragen und 3 Dokumente pro Monat. Eine Bankkarte ist nicht erforderlich.', ar: 'سجّل بالبريد الإلكتروني أو عبر Google — تتضمن باقة Free عشرة طلبات ذكاء اصطناعي و3 مستندات شهرياً. ولا حاجة إلى بطاقة بنكية.', kk: 'Email немесе Google арқылы тіркеліңіз — Free тарифіне айына 10 AI-сұрау мен 3 құжат кіреді. Банк картасы қажет емес.', uz: 'Email yoki Google orqali roʻyxatdan oʻting — Free tarifi oyiga 10 ta AI soʻrov va 3 ta hujjatni oʻz ichiga oladi. Bank kartasi kerak emas.',
        },
      },
      {
        q: { ru: 'Сколько это стоит?', en: 'How much does it cost?', de: 'Was kostet das?', ar: 'كم التكلفة؟', kk: 'Бұл қанша тұрады?', uz: 'Bu qancha turadi?' },
        a: {
          ru: 'Четыре тарифа под разный объём работы — от бесплатного до Business. При годовой оплате — скидка 15%.',
          en: 'Four plans for different workloads — from Free to Business. Annual billing comes with a 15% discount.', de: 'Vier Tarife für unterschiedliche Arbeitsvolumen – von Free bis Business. Bei jährlicher Zahlung erhalten Sie 15 % Rabatt.', ar: 'أربع باقات لأحجام عمل مختلفة — من Free المجانية إلى Business. وعند الدفع السنوي خصم 15%.', kk: 'Әртүрлі жұмыс көлеміне арналған төрт тариф — тегіннен Business-ке дейін. Жылдық төлемде — 15% жеңілдік.', uz: 'Turli ish hajmiga moʻljallangan toʻrtta tarif — bepul tarifdan Businessgacha. Yillik toʻlovda — 15% chegirma.',
        },
        link: { id: 'plans', label: { ru: 'Открыть тарифы', en: 'See pricing', de: 'Preise ansehen', ar: 'عرض الأسعار', kk: 'Тарифтерді ашу', uz: 'Tariflarni koʻrish' } },
      },
    ],
  },
];

/** Footer columns: section anchors, verifiable sources, contacts, legal. */
const FOOTER_COLS: {
  title: Text2;
  links: { label: Text2; anchor?: string; href?: string; to?: string }[];
}[] = [
  {
    title: { ru: 'Продукт', en: 'Product', de: 'Produkt', ar: 'المنتج', kk: 'Өнім', uz: 'Mahsulot' },
    links: [
      { label: { ru: 'Возможности', en: 'Features', de: 'Funktionen', ar: 'المزايا', kk: 'Мүмкіндіктер', uz: 'Imkoniyatlar' }, anchor: 'features' },
      { label: { ru: 'Как это работает', en: 'How it works', de: 'So funktioniert es', ar: 'كيف يعمل', kk: 'Бұл қалай жұмыс істейді', uz: 'Bu qanday ishlaydi' }, anchor: 'how-it-works' },
      { label: { ru: 'Демо', en: 'Demo', de: 'Demo', ar: 'عرض توضيحي', kk: 'Демо', uz: 'Demo' }, anchor: 'demo' },
      { label: { ru: 'Тарифы', en: 'Pricing', de: 'Preise', ar: 'الأسعار', kk: 'Тарифтер', uz: 'Tariflar' }, anchor: 'plans' },
      { label: { ru: 'FAQ', en: 'FAQ', de: 'FAQ', ar: 'الأسئلة الشائعة', kk: 'FAQ', uz: 'FAQ' }, anchor: 'faq' },
    ],
  },
  {
    title: { ru: 'Безопасность', en: 'Security', de: 'Sicherheit', ar: 'الأمان', kk: 'Қауіпсіздік', uz: 'Xavfsizlik' },
    links: [
      { label: { ru: 'Как мы храним данные', en: 'How we store data', de: 'Wie wir Daten speichern', ar: 'كيف نخزّن البيانات', kk: 'Деректерді қалай сақтаймыз', uz: 'Maʼlumotlarni qanday saqlaymiz' }, anchor: 'security' },
    ],
  },
  {
    title: { ru: 'Контакты', en: 'Contacts', de: 'Kontakt', ar: 'للتواصل', kk: 'Байланыс', uz: 'Aloqa' },
    links: [
      { label: { ru: 'Telegram · @MANAGER_CIVIS', en: 'Telegram · @MANAGER_CIVIS', de: 'Telegram · @MANAGER_CIVIS', ar: 'Telegram · @MANAGER_CIVIS', kk: 'Telegram · @MANAGER_CIVIS', uz: 'Telegram · @MANAGER_CIVIS' }, href: TELEGRAM_URL },
      { label: { ru: 'Enterprise — написать нам', en: 'Enterprise — message us', de: 'Enterprise – schreiben Sie uns', ar: 'Enterprise — راسلنا', kk: 'Enterprise — бізге жазыңыз', uz: 'Enterprise — bizga yozing' }, href: TELEGRAM_URL },
    ],
  },
  {
    title: { ru: 'Правовое', en: 'Legal', de: 'Rechtliches', ar: 'الشؤون القانونية', kk: 'Құқықтық', uz: 'Huquqiy hujjatlar' },
    links: [
      { label: { ru: 'Условия использования', en: 'Terms of Use', de: 'Nutzungsbedingungen', ar: 'شروط الاستخدام', kk: 'Пайдалану шарттары', uz: 'Foydalanish shartlari' }, to: '/terms' },
      { label: { ru: 'Политика конфиденциальности', en: 'Privacy Policy', de: 'Datenschutzerklärung', ar: 'سياسة الخصوصية', kk: 'Құпиялылық саясаты', uz: 'Maxfiylik siyosati' }, to: '/privacy' },
    ],
  },
];

function Head({ id }: { id: keyof typeof HEADS }) {
  const { lang } = useI18n();
  const head = HEADS[id];
  return (
    <div className={styles.head}>
      <div className={styles.eyebrow}>{pickText(head.eyebrow, lang)}</div>
      <h2 className={styles.title}>{pickText(head.title, lang)}</h2>
      <p className={styles.sub}>{pickText(head.sub, lang)}</p>
    </div>
  );
}

/**
 * Marketing sections below the first screen of the /login landing page:
 * features, how-it-works, demo, audiences, security, pricing, FAQ, footer.
 * `onStart` scrolls back to the sign-up card and opens the email form.
 */
export function LandingSections({ onStart }: { onStart: () => void }) {
  const { t, lang } = useI18n();
  const [yearly, setYearly] = useState(false);

  // Scroll-reveal: tag [data-reveal] elements as hidden only when JS runs and
  // motion is allowed, then fade each one in as it enters the viewport.
  useEffect(() => {
    if (prefersReducedMotion() || typeof IntersectionObserver === 'undefined') return;
    const els = Array.from(document.querySelectorAll<HTMLElement>('[data-reveal]'));
    els.forEach((el) => el.classList.add(styles.reveal));
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add(styles.revealIn);
            observer.unobserve(entry.target);
          }
        }
      },
      { threshold: 0.15 },
    );
    els.forEach((el) => observer.observe(el));
    return () => {
      observer.disconnect();
      els.forEach((el) => el.classList.remove(styles.reveal, styles.revealIn));
    };
  }, []);

  /** Stagger: each card in a grid enters 60ms after the previous one. */
  const revealAt = (i: number) => ({ '--reveal-delay': `${i * 60}ms` }) as CSSProperties;

  return (
    <>
      {/* ── Возможности ──────────────────────────────────────────────────── */}
      <section id="features" className={styles.section}>
        <div className={styles.inner}>
          <Head id="features" />
          <div className={styles.cardsGrid}>
            {FEATURES.map((f, i) => (
              <div key={f.icon} className={styles.card} data-reveal style={revealAt(i)}>
                <span className={styles.cardIcon}>
                  <Icon name={f.icon} size={19} />
                </span>
                <div className={styles.cardTitle}>{pickText(f.title, lang)}</div>
                <div className={styles.cardText}>{pickText(f.text, lang)}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Как это работает ─────────────────────────────────────────────── */}
      <section id="how-it-works" className={`${styles.section} ${styles.sectionAlt}`}>
        <div className={styles.inner}>
          <Head id="how" />
          <div className={styles.steps}>
            {STEPS.map((s, i) => (
              <div key={s.title.en} className={styles.step} data-reveal style={revealAt(i)}>
                <div className={styles.stepNum}>{String(i + 1).padStart(2, '0')}</div>
                <div className={styles.stepTitle}>{pickText(s.title, lang)}</div>
                <div className={styles.stepText}>{pickText(s.text, lang)}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Демо ─────────────────────────────────────────────────────────── */}
      <section id="demo" className={styles.section}>
        <div className={styles.inner}>
          <Head id="demo" />
          <LandingDemo />
          <div className={styles.demoNote}>{pickText(DEMO_NOTE, lang)}</div>
          <div className={styles.centerCta}>
            <button type="button" className={styles.ctaPrimary} onClick={onStart}>
              {t('landing.startFree')}
            </button>
          </div>
        </div>
      </section>

      {/* ── Для кого ─────────────────────────────────────────────────────── */}
      <section id="solutions" className={`${styles.section} ${styles.sectionAlt}`}>
        <div className={styles.inner}>
          <Head id="solutions" />
          <div className={styles.audienceGrid}>
            {AUDIENCES.map((a, i) => (
              <div key={a.title.en} className={styles.audienceCard} data-reveal style={revealAt(i)}>
                <div className={styles.audienceTop}>
                  <span className={styles.audienceIcon}>
                    <Icon name={a.icon} size={19} />
                  </span>
                  {a.metric ? <span className={styles.audienceMetric}>{pickText(a.metric, lang)}</span> : null}
                </div>
                <div className={styles.audienceTitle}>{pickText(a.title, lang)}</div>
                <div className={styles.cardText}>{pickText(a.text, lang)}</div>
                <button
                  type="button"
                  className={styles.audienceMore}
                  onClick={() =>
                    document.getElementById('features')?.scrollIntoView({ behavior: scrollBehavior(), block: 'start' })
                  }
                >
                  {pickText({ ru: 'Подробнее', en: 'Learn more', de: 'Mehr erfahren', ar: 'المزيد', kk: 'Толығырақ', uz: 'Batafsil' }, lang)}
                  <Icon name="arrowUpRight" size={14} />
                </button>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Безопасность ─────────────────────────────────────────────────── */}
      <section id="security" className={styles.section}>
        <div className={styles.inner}>
          <Head id="security" />
          <div className={styles.securityGrid}>
            {SECURITY.map((s, i) => (
              <div key={s.title.en} className={styles.securityCard} data-reveal style={revealAt(i)}>
                <span className={styles.securityIcon}>
                  <Icon name={s.icon} size={17} />
                </span>
                <div>
                  <div className={styles.cardTitle}>{pickText(s.title, lang)}</div>
                  <div className={styles.cardText}>{pickText(s.text, lang)}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Тарифы ───────────────────────────────────────────────────────── */}
      <section id="plans" className={`${styles.section} ${styles.sectionAlt}`}>
        <div className={styles.inner}>
          <Head id="plans" />

          {/* Billing period — same 15% yearly discount as the in-app page. */}
          <div className={styles.billingToggle} role="group" aria-label={t('landing.nav.plans')}>
            <button
              type="button"
              className={`${styles.billingBtn} ${!yearly ? styles.billingBtnActive : ''}`}
              aria-pressed={!yearly}
              onClick={() => setYearly(false)}
            >
              {t('plans.monthly')}
            </button>
            <button
              type="button"
              className={`${styles.billingBtn} ${yearly ? styles.billingBtnActive : ''}`}
              aria-pressed={yearly}
              onClick={() => setYearly(true)}
            >
              {t('plans.yearly')}
              <span className={styles.billingBadge}>−15%</span>
            </button>
          </div>

          <div className={styles.plansGrid}>
            {PLANS.map((p, i) => (
              <div
                key={p.name}
                className={`${styles.plan} ${p.popular ? styles.planPopular : ''}`}
                data-reveal
                style={revealAt(i)}
              >
                {p.popular ? (
                  <div className={styles.planBadge}>{pickText({ ru: 'Популярный', en: 'Popular', de: 'Beliebt', ar: 'الأكثر شيوعًا', kk: 'Танымал', uz: 'Ommabop' }, lang)}</div>
                ) : null}
                <div className={styles.planName}>
                  <span className={styles.planDot} style={{ background: p.dot }} />
                  {p.name}
                </div>
                <div className={styles.planPrice}>
                  {yearly && p.monthly > 0 ? <span className={styles.planPriceOld}>${p.monthly}</span> : null}
                  ${yearly ? Math.round(p.monthly * (1 - YEARLY_DISCOUNT)) : p.monthly}
                  <span className={styles.planPer}>{pickText({ ru: '/мес', en: '/mo', de: '/Mon.', ar: '/شهر', kk: '/ай', uz: '/oy' }, lang)}</span>
                </div>
                {yearly && p.monthly > 0 ? (
                  <div className={styles.planPriceNote}>{t('plans.yearlyNote')}</div>
                ) : null}
                <div className={styles.planTagline}>{pickText(p.tagline, lang)}</div>
                {p.inherits ? <div className={styles.planInherits}>{pickText(p.inherits, lang)}</div> : null}
                <ul className={styles.planFeatures}>
                  {p.features.map((f) => (
                    <li key={f.en}>
                      <Icon name="check" size={13} className={styles.planCheck} />
                      {pickText(f, lang)}
                    </li>
                  ))}
                </ul>
                <button
                  type="button"
                  className={p.popular ? styles.planBtnDark : styles.planBtnFilled}
                  onClick={onStart}
                >
                  {p.name === 'Free' ? t('landing.startFree') : t('landing.choosePlan')}
                </button>
              </div>
            ))}
          </div>
          {/* Enterprise — custom pricing, full-width card (mirrors the in-app page). */}
          <div className={styles.enterprise} data-reveal>
            <div className={styles.enterpriseInfo}>
              <div className={styles.planName}>
                <span className={styles.planDot} style={{ background: ENTERPRISE.dot }} />
                Enterprise
              </div>
              <div className={styles.planTagline}>{pickText(ENTERPRISE.tagline, lang)}</div>
              <div className={styles.enterprisePrice}>{pickText(ENTERPRISE.priceLabel, lang)}</div>
              <a
                className={styles.enterpriseCta}
                href={TELEGRAM_URL}
                target="_blank"
                rel="noreferrer noopener"
              >
                {pickText({ ru: 'Связаться', en: 'Contact us', de: 'Kontakt aufnehmen', ar: 'تواصل معنا', kk: 'Байланысу', uz: "Bog'lanish" }, lang)}
              </a>
            </div>
            <ul className={styles.enterpriseFeatures}>
              {ENTERPRISE.features.map((f) => (
                <li key={f.en}>
                  <Icon name="check" size={13} className={styles.planCheck} />
                  {pickText(f, lang)}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* ── FAQ ──────────────────────────────────────────────────────────── */}
      <section id="faq" className={styles.section}>
        <div className={styles.inner}>
          <Head id="faq" />
          <div className={styles.faq}>
            {FAQ_GROUPS.map((group) => (
              <div key={group.title.en}>
                <h3 className={styles.faqGroupTitle}>{pickText(group.title, lang)}</h3>
                {group.items.map((item) => (
                  <details key={item.q.en} className={styles.faqItem}>
                    <summary className={styles.faqQ}>
                      {pickText(item.q, lang)}
                      <span className={styles.faqToggle}>
                        <Icon name="plus" size={16} />
                      </span>
                    </summary>
                    <div className={styles.faqA}>
                      {pickText(item.a, lang)}
                      {item.link ? (
                        <button
                          type="button"
                          className={styles.faqLink}
                          onClick={() =>
                            document
                              .getElementById(item.link!.id)
                              ?.scrollIntoView({ behavior: scrollBehavior(), block: 'start' })
                          }
                        >
                          {pickText(item.link.label, lang)} →
                        </button>
                      ) : null}
                    </div>
                  </details>
                ))}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Pre-footer CTA banner ────────────────────────────────────────── */}
      <section className={styles.section}>
        <div className={styles.inner}>
          <div className={styles.ctaBanner} data-reveal>
            <span className={styles.ctaBannerGrid} aria-hidden="true" />
            <h2 className={styles.ctaBannerTitle}>
              {pickText({ ru: 'Готовы ускорить работу с контрактами?', en: 'Ready to speed up your contract work?', de: 'Bereit, Ihre Vertragsarbeit zu beschleunigen?', ar: 'هل أنت مستعد لتسريع العمل على عقودك؟', kk: 'Келісімшарт жұмысын жеделдетуге дайынсыз ба?', uz: 'Shartnomalar bilan ishlashni tezlashtirishga tayyormisiz?' }, lang)}
            </h2>
            <p className={styles.ctaBannerSub}>
              {pickText({ ru: 'Пилот за 3 дня. Никакой карты. Полный доступ к возможностям Enterprise.', en: 'A 3-day pilot. No card. Full access to Enterprise features.', de: 'Pilot in 3 Tagen. Keine Karte nötig. Voller Zugriff auf Enterprise-Funktionen.', ar: 'تجربة خلال 3 أيام. دون بطاقة. وصول كامل إلى إمكانات Enterprise.', kk: '3 күнде пилот. Карта қажет емес. Enterprise мүмкіндіктеріне толық қолжетімділік.', uz: "3 kunda pilot. Karta shart emas. Enterprise imkoniyatlaridan to'liq foydalanish." }, lang)}
            </p>
            <div className={styles.ctaBannerBtns}>
              <button type="button" className={styles.ctaBannerPrimary} onClick={onStart}>
                {t('landing.navCta')}
                <Icon name="arrowRight" size={17} />
              </button>
              <button
                type="button"
                className={styles.ctaBannerGhost}
                onClick={() =>
                  document.getElementById('demo')?.scrollIntoView({ behavior: scrollBehavior(), block: 'start' })
                }
              >
                {t('landing.viewDemo')}
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* ── Footer ───────────────────────────────────────────────────────── */}
      <footer className={styles.footer}>
        <div className={styles.footerGrid}>
          <div className={styles.footerBrandCol}>
            <div className={styles.footerLogo}>
              <Avatar size={30} />
              <span>Lexab</span>
            </div>
            <p className={styles.footerTagline}>{t('auth.tagline')}</p>
            <p className={styles.footerJuris}>
              {pickText({ ru: 'Юрисдикции: Великобритания · США · Германия · Канада · Казахстан · Узбекистан · ОАЭ', en: 'Jurisdictions: United Kingdom · United States · Germany · Canada · Kazakhstan · Uzbekistan · UAE', de: 'Jurisdiktionen: Großbritannien · USA · Deutschland · Kanada · Kasachstan · Usbekistan · VAE', ar: 'الولايات القضائية: المملكة المتحدة · الولايات المتحدة · ألمانيا · كندا · كازاخستان · أوزبكستان · الإمارات', kk: 'Юрисдикциялар: Ұлыбритания · АҚШ · Германия · Канада · Қазақстан · Өзбекстан · БАӘ', uz: "Yurisdiksiyalar: Buyuk Britaniya · AQSH · Germaniya · Kanada · Qozog'iston · O'zbekiston · BAA" }, lang)}
            </p>
          </div>

          {FOOTER_COLS.map((col) => (
            <nav key={col.title.en} className={styles.footerCol} aria-label={pickText(col.title, lang)}>
              <div className={styles.footerColTitle}>{pickText(col.title, lang)}</div>
              {col.links.map((l) =>
                l.anchor ? (
                  <button
                    key={l.label.en}
                    type="button"
                    className={styles.footerLink}
                    onClick={() =>
                      document
                        .getElementById(l.anchor!)
                        ?.scrollIntoView({ behavior: scrollBehavior(), block: 'start' })
                    }
                  >
                    {pickText(l.label, lang)}
                  </button>
                ) : l.to ? (
                  <Link key={l.label.en} to={l.to} className={styles.footerLink}>
                    {pickText(l.label, lang)}
                  </Link>
                ) : (
                  <a
                    key={l.label.en}
                    href={l.href}
                    target="_blank"
                    rel="noreferrer noopener"
                    className={styles.footerLink}
                  >
                    {pickText(l.label, lang)}
                  </a>
                ),
              )}
            </nav>
          ))}
        </div>

        <div className={styles.footerBottom}>© {new Date().getFullYear()} Lexab · {t('auth.tagline')}</div>
      </footer>
    </>
  );
}
