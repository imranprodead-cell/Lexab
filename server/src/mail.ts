/**
 * Outbound email via Resend (https://resend.com). No SDK — a single HTTPS call.
 *
 * - Without RESEND_API_KEY: sendMail() logs and returns { sent: false } —
 *   every flow keeps working locally (the UI exposes copyable links).
 * - With MAIL_REDIRECT_TO (no verified domain yet): ALL mail is delivered to
 *   that address with a "test mode" banner naming the intended recipient.
 *   Once the domain is verified in Resend: set MAIL_FROM to it and remove
 *   MAIL_REDIRECT_TO — mail then flows to real users. That's the whole switch.
 */
import { config } from './config.ts';

export interface MailAttachment {
  filename: string;
  /** Raw file bytes, base64-encoded (no data: prefix). */
  content: string;
}

export interface MailInput {
  to: string;
  subject: string;
  html: string;
  attachments?: MailAttachment[];
}

/** Escape user-provided values interpolated into email HTML. */
export function escapeMailHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Двуязычные письма: у получателя нет настройки языка (внешние подписанты,
 * согласанты, свежие регистрации), поэтому КАЖДОЕ письмо несёт русский блок
 * и английский дубль — чисто русское письмо в Лондоне или Берлине выглядит
 * фишингом и умирает во «входящих», не дойдя до локализованных страниц.
 */

/** Тема письма «RU / EN» (+ опциональный хвост, общий для обоих языков). */
export function biSubject(ru: string, en: string, tail?: string): string {
  return `${ru} / ${en}${tail ? `: ${tail}` : ''}`;
}

/** Короткая двуязычная строка «RU / EN» (кнопки, заголовки). */
export function biLine(ru: string, en: string): string {
  return `${ru} / ${en}`;
}

/** Тело письма: русские абзацы, тонкий разделитель, английский дубль.
 *  Класс lx-rule обязателен — в тёмной теме письма линия перекрашивается им;
 *  захардкоженный светлый цвет здесь давал ослепительно белую черту поперёк
 *  тёмного письма. */
export function biBody(ruHtml: string, enHtml: string): string {
  return `${ruHtml}
<div class="lx-rule" style="border-top:1px solid #e8e6e3;margin:18px 0;font-size:0;line-height:0;">&#8203;</div>
<div lang="en">${enHtml}</div>`;
}

/** Mask an address for logs — keep just enough to debug without recording PII
 *  (recipient addresses) verbatim in log streams that outlive the request. */
function maskEmail(addr: string): string {
  const at = addr.indexOf('@');
  if (at < 1) return '***';
  const local = addr.slice(0, at);
  return `${local[0]}***@${addr.slice(at + 1)}`;
}

export async function sendMail(input: MailInput): Promise<{ sent: boolean }> {
  if (!input.to) {
    // Пустой адресат (например, не задан CONTACT_EMAIL) — честно пропускаем
    // с громким логом, а не роняем запрос об ошибку провайдера.
    console.error(`[mail] skipped "${input.subject}" — empty recipient (is CONTACT_EMAIL set?)`);
    return { sent: false };
  }
  if (!config.resendApiKey) {
    console.log(`[mail] (no RESEND_API_KEY) would send to ${maskEmail(input.to)}: ${input.subject}`);
    return { sent: false };
  }

  // Domain not verified yet → deliver everything to the owner's inbox,
  // clearly labelled with who it was meant for.
  let to = input.to;
  let subject = input.subject;
  let html = input.html;
  const redirect = config.mailRedirectTo?.trim();
  if (redirect && redirect.toLowerCase() !== input.to.toLowerCase()) {
    to = redirect;
    subject = `[для ${input.to}] ${input.subject}`;
    const banner = `<div style="max-width:560px;margin:0 auto;padding:11px 16px;border-radius:12px;background:#fbf7ee;border:1px solid #ece0c8;font-family:${MAIL_FONT};font-size:12px;line-height:1.6;color:#7a6428;">
      Тестовый режим (домен ещё не подключён): это письмо предназначалось <strong>${escapeMailHtml(input.to)}</strong>. После подключения домена письма пойдут получателям напрямую.<br/>Test mode (domain not connected yet): this email was intended for the address above.
    </div>`;
    // Вставка сразу за <body> — оболочка mailLayout начинается с таблицы-фона,
    // поэтому баннер остаётся над письмом и не ломает его ширину.
    html = html.replace(/<body[^>]*>/, (m) => `${m}\n<div style="padding:24px 16px 0;">${banner}</div>`);
  }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      // Единственный исходящий fetch без таймаута во всём сервере: часть писем
      // отправляется с ожиданием (await) прямо в HTTP-обработчике, и зависший
      // провайдер держал запрос пользователя до дефолтных ~5 минут Node
      // (аудит 2026-08-03).
      signal: AbortSignal.timeout(10_000),
      headers: {
        Authorization: `Bearer ${config.resendApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: config.mailFrom,
        to: [to],
        subject,
        html,
        ...(input.attachments?.length ? { attachments: input.attachments } : {}),
      }),
    });
    if (!res.ok) {
      console.warn(`[mail] send failed (${res.status}): ${await res.text()}`);
      return { sent: false };
    }
    const data = (await res.json()) as { id?: string };
    // Log the ORIGINAL subject (the redirect-mode prefix embeds the recipient)
    // and a masked address, so logs never carry a recipient's full email.
    console.log(`[mail] sent "${input.subject}" → ${maskEmail(to)} (id: ${data.id ?? '?'})`);
    return { sent: true };
  } catch (err) {
    console.warn(`[mail] send error: ${(err as Error).message}`);
    return { sent: false };
  }
}

/**
 * Палитра писем = палитра приложения («тёплый графит», src/styles/global.css).
 * Держим здесь именованными константами, а не россыпью hex по разметке: письмо
 * уже один раз отстало от редизайна интерфейса на целую тему (фиолетовый
 * градиент против графита) — человек получал письмо от как будто другого
 * продукта. Меняются токены темы — правится этот блок, и всё.
 */
const M = {
  bg: '#fafaf9', // --bg
  card: '#ffffff', // --panel
  plate: '#f5f4f2', // --panel-2
  line: '#e8e6e3', // --border
  ink: '#232120', // --text
  body: '#3a3734', // между --text и --dim: длинный абзац мягче заголовка
  dim: '#6f6b65', // --dim
  mut: '#a3a09a', // --mut
  onInk: '#fbfaf9', // --on-accent
  // Тёмная тема — те же токены из .dark
  dBg: '#0b0b0a',
  dCard: '#121110',
  dPlate: '#1a1918',
  dLine: '#282623',
  dInk: '#f8f7f5',
  dBody: '#cbc7c1',
  dDim: '#9c9892',
  dMut: '#6e6a64',
  dOnInk: '#161514',
} as const;

/** Стек шрифтов: сначала шрифт интерфейса, дальше — системные. Веб-шрифты в
 *  письма не подключаем: Gmail вырезает @font-face, и подключение даёт только
 *  вес и риск «прыжка» вёрстки. */
const MAIL_FONT = `'Inter','Instrument Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif`;

/**
 * Оболочка транзакционного письма в фирменном виде Lexab.
 *
 * ПОЧЕМУ ИМЕННО ТАК (каждое решение — про то, что письмо читают в почте, а не
 * в браузере; проверено на живой отправке в Gmail):
 *  - таблицы, а не div'ы с max-width: Outlook (движок Word) max-width не знает
 *    и растянул бы карточку во всю ширину окна;
 *  - у кнопки ПЛОСКАЯ заливка и цвет продублирован атрибутом bgcolor: градиент
 *    background-image Outlook выбрасывает — оставалась белая надпись на белом,
 *    то есть невидимая кнопка в письме про подтверждение почты;
 *  - <head> с charset=utf-8: без него часть клиентов читает кириллицу как
 *    «Ð—Ð´Ñ€Ð°Ð²ÑÑ‚Ð²ÑƒÐ¹Ñ‚Ðµ»;
 *  - логотип нарисован рамками, а не <svg> и не картинкой: Gmail вырезает SVG,
 *    а внешняя картинка до подключения домена дала бы «сломанный файл» и режет
 *    репутацию отправителя;
 *  - тёмная тема задана явно через prefers-color-scheme: иначе Gmail и Apple
 *    Mail инвертируют письмо сами и получается грязно-серый текст на сером.
 */
export function mailLayout(title: string, bodyHtml: string, ctaLabel?: string, ctaUrl?: string): string {
  const button =
    ctaLabel && ctaUrl
      ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:26px 0 0;"><tr>
           <td class="lx-btn" align="center" bgcolor="${M.ink}" style="border-radius:10px;background:${M.ink};">
             <a href="${ctaUrl}" style="display:inline-block;padding:13px 26px;font-family:${MAIL_FONT};font-size:15px;font-weight:600;line-height:1.2;color:${M.onInk};text-decoration:none;border-radius:10px;">${ctaLabel}</a>
           </td>
         </tr></table>
         <p class="lx-dim" style="font-size:12px;line-height:1.6;color:${M.dim};margin:14px 0 0;">Не открывается кнопка — скопируйте ссылку / If the button does not work, copy this link:<br/><a class="lx-link" href="${ctaUrl}" style="color:${M.dim};text-decoration:underline;word-break:break-all;">${ctaUrl}</a></p>`
      : '';
  return `<!doctype html>
<html lang="ru" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<meta name="x-apple-disable-message-reformatting"/>
<meta name="color-scheme" content="light dark"/>
<meta name="supported-color-schemes" content="light dark"/>
<title>${title} — Lexab</title>
<!--[if mso]><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml><![endif]-->
<style>
  /* Абзацы и списки тела письма приходят из вызывающего кода без стилей. */
  .lx-body p { margin: 0 0 12px; }
  .lx-body p:last-child { margin-bottom: 0; }
  .lx-body ul, .lx-body ol { margin: 0 0 12px; padding-left: 20px; }
  .lx-body li { margin: 0 0 6px; }
  .lx-body strong { color: ${M.ink}; font-weight: 600; }
  .lx-body a { color: ${M.ink}; }
  @media (max-width: 600px) {
    .lx-card { padding: 26px 22px !important; }
    .lx-pad { padding: 26px 12px 34px !important; }
    .lx-h1 { font-size: 20px !important; }
  }
  @media (prefers-color-scheme: dark) {
    .lx-bg { background: ${M.dBg} !important; }
    .lx-card { background: ${M.dCard} !important; border-color: ${M.dLine} !important; }
    .lx-plate { background: ${M.dPlate} !important; border-color: ${M.dLine} !important; }
    .lx-glyph { border-color: ${M.dInk} !important; }
    .lx-ink, .lx-h1 { color: ${M.dInk} !important; }
    .lx-body { color: ${M.dBody} !important; }
    .lx-body strong, .lx-body a { color: ${M.dInk} !important; }
    .lx-dim { color: ${M.dDim} !important; }
    .lx-mut { color: ${M.dMut} !important; }
    .lx-rule { border-color: ${M.dLine} !important; }
    .lx-btn { background: ${M.dInk} !important; }
    .lx-btn a { color: ${M.dOnInk} !important; }
    .lx-link { color: ${M.dDim} !important; }
  }
</style>
</head>
<body class="lx-bg" style="margin:0;padding:0;width:100%;background:${M.bg};-webkit-font-smoothing:antialiased;">
  <!-- Строка предпросмотра в списке писем. Хвост из невидимых символов не даёт
       Gmail дотянуть в неё начало тела письма («Здравствуйте, Имя!»). -->
  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:${M.bg};opacity:0;">${title}&#8203;&#847;&#847;&#847;&#847;&#847;&#847;&#847;&#847;&#847;&#847;&#847;&#847;&#847;&#847;&#847;&#847;&#847;&#847;&#847;&#847;&#847;&#847;&#847;&#847;&#847;&#847;&#847;&#847;&#847;&#847;</div>

  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" class="lx-bg" style="background:${M.bg};">
    <tr>
      <td class="lx-pad" align="center" style="padding:36px 16px 44px;font-family:${MAIL_FONT};">
        <!--[if mso]><table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="560" style="width:100%;max-width:560px;">

          <!-- Знак и название -->
          <tr><td style="padding:0 2px 20px;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
              <td class="lx-plate" width="40" align="center" valign="middle" bgcolor="${M.plate}" style="width:40px;height:40px;background:${M.plate};border:1px solid ${M.line};border-radius:11px;">
                <!-- Знак Lexab: «L» из двух рамок. Векторную графику Gmail не
                     показывает, поэтому глиф собран средствами вёрстки. -->
                <div class="lx-glyph" style="width:9px;height:13px;margin:0 auto;border-left:3px solid ${M.ink};border-bottom:3px solid ${M.ink};font-size:0;line-height:0;mso-line-height-rule:exactly;">&#8203;</div>
              </td>
              <td style="padding-left:12px;" valign="middle">
                <div class="lx-ink" style="font-size:17px;font-weight:700;letter-spacing:-0.01em;color:${M.ink};line-height:1.15;">Lexab</div>
                <div class="lx-mut" style="font-size:11px;color:${M.mut};letter-spacing:0.05em;line-height:1.4;text-transform:uppercase;">AI contract intelligence</div>
              </td>
            </tr></table>
          </td></tr>

          <!-- Карточка письма -->
          <tr><td class="lx-card" bgcolor="${M.card}" style="background:${M.card};border:1px solid ${M.line};border-radius:16px;padding:32px 34px;">
            <h1 class="lx-h1" style="margin:0 0 14px;font-family:${MAIL_FONT};font-size:22px;font-weight:700;letter-spacing:-0.015em;line-height:1.3;color:${M.ink};">${title}</h1>
            <div class="lx-body" style="font-family:${MAIL_FONT};font-size:15px;line-height:1.65;color:${M.body};">${bodyHtml}</div>
            ${button}
          </td></tr>

          <!-- Подвал -->
          <tr><td style="padding:26px 8px 0;font-size:0;line-height:0;mso-line-height-rule:exactly;">
            <div class="lx-rule" style="border-top:1px solid ${M.line};font-size:0;line-height:0;">&#8203;</div>
          </td></tr>
          <tr><td align="center" style="padding:16px 8px 0;font-family:${MAIL_FONT};">
            <p class="lx-dim" style="margin:0 0 6px;font-size:12px;line-height:1.6;color:${M.dim};">Lexab — интеллектуальный анализ договоров · AI contract intelligence</p>
            <p class="lx-mut" style="margin:0;font-size:12px;line-height:1.7;color:${M.mut};">
              <a class="lx-link" href="${config.appBaseUrl}/terms" style="color:${M.dim};text-decoration:none;">Условия / Terms</a>&nbsp; ·&nbsp; <a class="lx-link" href="${config.appBaseUrl}/privacy" style="color:${M.dim};text-decoration:none;">Конфиденциальность / Privacy</a><br/>
              © ${new Date().getFullYear()} Lexab
            </p>
          </td></tr>

        </table>
        <!--[if mso]></td></tr></table><![endif]-->
      </td>
    </tr>
  </table>
</body>
</html>`;
}
