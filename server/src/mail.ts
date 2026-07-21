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
    const banner = `<div style="max-width:540px;margin:0 auto 14px;padding:10px 16px;border-radius:12px;background:#fdf6e3;border:1px solid #f0e2b6;font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif;font-size:12px;line-height:1.5;color:#8a6d1a;">
      Тестовый режим (домен ещё не подключён): это письмо предназначалось <strong>${escapeMailHtml(input.to)}</strong>. После подключения домена письма пойдут получателям напрямую.
    </div>`;
    html = html.replace(/<body[^>]*>/, (m) => `${m}\n<div style="padding-top:24px;">${banner}</div>`);
  }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
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
 * Branded transactional-email shell matching the LexAI look: soft lavender
 * background, white rounded card, purple gradient accents. Table-based and
 * inline-styled so Gmail/Outlook/Apple Mail all render it correctly.
 */
export function mailLayout(title: string, bodyHtml: string, ctaLabel?: string, ctaUrl?: string): string {
  const button =
    ctaLabel && ctaUrl
      ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:26px 0 4px;"><tr><td style="border-radius:12px;background:linear-gradient(135deg,#8b7cf6,#6a5ae0);box-shadow:0 6px 16px rgba(107,90,224,0.25);">
           <a href="${ctaUrl}" style="display:inline-block;padding:13px 28px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:12px;">${ctaLabel}</a>
         </td></tr></table>
         <p style="font-size:12px;line-height:1.5;color:#9a9aa6;margin:12px 0 0;word-break:break-all;">Если кнопка не работает, откройте ссылку: <a href="${ctaUrl}" style="color:#8b7cf6;text-decoration:none;">${ctaUrl}</a></p>`
      : '';
  return `<!doctype html>
<html lang="ru">
<body style="margin:0;padding:0;background:#f4f2fb;">
  <span style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:#f4f2fb;opacity:0;">${title} — LexAI</span>
  <div style="padding:36px 16px 44px;font-family:'Instrument Sans',-apple-system,'Segoe UI',Roboto,Arial,sans-serif;">
    <div style="max-width:540px;margin:0 auto;">

      <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto 22px;"><tr>
        <td style="width:42px;height:42px;border-radius:13px;background:linear-gradient(135deg,#8b7cf6,#5f4fd4);text-align:center;vertical-align:middle;font-size:19px;line-height:42px;color:#ffffff;">&#9670;</td>
        <td style="padding-left:11px;">
          <div style="font-size:18px;font-weight:700;letter-spacing:-0.01em;color:#221d35;line-height:1.1;">LexAI</div>
          <div style="font-size:11px;color:#9b95b3;letter-spacing:0.03em;">AI contract intelligence</div>
        </td>
      </tr></table>

      <div style="background:#ffffff;border:1px solid #e9e6f4;border-radius:18px;padding:34px 36px;box-shadow:0 8px 26px rgba(107,90,224,0.06);">
        <h1 style="margin:0 0 14px;font-size:22px;font-weight:700;letter-spacing:-0.01em;line-height:1.3;color:#221d35;">${title}</h1>
        <div style="font-size:15px;line-height:1.6;color:#3a3a46;">${bodyHtml}</div>
        ${button}
      </div>

      <div style="border-top:1px solid #e6e3f2;margin:28px 10px 0;font-size:0;line-height:0;">&nbsp;</div>
      <p style="text-align:center;font-size:12px;line-height:1.8;color:#9b95b3;margin:14px 0 0;">
        LexAI — интеллектуальный анализ контрактов<br/>
        <a href="https://lexai.app/terms" style="color:#8b7cf6;text-decoration:none;">Условия использования</a>&nbsp;&nbsp;·&nbsp;&nbsp;<a href="https://lexai.app/privacy" style="color:#8b7cf6;text-decoration:none;">Конфиденциальность</a><br/>
        © 2026 LexAI
      </p>
    </div>
  </div>
</body>
</html>`;
}
