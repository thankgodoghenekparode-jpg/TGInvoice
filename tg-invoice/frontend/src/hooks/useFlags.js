import { useCallback, useEffect, useState } from 'react';
import { loadFlags, resetFlags, getCachedFlags } from '../services/flags';

/**
 * Feature flags in React. The first subscriber triggers the fetch; everyone
 * else reuses the cached response, so mounting N gated components still costs
 * one request. Read failures fall back to defaults instead of throwing.
 */
export function useFlags() {
  const [flags, setFlags] = useState(getCachedFlags);

  useEffect(() => {
    let alive = true;
    loadFlags().then((next) => {
      if (alive) setFlags(next);
    });
    return () => {
      alive = false;
    };
  }, []);

  const getFlag = useCallback(
    (key, fallback = false) => (key in flags ? Boolean(flags[key]) : fallback),
    [flags]
  );

  const reload = useCallback(() => loadFlags({ force: true }).then(setFlags), []);

  return { flags, getFlag, reload };
}

/** `const showIt = useFlag('new-invoice-ui', false);` */
export function useFlag(key, fallback = false) {
  const { flags } = useFlags();
  return key in flags ? Boolean(flags[key]) : fallback;
}

/** Refetch when the active business changes (rollout is per-tenant). */
export function refreshFlags() {
  resetFlags();
  return loadFlags({ force: true });
}

export { resetFlags };
export default useFlags;
