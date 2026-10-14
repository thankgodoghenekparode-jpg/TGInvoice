import { prisma } from '../prisma.js';
import { cacheWrap, cacheInvalidate } from './cacheService.js';

/**
 * Feature flags with two rollout mechanisms, both evaluated server-side:
 *   - allowlist: `tenantIds` set → only those tenants see the flag;
 *   - percentage: `rollout` 0–100, hashed deterministically on key+tenant so
 *     the same tenant always lands in the same bucket (no flicker).
 *
 * Read by `GET /api/flags`. Cached briefly; busted on every admin write.
 */

const TTL_SECONDS = 30;

function hashPercent(input) {
  let h = 5381;
  for (let i = 0; i < input.length; i += 1) h = ((h * 33) ^ input.charCodeAt(i)) >>> 0;
  return h % 100;
}

async function readAllFlags() {
  return prisma.featureFlag.findMany({
    select: { key: true, description: true, enabled: true, rollout: true, tenantIds: true },
  });
}

function evaluate(flag, tenantId) {
  if (!flag.enabled) return false;
  const allowlist = Array.isArray(flag.tenantIds) ? flag.tenantIds : null;
  if (allowlist && allowlist.length) {
    return Boolean(tenantId) && allowlist.includes(tenantId);
  }
  const rollout = flag.rollout ?? 100;
  if (rollout >= 100) return true;
  if (rollout <= 0) return false;
  if (!tenantId) return false;
  return hashPercent(`${flag.key}:${tenantId}`) < rollout;
}

/** Map of key -> boolean for the given tenant (or global when tenantId is null). */
export async function getFlagsForTenant(tenantId = null) {
  return cacheWrap(`flags:${tenantId || 'global'}`, TTL_SECONDS, async () => {
    const flags = await readAllFlags();
    const out = {};
    for (const flag of flags) out[flag.key] = evaluate(flag, tenantId);
    return out;
  });
}

/** Full definitions for the platform admin screen. */
export async function listFlagDefinitions() {
  const flags = await prisma.featureFlag.findMany({
    orderBy: [{ key: 'asc' }],
    select: { id: true, key: true, description: true, enabled: true, rollout: true, tenantIds: true, updatedAt: true },
  });
  return flags.map((f) => ({ ...f, tenantIds: f.tenantIds ?? null }));
}

export async function upsertFlag({ key, description, enabled, rollout, tenantIds }) {
  const data = {
    description: description ?? null,
    enabled: enabled ?? false,
    rollout: rollout == null ? 100 : Math.max(0, Math.min(100, Number(rollout))),
    tenantIds: tenantIds ?? null,
  };
  const flag = await prisma.featureFlag.upsert({
    where: { key },
    create: { key, ...data },
    update: data,
  });
  await cacheInvalidate('flags:');
  return flag;
}

export async function removeFlag(id) {
  const flag = await prisma.featureFlag.delete({ where: { id } }).catch((err) => {
    if (err?.code === 'P2025') return null;
    throw err;
  });
  await cacheInvalidate('flags:');
  return flag;
}
