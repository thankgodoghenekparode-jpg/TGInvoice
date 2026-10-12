import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { prisma } from '../prisma.js';
import { errors, asyncHandler } from '../utils/errors.js';
import { ok, created } from '../utils/query.js';
import config from '../config.js';
import { logAudit } from '../services/auditService.js';
import { notifyTenantAdmins } from '../services/notificationService.js';
import { sendMail } from '../services/emailService.js';
import { signAccessToken, issueRefreshToken, setRefreshCookie } from '../services/tokenService.js';

const INVITE_TTL_DAYS = 7;
const hash = (t) => crypto.createHash('sha256').update(t).digest('hex');
const newToken = () => crypto.randomBytes(32).toString('base64url'); // unpredictable, 256-bit

/* ── GET /api/team — members + pending invitations ────────────────── */

export const listTeam = asyncHandler(async (req, res) => {
  const [memberships, invitations] = await Promise.all([
    prisma.membership.findMany({
      where: { tenantId: req.tenant.id },
      include: { user: { select: { id: true, name: true, email: true, avatar: true, emailVerified: true } } },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.invitation.findMany({
      where: { tenantId: req.tenant.id, status: 'PENDING', expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
      select: { id: true, email: true, role: true, expiresAt: true, createdAt: true },
    }),
  ]);

  ok(res, {
    members: memberships.map((m) => ({
      id: m.id,
      role: m.role,
      status: m.status,
      joinedAt: m.createdAt,
      accessExpiresAt: m.accessExpiresAt,
      suspendedAt: m.suspendedAt,
      user: m.user,
      isSelf: m.userId === req.user.id,
    })),
    invitations: invitations.map((i) => ({ ...i, id: i.id })),
  });
});

/* ── POST /api/team/invite (OWNER/ADMIN) ──────────────────────────── */

export const inviteMember = asyncHandler(async (req, res) => {
  if (!['OWNER', 'ADMIN'].includes(req.role)) throw errors.forbidden('Only owners and admins can invite team members.');

  const email = String(req.body?.email || '').trim().toLowerCase();
  const role = req.body?.role || 'STAFF';
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw errors.badRequest('Enter a valid email address.');
  if (!['ADMIN', 'STAFF'].includes(role)) throw errors.badRequest('Invited members can have the ADMIN or STAFF role.');

  const existingMember = await prisma.membership.findFirst({
    where: { tenantId: req.tenant.id, user: { email } },
  });
  if (existingMember) throw errors.conflict('That person is already a member of this business.');

  const token = newToken();
  const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000);

  await prisma.invitation.create({
    data: {
      tenantId: req.tenant.id,
      email,
      role,
      token: hash(token),
      invitedById: req.user.id,
      expiresAt,
    },
  });

  const link = `${config.frontendUrl}/accept-invitation?token=${token}`;
  const result = await sendMail({
    to: email,
    subject: `You have been invited to join ${req.tenant.name} on TG Invoice`,
    text: `${req.user.name} invited you to join ${req.tenant.name} on TG Invoice as ${role}.\n\nAccept (valid ${INVITE_TTL_DAYS} days): ${link}`,
    html: inviteHtml(req.user.name, req.tenant.name, role, link, INVITE_TTL_DAYS),
  });

  await logAudit({ tenantId: req.tenant.id, userId: req.user.id }, 'INVITE_USER', 'invitation', {
    entityLabel: email,
    description: `${req.user.name} invited ${email} as ${role}`,
  });

  // SMTP not configured → the invitation still exists; surface the link so
  // the flow remains usable in development.
  if (!result.sent) {
    return created(res, {
      invitation: { email, role, expiresAt },
      message: 'Email service is not configured. Share this invitation link manually:',
      inviteLink: link,
    });
  }

  created(res, { invitation: { email, role, expiresAt }, message: 'Invitation sent.' });
});

/* ── PUT /api/team/:id — change role / deactivate ─────────────────── */

export const updateMember = asyncHandler(async (req, res) => {
  const membership = await prisma.membership.findFirst({
    where: { id: req.params.id, tenantId: req.tenant.id }, // tenant-scoped
    include: { user: { select: { id: true, name: true, email: true } } },
  });
  if (!membership) throw errors.notFound('Team member not found.');

  assertCanManage(req, membership);

  const { role, status } = req.body || {};
  const data = {};
  if (role) {
    if (!['ADMIN', 'STAFF'].includes(role)) throw errors.badRequest('Role must be ADMIN or STAFF.');
    if (membership.role === 'OWNER') throw errors.forbidden("The owner's role cannot be changed.");
    data.role = role;
  }
  if (status) {
    if (!['ACTIVE', 'INACTIVE', 'SUSPENDED'].includes(status)) throw errors.badRequest('Invalid status.');
    if (membership.role === 'OWNER') throw errors.forbidden("The owner's membership cannot be deactivated.");
    data.status = status;
  }

  const updated = await prisma.membership.update({
    where: { id: membership.id },
    data,
    include: { user: { select: { id: true, name: true, email: true, avatar: true } } },
  });

  await logAudit({ tenantId: req.tenant.id, userId: req.user.id }, 'UPDATE_MEMBER', 'membership', {
    entityId: updated.id,
    entityLabel: updated.user.email,
    description: `${req.user.name} updated ${updated.user.name}'s role/status${data.role ? ` to ${data.role}` : ''}${data.status ? ` to ${data.status}` : ''}`,
  });

  ok(res, { id: updated.id, role: updated.role, status: updated.status, user: updated.user, accessExpiresAt: updated.accessExpiresAt, suspendedAt: updated.suspendedAt });
});

export const setMemberExpiry = asyncHandler(async (req, res) => {
  const membership = await prisma.membership.findFirst({
    where: { id: req.params.id, tenantId: req.tenant.id },
    include: { user: { select: { id: true, name: true, email: true } } },
  });
  if (!membership) throw errors.notFound('Team member not found.');
  assertCanManage(req, membership);

  const { accessExpiresAt } = req.body || {};
  const now = new Date();
  const expiry = accessExpiresAt ? new Date(accessExpiresAt) : null;
  const update = { accessExpiresAt: expiry };
  if (expiry && expiry.getTime() < now.getTime()) {
    update.status = 'SUSPENDED';
    update.suspendedAt = now;
  } else if (!expiry) {
    update.status = 'ACTIVE';
    update.suspendedAt = null;
  }
  const updated = await prisma.membership.update({
    where: { id: membership.id },
    data: update,
    include: { user: { select: { id: true, name: true, email: true, avatar: true } } },
  });

  await logAudit({ tenantId: req.tenant.id, userId: req.user.id }, 'UPDATE_MEMBER_EXPIRY', 'membership', {
    entityId: updated.id,
    entityLabel: updated.user.email,
    description: `${req.user.name} set access expiry for ${updated.user.name} to ${expiry ? expiry.toISOString() : 'never'}`,
  });

  ok(res, { id: updated.id, role: updated.role, status: updated.status, user: updated.user, accessExpiresAt: updated.accessExpiresAt, suspendedAt: updated.suspendedAt });
});

/* ── DELETE /api/team/:id — remove member ─────────────────────────── */

export const removeMember = asyncHandler(async (req, res) => {
  const membership = await prisma.membership.findFirst({
    where: { id: req.params.id, tenantId: req.tenant.id },
    include: { user: { select: { id: true, name: true, email: true } } },
  });
  if (!membership) throw errors.notFound('Team member not found.');

  assertCanManage(req, membership);

  if (membership.role === 'OWNER') throw errors.forbidden("The owner cannot be removed.");

  await prisma.membership.delete({ where: { id: membership.id } });

  await logAudit({ tenantId: req.tenant.id, userId: req.user.id }, 'REMOVE_USER', 'membership', {
    entityId: membership.id,
    entityLabel: membership.user.email,
    description: `${req.user.name} removed ${membership.user.name} from the team`,
  });

  ok(res, { message: 'Team member removed.' });
});

function assertCanManage(req, membership) {
  if (membership.userId === req.user.id) throw errors.badRequest('You cannot change your own membership.');
  if (membership.role === 'OWNER') throw errors.forbidden('The owner cannot be managed by other members.');
  if (req.role === 'ADMIN' && membership.role !== 'STAFF') {
    throw errors.forbidden('Admins can only manage staff members.');
  }
  if (!['OWNER', 'ADMIN'].includes(req.role)) throw errors.forbidden('Only owners and admins can manage the team.');
}

/* ── Public invitation lookup (no auth — token is the credential) ─── */

export const getInvitation = asyncHandler(async (req, res) => {
  const invitation = await prisma.invitation.findUnique({
    where: { token: hash(req.params.token) },
    include: { tenant: { select: { name: true, logo: true } }, invitedBy: { select: { name: true } } },
  });

  if (!invitation || invitation.status !== 'PENDING' || invitation.expiresAt.getTime() < Date.now()) {
    throw errors.notFound('This invitation is invalid or has expired.');
  }

  const existingUser = await prisma.user.findUnique({ where: { email: invitation.email }, select: { id: true } });

  ok(res, {
    email: invitation.email,
    role: invitation.role,
    businessName: invitation.tenant.name,
    invitedBy: invitation.invitedBy?.name || 'A teammate',
    expiresAt: invitation.expiresAt,
    requiresAccount: !existingUser,
    accountExists: !!existingUser,
  });
});

/* ── POST /api/team/accept-invitation ─────────────────────────────── */

export const acceptInvitation = asyncHandler(async (req, res) => {
  const { token, name, password } = req.body || {};
  if (!token) throw errors.badRequest('Invitation token is required.');

  const invitation = await prisma.invitation.findUnique({
    where: { token: hash(token) },
    include: { tenant: { select: { id: true, name: true, slug: true, logo: true } } },
  });
  if (!invitation || invitation.status !== 'PENDING' || invitation.expiresAt.getTime() < Date.now()) {
    throw errors.notFound('This invitation is invalid or has expired.');
  }

  let user = await prisma.user.findUnique({ where: { email: invitation.email } });

  if (user) {
    // Existing account — the signed-in user must BE the invitee.
    if (!req.user || req.user.id !== user.id) {
      return ok(res, {
        requiresLogin: true,
        email: invitation.email,
        message: `Sign in as ${invitation.email} to accept this invitation.`,
      });
    }
  } else {
    // New account — create it from the invitation.
    if (!password || String(password).length < 8) {
      throw errors.badRequest('Set a password of at least 8 characters to create your account.', [
        { path: 'password', message: 'Password must be at least 8 characters.' },
      ]);
    }
    if (!name || String(name).trim().length < 2) {
      throw errors.badRequest('Enter your full name.', [{ path: 'name', message: 'Name is required.' }]);
    }
    user = await prisma.user.create({
      data: {
        name: String(name).trim(),
        email: invitation.email,
        passwordHash: await bcrypt.hash(password, 12),
        emailVerified: true, // invited directly by a business owner
      },
    });
  }

  const membership = await prisma.$transaction(async (tx) => {
    const existing = await tx.membership.findUnique({
      where: { userId_tenantId: { userId: user.id, tenantId: invitation.tenantId } },
    });
    const m =
      existing ??
      (await tx.membership.create({
        data: { userId: user.id, tenantId: invitation.tenantId, role: invitation.role, status: 'ACTIVE' },
      }));
    await tx.invitation.update({ where: { id: invitation.id }, data: { status: 'ACCEPTED' } });
    return m;
  });

  await logAudit({ tenantId: invitation.tenantId, userId: user.id }, 'ACCEPT_INVITE', 'membership', {
    entityId: membership.id,
    entityLabel: invitation.email,
    description: `${user.name} joined ${invitation.tenant.name} as ${membership.role}`,
  });

  await notifyTenantAdmins({
    tenantId: invitation.tenantId,
    excludeUserId: user.id,
    type: 'TEAM_MEMBER_JOINED',
    title: `${user.name} joined ${invitation.tenant.name}`,
    body: `${user.email} accepted the invitation and joined as ${membership.role === 'STAFF' ? 'staff' : membership.role.toLowerCase()}.`,
    link: '/team',
  });

  // Sign the new member in immediately.
  const access = signAccessToken(user.id);
  const refresh = await issueRefreshToken({ userId: user.id, tenantId: invitation.tenantId, userAgent: req.headers['user-agent'], ip: req.ip });
  setRefreshCookie(res, refresh.token, refresh.expiresAt);

  return ok(res, {
    user: { id: user.id, name: user.name, email: user.email },
    accessToken: access,
    tenants: [{ ...invitation.tenant, role: membership.role }],
    activeTenant: invitation.tenant,
  });
});

function inviteHtml(inviter, business, role, link, days) {
  return `
  <div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:0 auto;color:#0f172a">
    <p style="font-size:13px;color:#64748b;margin:0 0 4px"><b style="color:#2563eb">tgeasy</b> · TG Invoice</p>
    <h2 style="margin:8px 0 12px;font-size:18px">Join ${business} on TG Invoice</h2>
    <p>Hi,</p>
    <p><b>${inviter}</b> invited you to join <b>${business}</b> as <b>${role}</b>.</p>
    <p style="margin:22px 0"><a href="${link}" style="background:#2563eb;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none">Accept invitation</a></p>
    <p style="color:#64748b;font-size:12px">This link expires in ${days} days.</p>
  </div>`;
}
