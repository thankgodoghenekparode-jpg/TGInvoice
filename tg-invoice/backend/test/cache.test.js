/**
 * Cache layer: read-through caching with stampede protection, TTL expiry and
 * prefix invalidation. Caching is an optimisation — a miss must never break
 * a request, and concurrent misses must not all re-run the producer.
 */
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET ||= 'test-access-secret-do-not-use-in-production';
process.env.JWT_REFRESH_SECRET ||= 'test-refresh-secret-do-not-use-in-production';

import test from 'node:test';
import assert from 'node:assert/strict';
import { cacheGet, cacheSet, cacheDel, cacheWrap, cacheInvalidate, cacheKey, cacheStats } from '../src/services/cacheService.js';

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('set → get round-trips a value', async () => {
  await cacheSet('t:round', { total: 42 }, 60);
  assert.deepEqual(await cacheGet('t:round'), { total: 42 });
  await cacheDel('t:round');
  assert.equal(await cacheGet('t:round'), undefined, 'deleting clears the entry');
});

test('expired entries read as a miss', async () => {
  await cacheSet('t:ttl', 'gone soon', 1);
  assert.equal(await cacheGet('t:ttl'), 'gone soon');
  await wait(1100);
  assert.equal(await cacheGet('t:ttl'), undefined, 'TTL must be honoured');
});

test('cacheWrap runs the producer once and reuses the value', async () => {
  let calls = 0;
  const producer = async () => {
    calls += 1;
    await wait(25);
    return { from: 'db' };
  };

  const [a, b, c] = await Promise.all([
    cacheWrap('t:wrap', 60, producer),
    cacheWrap('t:wrap', 60, producer),
    cacheWrap('t:wrap', 60, producer),
  ]);

  assert.deepEqual(a, { from: 'db' });
  assert.deepEqual(b, a);
  assert.deepEqual(c, a);
  assert.equal(calls, 1, 'concurrent callers must share one in-flight producer');

  const d = await cacheWrap('t:wrap', 60, producer);
  assert.deepEqual(d, { from: 'db' });
  assert.equal(calls, 1, 'subsequent reads hit the cache, not the producer');
  await cacheDel('t:wrap');
});

test('a failing producer propagates and does not poison the cache', async () => {
  let calls = 0;
  await assert.rejects(
    cacheWrap('t:fail', 60, async () => {
      calls += 1;
      throw new Error('boom');
    }),
    /boom/
  );
  assert.equal(calls, 1);
  assert.equal(await cacheGet('t:fail'), undefined, 'a failure must never be cached');

  const ok = await cacheWrap('t:fail', 60, async () => 'recovered');
  assert.equal(ok, 'recovered');
  await cacheDel('t:fail');
});

test('cacheInvalidate busts a whole namespace', async () => {
  await cacheSet('ns:reports:1', { a: 1 }, 60);
  await cacheSet('ns:reports:2', { b: 2 }, 60);
  await cacheSet('ns:settings', { c: 3 }, 60);
  await cacheSet('other:key', { d: 4 }, 60);

  await cacheInvalidate('ns:reports');

  assert.equal(await cacheGet('ns:reports:1'), undefined);
  assert.equal(await cacheGet('ns:reports:2'), undefined);
  assert.ok(await cacheGet('ns:settings'), 'a different namespace survives');
  assert.ok(await cacheGet('other:key'), 'unrelated keys survive');
  await cacheInvalidate('ns:');
  await cacheDel('other:key');
});

test('cacheKey builds stable namespaced keys and drops empty parts', () => {
  assert.equal(cacheKey('reports', tenantNull(), 'summary'), 'reports:summary');
  assert.equal(cacheKey('settings', 'tenant-1'), 'settings:tenant-1');
});

function tenantNull() {
  return null;
}

test('cacheStats reports the active driver', () => {
  const stats = cacheStats();
  assert.equal(typeof stats.driver, 'string');
  assert.ok(Number.isInteger(stats.memoryKeys));
});
