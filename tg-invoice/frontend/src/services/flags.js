import { api } from './api';

/**
 * Feature flags — mirrors `GET /api/flags`.
 *
 * The backend decides on/off (percentage rollout is hashed per tenant server
 * side), so the client just renders what it is told. The response is cached
 * for the session; `resetFlags()` refetches when the active business changes.
 */

let cache = null;
let inflight = null;

export function loadFlags({ force = false } = {}) {
  if (cache && !force) return Promise.resolve(cache);
  if (inflight) return inflight;

  inflight = api
    .get('/flags')
    .then((res) => {
      cache = res.data?.flags || {};
      return cache;
    })
    .catch(() => {
      // Flags gate UX, never access — a failed read must not break the app.
      cache = cache || {};
      return cache;
    })
    .finally(() => {
      inflight = null;
    });

  return inflight;
}

export const getCachedFlags = () => cache || {};

export function flag(key, fallback = false) {
  const flags = cache;
  if (!flags || !(key in flags)) return fallback;
  return Boolean(flags[key]);
}

export function resetFlags() {
  cache = null;
  inflight = null;
}

export default { loadFlags, flag, resetFlags, getCachedFlags };
