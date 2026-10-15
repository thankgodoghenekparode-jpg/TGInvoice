import bcrypt from 'bcryptjs';
import { prisma } from '../prisma.js';
import { errors, asyncHandler } from '../utils/errors.js';
import { ok, created } from '../utils/query.js';
import config from '../config.js';
import { logAudit } from '../services/auditService.js';
import { sendMail } from '../services/emailService.js';
import { attributeReferral } from '../services/referralService.js';
import {
  signAccessToken,
  issueRefreshToken,
  rotateRefreshToken,
  revokeRefreshToken,
  revokeAllRefreshTokens,
  setRefreshCookie,
  clearRefreshCookie,
  getRefreshCookie,
  createSingleUseToken,
  consumeSingleUseToken,
} from '../services/tokenService.js';

const BCRYPT_ROUNDS = 12;
const publicUser = (u) => ({
  id: u.id,
  name: u.name,
  email: u.email,
  avatar: u.avatar ?? null,
  emailVerified: !!u.emailVerified,
  isPlatformAdmin: !!u.isPlatformAdmin,
});

async function membershipsFor(userId) {
  return prisma.membership.findMany({
    where: { userId, status: 'ACTIVE', tenant: { status: 'ACTIVE' } },
    include: { tenant: { select: { id: true, name: true, slug: true, logo: true, createdAt: true } } },
    orderBy: { createdAt: 'asc' },
  });
}

export function slugify(text) {
  return String(text)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'business';
}

async function uniqueSlug(base, db = prisma) {
  let slug = base;
  let n = 1;
  while (await db.tenant.findUnique({ where: { slug }, select: { id: true } })) {
    n += 1;
    slug = `${base}-${n}`;
  }
  return slug;
}

/* ── POST /api/auth/register ──────────────────────────────────────── */
/* Step 1 (account) + Step 2 (business) submitted together: creates
   User → Tenant → Membership(OWNER) → CompanySettings → sequences.   */

export const register = asyncHandler(async (req, res) => {
  const body = req.validatedBody;
  if (body.confirmPassword && body.confirmPassword !== body.password) {
    throw errors.badRequest('Passwords do not match.', [{ path: 'confirmPassword', message: 'Passwords do not match.' }]);
  }

  const existing = await prisma.user.findUnique({ where: { email: body.email.toLowerCase() }, select: { id: true } });
  if (existing) throw errors.conflict('An account with this email already exists. Try signing in instead.', [{ path: 'email', message: 'Email already registered.' }]);

  const passwordHash = await bcrypt.hash(body.password, BCRYPT_ROUNDS);
  const currency = body.business.currency || { code: 'NGN', symbol: '₦', position: 'prefix' };

  // Account + business are created atomically: either the whole
  // User → Tenant → Membership(OWNER) → Settings chain exists, or none of it does.
  const { user, tenant } = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: { name: body.name, email: body.email.toLowerCase(), passwordHash, emailVerified: false },
    });

    let tenant;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const slug = await uniqueSlug(slugify(body.business.name), tx);
      try {
        tenant = await tx.tenant.create({ data: { name: body.business.name, slug } });
        break;
      } catch (err) {
        if (err?.code !== 'P2002') throw err; // concurrent slug collision → retry
      }
    }
    if (!tenant) throw errors.conflict('Could not allocate a unique business address. Please use a different business name.');

    await tx.membership.create({ data: { userId: user.id, tenantId: tenant.id, role: 'OWNER', status: 'ACTIVE' } });

    await tx.companySettings.create({
      data: {
        tenantId: tenant.id,
        businessName: body.business.name,
        phone: body.business.phone || null,
        email: body.business.email || body.email,
        country: body.business.country || 'Nigeria',
        currency: currency.code,
        currencySymbol: currency.symbol,
        currencyPosition: currency.position,
        defaultCurrency: currency.code,
        onboardingComplete: false,
      },
    });

    for (const kind of ['CUSTOMER', 'QUOTATION', 'INVOICE', 'RECEIPT']) {
      await tx.documentSequence.create({ data: { tenantId: tenant.id, kind, prefix: kind === 'QUOTATION' ? 'QT' : kind === 'RECEIPT' ? 'REC' : kind === 'CUSTOMER' ? 'CUS' : 'INV', next: 1 } });
    }

    return { user, tenant };
  });

  await logAudit({ tenantId: tenant.id, userId: user.id }, 'CREATE_TENANT', 'tenant', {
    entityLabel: tenant.name,
    description: `${user.name} created business ${tenant.name}`,
  });

  // Referral attribution is best-effort: a bad or used-up code never blocks signup.
  if (body.referralCode) {
    await attributeReferral({ code: body.referralCode, referredTenantId: tenant.id, referredUserId: user.id });
  }

  const memberships = await membershipsFor(user.id);

  const access = signAccessToken(user.id);
  const refresh = await issueRefreshToken({ userId: user.id, tenantId: tenant.id, userAgent: req.headers['user-agent'], ip: req.ip });
  setRefreshCookie(res, refresh.token, refresh.expiresAt);

  created(res, { user: publicUser(user), accessToken: access, tenants: memberships.map((m) => ({ ...m.tenant, role: m.role })), activeTenant: tenant });
});

/* ── POST /api/auth/login ─────────────────────────────────────────── */

export const login = asyncHandler(async (req, res) => {
  const { email, password } = req.validatedBody;

  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  // Constant-time-ish behaviour even when the account does not exist.
  const hash = user?.passwordHash || '$2a$12$C6UzMDM.H6dfI/f/IKcEeO7ZBpQ0G1E5rN0kYaL8pG1Kc1Bq1Yq3m';
  const valid = await bcrypt.compare(password, hash);
  if (!user || !valid) throw errors.unauthorized('Invalid email or password.');
  if (user.status !== 'ACTIVE') {
    throw errors.forbidden('Your account has been suspended. Please contact the platform administrator.');
  }

  const memberships = await membershipsFor(user.id);
  const activeTenant = memberships[0]?.tenant ?? null;

  const access = signAccessToken(user.id);
  const refresh = await issueRefreshToken({ userId: user.id, tenantId: activeTenant?.id ?? null, userAgent: req.headers['user-agent'], ip: req.ip });
  setRefreshCookie(res, refresh.token, refresh.expiresAt);

  ok(res, { user: publicUser(user), accessToken: access, tenants: memberships.map((m) => ({ ...m.tenant, role: m.role })), activeTenant });
});

/* ── POST /api/auth/refresh ───────────────────────────────────────── */

export const refresh = asyncHandler(async (req, res) => {
  const token = getRefreshCookie(req);
  const rotated = await rotateRefreshToken(token, { userAgent: req.headers['user-agent'], ip: req.ip });

  // A suspended account loses every session immediately.
  const user = await prisma.user.findUnique({
    where: { id: rotated.userId },
    select: { id: true, name: true, email: true, avatar: true, emailVerified: true, isPlatformAdmin: true, status: true },
  });
  if (!user || user.status !== 'ACTIVE') {
    await revokeAllRefreshTokens(rotated.userId);
    clearRefreshCookie(res);
    throw errors.forbidden('Your account has been suspended. Please contact the platform administrator.');
  }

  setRefreshCookie(res, rotated.token, rotated.expiresAt);

  const memberships = await membershipsFor(rotated.userId);
  const activeTenant = memberships.find((m) => m.tenantId === rotated.tenantId)?.tenant ?? memberships[0]?.tenant ?? null;

  ok(res, {
    user: publicUser(user),
    accessToken: signAccessToken(rotated.userId),
    tenants: memberships.map((m) => ({ ...m.tenant, role: m.role })),
    activeTenant,
  });
});

/* ── POST /api/auth/logout ────────────────────────────────────────── */

export const logout = asyncHandler(async (req, res) => {
  await revokeRefreshToken(getRefreshCookie(req));
  clearRefreshCookie(res);
  ok(res, { message: 'Signed out.' });
});

/* ── GET /api/auth/me ─────────────────────────────────────────────── */

export const me = asyncHandler(async (req, res) => {
  const memberships = await membershipsFor(req.user.id);
  const headerTenant = req.headers['x-tenant-id'];
  const activeTenant = memberships.find((m) => m.tenantId === headerTenant)?.tenant ?? memberships[0]?.tenant ?? null;
  ok(res, {
    user: publicUser(req.user),
    tenants: memberships.map((m) => ({ ...m.tenant, role: m.role })),
    activeTenant,
  });
});

/* ── Password reset ───────────────────────────────────────────────── */

export const forgotPassword = asyncHandler(async (req, res) => {
  const { email } = req.validatedBody;
  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });

  if (user) {
    const token = await createSingleUseToken({ model: 'passwordResetToken', userId: user.id, expiresMs: 30 * 60 * 1000 });
    const link = `${config.frontendUrl}/reset-password?token=${token}`;
    await sendMail({
      to: user.email,
      subject: 'Reset your TG Invoice password',
      text: `Hello ${user.name},\n\nReset your password using this link (valid for 30 minutes, single use):\n${link}\n\nIf you did not request this, ignore this email.`,
      html: resetEmailHtml(user.name, link),
    });
  }

  // Never reveal whether the account exists.
  ok(res, { message: 'If an account exists for that email, a reset link has been sent.' });
});

export const resetPassword = asyncHandler(async (req, res) => {
  const { token, password, confirmPassword } = req.validatedBody;
  if (confirmPassword && confirmPassword !== password) {
    throw errors.badRequest('Passwords do not match.', [{ path: 'confirmPassword', message: 'Passwords do not match.' }]);
  }

  const record = await consumeSingleUseToken('passwordResetToken', token);
  if (!record) throw errors.badRequest('This reset link is invalid or has expired. Request a new one.');

  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  await prisma.user.update({ where: { id: record.userId }, data: { passwordHash } });
  await revokeAllRefreshTokens(record.userId);

  ok(res, { message: 'Password updated. Please sign in with your new password.' });
});

/* ── Email verification ───────────────────────────────────────────── */

export const verifyEmail = asyncHandler(async (req, res) => {
  const record = await consumeSingleUseToken('emailVerificationToken', req.validatedBody.token);
  if (!record) throw errors.badRequest('This verification link is invalid or has expired.');
  await prisma.user.update({ where: { id: record.userId }, data: { emailVerified: true } });
  ok(res, { message: 'Email verified.' });
});

export const resendVerification = asyncHandler(async (req, res) => {
  const token = await createSingleUseToken({ model: 'emailVerificationToken', userId: req.user.id, expiresMs: 24 * 60 * 60 * 1000 });
  const link = `${config.frontendUrl}/verify-email?token=${token}`;
  await sendMail({
    to: req.user.email,
    subject: 'Verify your TG Invoice email',
    text: `Verify your email: ${link} (valid for 24 hours)`,
    html: `<p>Hi ${req.user.name},</p><p>Verify your email address for TG Invoice:</p><p><a href="${link}">Verify email</a></p><p>Valid for 24 hours.</p>`,
  });
  ok(res, { message: 'Verification email sent.' });
});

/* ── Profile ──────────────────────────────────────────────────────── */

export const updateProfile = asyncHandler(async (req, res) => {
  const { name, email } = req.validatedBody;
  const normalized = email.toLowerCase();

  if (normalized !== req.user.email) {
    const taken = await prisma.user.findUnique({ where: { email: normalized }, select: { id: true } });
    if (taken) throw errors.conflict('That email address is already in use.', [{ path: 'email', message: 'Email already registered.' }]);
  }

  const user = await prisma.user.update({
    where: { id: req.user.id },
    data: {
      name,
      email: normalized,
      // A changed address must be confirmed again before it counts as verified.
      ...(normalized !== req.user.email ? { emailVerified: false } : {}),
    },
  });

  if (req.tenant) {
    await logAudit({ tenantId: req.tenant.id, userId: user.id }, 'UPDATE_PROFILE', 'user', {
      entityId: user.id,
      description: `${user.name} updated their profile`,
    });
  }

  ok(res, { user: publicUser(user) });
});

export const changePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.validatedBody;

  const user = await prisma.user.findUnique({ where: { id: req.user.id } });
  if (!user) throw errors.unauthorized('Sign in again to change your password.');

  const valid = await bcrypt.compare(currentPassword, user.passwordHash || '');
  if (!valid) throw errors.badRequest('Your current password is incorrect.', [
    { path: 'currentPassword', message: 'Current password is incorrect.' },
  ]);

  const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash } });
  // Every other session is signed out after a password change.
  await revokeAllRefreshTokens(user.id);

  if (req.tenant) {
    await logAudit({ tenantId: req.tenant.id, userId: user.id }, 'CHANGE_PASSWORD', 'user', {
      entityId: user.id,
      description: `${user.name} changed their password`,
    });
  }

  ok(res, { message: 'Password changed. Other sessions have been signed out.' });
});

function resetEmailHtml(name, link) {
  return `
  <div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:0 auto;color:#0f172a">
    <p style="font-size:13px;color:#64748b;margin:0 0 4px"><b style="color:#2563eb">tgeasy</b> · TG Invoice</p>
    <h2 style="margin:8px 0 12px;font-size:18px">Reset your password</h2>
    <p>Hi ${name},</p>
    <p>Click the button below to set a new password. This link expires in 30 minutes and can only be used once.</p>
    <p style="margin:22px 0"><a href="${link}" style="background:#2563eb;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none">Reset password</a></p>
    <p style="color:#64748b;font-size:12px">If you didn't request this, you can safely ignore this email.</p>
  </div>`;
}

export default { register, login, refresh, logout, me, updateProfile, changePassword, forgotPassword, resetPassword, verifyEmail, resendVerification };
