import { prisma } from '../prisma.js';
import { errors, asyncHandler } from '../utils/errors.js';
import { ok } from '../utils/query.js';

/**
 * In-app notifications for the signed-in user.
 *
 * Tenant-free by design: a notification belongs to a USER, not a business
 * (platform operators have no tenant). Every query is scoped to req.user.id,
 * so a notification id can never be read or mutated across accounts.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SELECT = {
  id: true,
  type: true,
  title: true,
  body: true,
  link: true,
  readAt: true,
  createdAt: true,
  tenant: { select: { id: true, name: true } },
};

const pageMeta = (total, page, limit, unread) => ({
  total,
  page,
  limit,
  totalPages: Math.max(1, Math.ceil(total / limit)),
  hasNext: page * limit < total,
  hasPrev: page > 1,
  unread,
});

/* ── GET /api/notifications ───────────────────────────────────────── */

export const list = asyncHandler(async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  let limit = parseInt(req.query.limit, 10) || 15;
  if (limit < 1) limit = 1;
  if (limit > 50) limit = 50;

  const where = { userId: req.user.id };
  const [rows, total, unread] = await Promise.all([
    prisma.notification.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
      select: SELECT,
    }),
    prisma.notification.count({ where }),
    prisma.notification.count({ where: { userId: req.user.id, readAt: null } }),
  ]);

  return ok(res, rows, pageMeta(total, page, limit, unread));
});

/* ── GET /api/notifications/unread-count ──────────────────────────── */

export const unreadCount = asyncHandler(async (req, res) => {
  const unread = await prisma.notification.count({ where: { userId: req.user.id, readAt: null } });
  return ok(res, { unread });
});

/* ── POST /api/notifications/:id/read ─────────────────────────────── */

export const markRead = asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!UUID_RE.test(id)) throw errors.badRequest('Invalid notification id.');

  await prisma.notification.updateMany({
    where: { id, userId: req.user.id, readAt: null },
    data: { readAt: new Date() },
  });

  const unread = await prisma.notification.count({ where: { userId: req.user.id, readAt: null } });
  return ok(res, { unread });
});

/* ── POST /api/notifications/read-all ─────────────────────────────── */

export const markAllRead = asyncHandler(async (req, res) => {
  const result = await prisma.notification.updateMany({
    where: { userId: req.user.id, readAt: null },
    data: { readAt: new Date() },
  });
  return ok(res, { updated: result.count, unread: 0 });
});

export default { list, unreadCount, markRead, markAllRead };
