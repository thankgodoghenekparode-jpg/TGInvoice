import nodemailer from 'nodemailer';
import config from '../config.js';

/**
 * Email service (SMTP).
 *
 * If SMTP is not configured the app must NOT crash — every send resolves to
 * { sent: false, reason: 'not_configured' } and callers surface the friendly
 * message: "Email service is not configured."
 */

let transporter = null;

export function isEmailConfigured() {
  return Boolean(config.smtp.host && config.smtp.fromEmail);
}

function getTransporter() {
  if (transporter) return transporter;
  if (!isEmailConfigured()) return null;

  transporter = nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.port === 465,
    auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.password } : undefined,
  });
  return transporter;
}

/**
 * @param {{ to: string, subject: string, text?: string, html?: string,
 *           attachments?: Array<{ filename: string, content: Buffer }> }} mail
 * @returns {Promise<{ sent: boolean, reason?: string, messageId?: string }>}
 */
export async function sendMail(mail) {
  const tx = getTransporter();
  if (!tx) {
    return { sent: false, reason: 'not_configured' };
  }

  try {
    const info = await tx.sendMail({
      from: `"${config.smtp.fromName}" <${config.smtp.fromEmail}>`,
      to: mail.to,
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
      attachments: mail.attachments,
    });
    return { sent: true, messageId: info.messageId };
  } catch (err) {
    console.error('[email-failed]', err?.message);
    return { sent: false, reason: 'send_failed' };
  }
}

export default { sendMail, isEmailConfigured };
