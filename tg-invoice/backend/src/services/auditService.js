import { prisma } from '../prisma.js';

/**
 * Tenant-scoped audit trail.
 * Every meaningful financial operation calls logAudit — records are only
 * visible to users of the same tenant.
 *
 * @param {object} ctx  { tenantId, userId }
 * @param {string} action CREATE_INVOICE | RECORD_PAYMENT | …
 * @param {string} entity invoice | customer | …
 * @param {object} opts   { entityId, entityLabel, description, metadata }
 */
export async function logAudit(ctx, action, entity, opts = {}) {
  try {
    await prisma.auditLog.create({
      data: {
        tenantId: ctx.tenantId,
        userId: ctx.userId ?? null,
        action,
        entity,
        entityId: opts.entityId ?? null,
        entityLabel: opts.entityLabel ?? null,
        description: opts.description ?? null,
        metadata: opts.metadata ?? undefined,
      },
    });
  } catch (err) {
    // Auditing must never break the primary operation.
    console.error('[audit-log-failed]', action, err?.message);
  }
}

export const auditFromReq = (req) => ({ tenantId: req.tenant.id, userId: req.user.id });

export default logAudit;
