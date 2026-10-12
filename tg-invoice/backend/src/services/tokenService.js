import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import { prisma } from '../prisma.js';
import config from '../config.js';
import { errors } from '../utils/errors.js';

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const randomToken = () => crypto.randomBytes(48).toString('hex');

/* ── Access token (short-lived, stateless) ─────────────────────────── */

export function signAccessToken(userId) {
  return jwt.sign({ sub: userId }, config.jwt.accessSecret, {
    expiresIn: config.jwt.accessExpires,
  });
}

export function verifyAccessToken(token) {
  try {
    const payload = jwt.verify(token, config.jwt.accessSecret);
    return payload.sub;
  } catch {
    throw errors.unauthorized('Invalid or expired session. Please sign in again.');
  }
}

/* ── Refresh token (opaque, rotated, stored hashed) ────────────────── */

export async function issueRefreshToken({ userId, tenantId, userAgent, ip }) {
  const token = randomToken();
  const expiresAt = new Date(Date.now() + config.jwt.refreshExpiresDays * 24 * 60 * 60 * 1000);

  await prisma.refreshToken.create({
    data: {
      userId,
      tenantId: tenantId ?? null,
      tokenHash: sha256(token),
      expiresAt,
      userAgent: userAgent?.slice(0, 255) ?? null,
      ip: ip ?? null,
    },
  });

  return { token, expiresAt };
}

/**
 * Validate a refresh token, then rotate it (one refresh token = one use).
 * Returns the fresh token pair plus the user's last active tenant.
 */
export async function rotateRefreshToken(token, context = {}) {
  if (!token) throw errors.unauthorized('No active session.');

  const tokenHash = sha256(token);
  const record = await prisma.refreshToken.findUnique({
    where: { tokenHash },
    include: { user: { select: { id: true, name: true, email: true } } },
  });

  if (!record || record.revokedAt || record.expiresAt.getTime() < Date.now()) {
    throw errors.unauthorized('Session expired. Please sign in again.');
  }

  // Revoke the used token (rotation — replay of a stolen token is detectable
  // because the row is already revoked).
  await prisma.refreshToken.update({
    where: { id: record.id },
    data: { revokedAt: new Date() },
  });

  const pair = await issueRefreshToken({
    userId: record.userId,
    tenantId: context.tenantId ?? record.tenantId,
    userAgent: context.userAgent,
    ip: context.ip,
  });

  return { ...pair, userId: record.userId, user: record.user, tenantId: record.tenantId };
}

export async function revokeRefreshToken(token) {
  if (!token) return;
  await prisma.refreshToken.updateMany({
    where: { tokenHash: sha256(token), revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export async function revokeAllRefreshTokens(userId) {
  await prisma.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

/* ── Single-use secure tokens (password reset / email verification / invitations) ── */

export async function createSingleUseToken({ model, userId, tenantId, expiresMs }) {
  const token = randomToken();
  await prisma[model].create({
    data: {
      userId,
      tenantId: tenantId ?? null,
      tokenHash: sha256(token),
      expiresAt: new Date(Date.now() + expiresMs),
    },
  });
  return token;
}

export async function consumeSingleUseToken(model, token) {
  if (!token) return null;
  const record = await prisma[model].findUnique({ where: { tokenHash: sha256(token) } });
  if (!record) return null;
  if (record.usedAt) return null; // single-use
  if (record.expiresAt.getTime() < Date.now()) return null;
  await prisma[model].update({ where: { id: record.id }, data: { usedAt: new Date() } });
  return record;
}

/* ── Cookie helpers (refresh token lives in an httpOnly cookie) ────── */

const REFRESH_COOKIE = 'tg_refresh';

export function setRefreshCookie(res, token, expiresAt) {
  res.cookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    secure: config.isProd, // cross-site (Vercel → Render) requires Secure + SameSite=None
    sameSite: config.isProd ? 'none' : 'lax',
    path: '/api/auth',
    expires: expiresAt,
  });
}

export function clearRefreshCookie(res) {
  res.clearCookie(REFRESH_COOKIE, { path: '/api/auth' });
}

export function getRefreshCookie(req) {
  return req.cookies?.[REFRESH_COOKIE];
}
