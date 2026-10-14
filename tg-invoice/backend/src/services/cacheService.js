import config from '../config.js';

/**
 * Cache with two drivers:
 *   - memory (default): a per-process Map with TTL — ideal for one instance.
 *   - redis: shared across instances (needs the optional `ioredis` package).
 *
 * Read through `cacheWrap(key, ttl, producer)`: it returns the cached value or
 * runs the producer once, with an in-flight guard so N concurrent requests do
 * not all hit the database for the same key (stampede protection).
 *
 * A cache miss/error must NEVER break a request — every failure is swallowed.
 */

const memory = new Map(); // key -> { value, expiresAt }
const inflight = new Map(); // key -> Promise (stampede guard)

let redis = null;
let redisInit = null;

async function getRedis() {
  if (config.cache.driver !== 'redis' || !config.cache.redisUrl) return null;
  if (redis) return redis;
  if (!redisInit) {
    redisInit = (async () => {
      try {
        const { default: Redis } = await import('ioredis');
        const client = new Redis(config.cache.redisUrl, { maxRetriesPerRequest: 2 });
        client.on('error', (err) => console.error('[cache-redis]', err?.message));
        redis = client;
        return client;
      } catch (err) {
        console.error('[cache] redis driver unavailable, falling back to memory:', err?.message);
        return null;
      }
    })();
  }
  return redisInit;
}

function memGet(key) {
  const row = memory.get(key);
  if (!row) return undefined;
  if (row.expiresAt && row.expiresAt < Date.now()) {
    memory.delete(key);
    return undefined;
  }
  return row.value;
}

function memSet(key, value, ttlSeconds) {
  memory.set(key, { value, expiresAt: ttlSeconds > 0 ? Date.now() + ttlSeconds * 1000 : 0 });
}

export async function cacheGet(key) {
  const client = await getRedis();
  if (client) {
    try {
      const raw = await client.get(key);
      return raw == null ? undefined : JSON.parse(raw);
    } catch (err) {
      console.error('[cache-get]', err?.message);
    }
  }
  return memGet(key);
}

export async function cacheSet(key, value, ttlSeconds = config.cache.ttlSeconds) {
  const client = await getRedis();
  if (client) {
    try {
      const payload = JSON.stringify(value);
      if (ttlSeconds > 0) await client.set(key, payload, 'EX', ttlSeconds);
      else await client.set(key, payload);
      return;
    } catch (err) {
      console.error('[cache-set]', err?.message);
    }
  }
  memSet(key, value, ttlSeconds);
}

export async function cacheDel(key) {
  const client = await getRedis();
  if (client) {
    try {
      await client.del(key);
    } catch (err) {
      console.error('[cache-del]', err?.message);
    }
  }
  memory.delete(key);
}

/** Read-through cache with stampede protection. */
export async function cacheWrap(key, ttlSeconds, producer) {
  const hit = await cacheGet(key);
  if (hit !== undefined) return hit;
  if (inflight.has(key)) return inflight.get(key);

  const pending = (async () => {
    const value = await producer();
    await cacheSet(key, value, ttlSeconds);
    return value;
  })().finally(() => inflight.delete(key));

  inflight.set(key, pending);
  return pending;
}

/** Invalidate every entry whose key starts with `prefix` (namespace bust). */
export async function cacheInvalidate(prefix) {
  for (const key of [...memory.keys()]) {
    if (key.startsWith(prefix)) memory.delete(key);
  }
  const client = await getRedis();
  if (client) {
    try {
      const keys = await client.keys(`${prefix}*`);
      if (keys.length) await client.del(keys);
    } catch (err) {
      console.error('[cache-invalidate]', err?.message);
    }
  }
}

export function cacheStats() {
  return { driver: config.cache.driver, redisReady: Boolean(redis), memoryKeys: memory.size };
}

export const cacheKey = (...parts) => parts.filter((p) => p != null && p !== '').join(':');

export default { cacheGet, cacheSet, cacheDel, cacheWrap, cacheInvalidate, cacheStats, cacheKey };
