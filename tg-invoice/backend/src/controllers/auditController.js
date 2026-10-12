import { prisma } from '../prisma.js';
import { errors, asyncHandler } from '../utils/errors.js';
import { ok, parseListQuery } from '../utils/query.js';

const SORTABLE = ['createdAt', 'action', 'entity'];

/** GET /api/audit-logs — OWNER/ADMIN, tenant-scoped only. */
export const listAuditLogs = asyncHandler(async (req, res) => {
  if (!['OWNER', 'ADMIN'].includes(req.role)) {
    throw errors.forbidden('Only owners and admins can view audit logs.');
  }

  const { page, limit, orderBy } = parseListQuery(req.query, { sortAllowlist: SORTABLE, defaultSort: '-createdAt' });

  const where = {
    tenantId: req.tenant.id, // audit logs are never shared across tenants
    ...(req.query.action ? { action: { contains: req.query.action, mode: 'insensitive' } } : {}),
    ...(req.query.entity ? { entity: req.query.entity } : {}),
    ...(req.query.userId ? { userId: req.query.userId } : {}),
    ...(req.query.from || req.query.to
      ? {
          createdAt: {
            ...(req.query.from ? { gte: new Date(req.query.from) } : {}),
            ...(req.query.to ? { lte: new Date(new Date(req.query.to).setHours(23, 59, 59, 999)) } : {}),
          },
        }
      : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy,
      skip: (page - 1) * limit,
      take: limit,
      include: { user: { select: { id: true, name: true, email: true } } },
    }),
    prisma.auditLog.count({ where }),
  ]);

  ok(res, rows, { total, page, limit, totalPages: Math.max(1, Math.ceil(total / limit)) });
});
