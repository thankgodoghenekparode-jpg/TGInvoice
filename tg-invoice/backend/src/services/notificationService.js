import { prisma } from '../prisma.js';
import { sendMail, isEmailConfigured } from './emailService.js';
import config from '../config.js';

/**
 * Notification service — server-persisted, per-user notices surfaced by the
 * in-app bell (unread badge + dropdown). Delivering a notification must NEVER
 * break the operation that triggered it, so every failure is swallowed and
 * logged, mirroring the audit service.
 *
 * `email` (optional) sends a branded email to the same recipients. SMTP is
 * fire-and-forget: the request returns as soon as the rows are written.
 */

const MAX_TITLE = 160;
const MAX_BODY = 600;

const clip = (value, max) => {
  if (value == null) return null;
  const s = String(value).trim();
  if (!s) return null;
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
};

/** A small, inline-styled email body shared by every notification email. */
function emailHtml(title, body, link) {
  const url = link ? `${config.frontendUrl}${link}` : config.frontendUrl;
  return `
  <div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:0 auto;color:#0f172a">
    <p style="font-size:13px;color:#64748b;margin:0 0 4px"><b style="color:#2563eb">tgeasy</b> · TG Invoice</p>
    <h2 style="margin:8px 0 12px;font-size:18px">${title}</h2>
    ${body ? `<p style="font-size:14px;line-height:1.6;color:#334155;margin:0 0 20px">${body}</p>` : ''}
    <p style="margin:0 0 24px">
      <a href="${url}" style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;font-size:14px;font-weight:600;padding:10px 20px;border-radius:8px">Open TG Invoice</a>
    </p>
    <p style="font-size:12px;color:#94a3b8;margin:0">If the button does not work, copy this link:<br/>${url}</p>
  </div>`;
}

/**
 * Create an in-app notification for one or more users.
 *
 * @param {object} opts
 * @param {string[]} opts.userIds   recipients (deduped, falsy dropped)
 * @param {string}   [opts.tenantId] related business (null = platform-level)
 * @param {string}   opts.type       event key, e.g. TENANT_SUSPENDED
 * @param {string}   opts.title      short headline
 * @param {string}   [opts.body]     one-line explanation
 * @param {string}   [opts.link]     in-app route to open when clicked
 * @param {{subject:string, text?:string}} [opts.email] also email the recipients
 * @returns {Promise<{ created: number }>}
 */
export async function notifyMany({ userIds, tenantId = null, type, title, body = null, link = null, email = null }) {
  const ids = [...new Set((userIds || []).filter(Boolean))];
  if (!ids.length) return { created: 0 };

  try {
    await prisma.notification.createMany({
      data: ids.map((userId) => ({
        userId,
        tenantId,
        type,
        title: clip(title, MAX_TITLE) || type,
        body: clip(body, MAX_BODY),
        link,
      })),
    });
  } catch (err) {
    console.error('[notify-failed]', type, err?.message);
    return { created: 0 };
  }

  if (email?.subject && isEmailConfigured()) {
    // Fire-and-forget — the triggering request must not wait on SMTP.
    (async () => {
      try {
        const users = await prisma.user.findMany({
          where: { id: { in: ids } },
          select: { email: true, name: true },
        });
        const html = emailHtml(email.subject, email.text || body, link);
        await Promise.all(
          users.map((u) => sendMail({ to: u.email, subject: email.subject, text: email.text || body || email.subject, html }))
        );
      } catch (err) {
        console.error('[notify-email-failed]', type, err?.message);
      }
    })();
  }

  return { created: ids.length };
}

/** Notify a single user. */
export function notifyUser(userId, payload) {
  return notifyMany({ userIds: [userId], ...payload });
}

/** The tenant admins (OWNER + ADMIN) of a business — the platform owner's concern. */
export async function tenantAdminIds(tenantId) {
  const rows = await prisma.membership.findMany({
    where: { tenantId, role: { in: ['OWNER', 'ADMIN'] }, status: 'ACTIVE' },
    select: { userId: true },
  });
  return rows.map((r) => r.userId);
}

/** Notify every tenant admin of a business, optionally excluding one (the actor). */
export async function notifyTenantAdmins({ tenantId, excludeUserId = null, ...payload }) {
  const ids = (await tenantAdminIds(tenantId)).filter((id) => id !== excludeUserId);
  return notifyMany({ userIds: ids, tenantId, ...payload });
}

export default { notifyMany, notifyUser, tenantAdminIds, notifyTenantAdmins };
