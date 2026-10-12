import { useCallback, useEffect, useMemo, useState } from 'react';
import api from '../services/api.js';
import { useAuth } from '../context/AuthContext.jsx';
import { formatMoney, formatCompact, amountInWords } from '../utils/currency.js';

/**
 * Company settings for the ACTIVE business, cached per tenant id so switching
 * businesses never shows another tenant's currency/logo/branding twice.
 * GET /api/settings is always tenant-scoped by the backend anyway.
 */
const cache = new Map(); // tenantId -> settings

export function useSettings() {
  const { activeTenant } = useAuth();
  const tenantId = activeTenant?.id || null;

  const [settings, setSettings] = useState(() => (tenantId ? cache.get(tenantId) || null : null));
  const [loading, setLoading] = useState(() => !!(tenantId && !cache.get(tenantId)));

  const load = useCallback(async () => {
    if (!tenantId) {
      setSettings(null);
      setLoading(false);
      return;
    }
    const cached = cache.get(tenantId);
    if (cached) {
      setSettings(cached);
      setLoading(false);
      return;
    }
    setLoading(true);
    setSettings(null); // never show the previous business's settings while loading
    try {
      const { data } = await api.get('/settings');
      const payload = data.data;
      // A response that raced a business switch is dropped, never cached:
      // it would put one tenant's branding into another tenant's view.
      if (payload?.tenantId && payload.tenantId !== tenantId) return;
      cache.set(tenantId, payload);
      setSettings(payload);
    } catch {
      /* Settings stay null — rendering falls back to safe defaults. */
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    load();
  }, [load]);

  const refresh = useCallback(async () => {
    if (tenantId) cache.delete(tenantId);
    await load();
  }, [tenantId, load]);

  const money = useCallback((v) => formatMoney(v, settings || {}), [settings]);

  const value = useMemo(
    () => ({
      settings: settings || {},
      loading,
      refresh,
      money,
      compact: (v) => formatCompact(v, settings || {}),
      inWords: (v) => amountInWords(v, settings || {}),
      tenantId,
    }),
    [settings, loading, refresh, money, tenantId]
  );

  return value;
}
