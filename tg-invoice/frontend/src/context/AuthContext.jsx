import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import api, { setAccessToken, setStoredTenantId, getStoredTenantId, refreshSession as requestSessionRefresh } from '../services/api';

/**
 * Auth + active-business context.
 *
 * Boot: attempt a silent refresh (httpOnly cookie) so a reload keeps you
 * signed in. After every auth event the user, business list and active
 * business are refreshed together.
 */
const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [tenants, setTenants] = useState([]);
  const [activeTenant, setActiveTenant] = useState(null);
  const [booting, setBooting] = useState(true);
  const mounted = useRef(true);

  const applySession = useCallback((data) => {
    setAccessToken(data.accessToken);
    setUser(data.user);
    setTenants(data.tenants || []);
    const stored = getStoredTenantId();
    const chosen =
      (data.tenants || []).find((t) => t.id === stored) ||
      data.activeTenant ||
      (data.tenants || [])[0] ||
      null;
    setActiveTenant(chosen);
    if (chosen) setStoredTenantId(chosen.id);
    else setStoredTenantId(null);
    return chosen;
  }, []);

  const clearSession = useCallback(() => {
    setAccessToken(null);
    setStoredTenantId(null);
    setUser(null);
    setTenants([]);
    setActiveTenant(null);
  }, []);

  useEffect(() => {
    mounted.current = true;
    (async () => {
      try {
        const { data } = await requestSessionRefresh();
        if (mounted.current) applySession(data.data);
      } catch {
        if (mounted.current) clearSession();
      } finally {
        if (mounted.current) setBooting(false);
      }
    })();
    return () => {
      mounted.current = false;
    };
  }, [applySession, clearSession]);

  const login = useCallback(async (credentials) => {
    const { data } = await api.post('/auth/login', credentials);
    applySession(data.data);
    return data.data;
  }, [applySession]);

  const register = useCallback(async (payload) => {
    const { data } = await api.post('/auth/register', payload);
    applySession(data.data);
    return data.data;
  }, [applySession]);

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout');
    } catch {
      /* cookie may already be gone */
    }
    clearSession();
    window.location.href = '/login';
  }, [clearSession]);

  /** Switch the active business — backend re-verifies membership (403 if not). */
  const switchTenant = useCallback(
    async (tenantId) => {
      const { data } = await api.post('/tenants/switch', { tenantId });
      setStoredTenantId(tenantId);
      const tenant = data.data.tenant;
      setActiveTenant((prev) => ({ ...(prev || {}), ...tenant }));
      setTenants((list) => list.map((t) => (t.id === tenantId ? { ...t, ...tenant, role: data.data.role } : t)));
      return data.data;
    },
    []
  );

  /** After creating another business from the switcher. */
  const addTenant = useCallback(
    (tenant) => {
      setTenants((list) => [...list, tenant]);
      setActiveTenant(tenant);
      setStoredTenantId(tenant.id);
    },
    []
  );

  const refreshSession = useCallback(async () => {
    try {
      const { data } = await requestSessionRefresh();
      applySession(data.data);
      return data.data;
    } catch {
      clearSession();
      return null;
    }
  }, [applySession, clearSession]);

  const role = useMemo(
    () => tenants.find((t) => t.id === activeTenant?.id)?.role || null,
    [tenants, activeTenant]
  );

  const value = useMemo(
    () => ({
      user,
      tenants,
      activeTenant,
      role,
      booting,
      isAuthenticated: !!user,
      isPlatformAdmin: !!user?.isPlatformAdmin,
      login,
      register,
      logout,
      switchTenant,
      addTenant,
      refreshSession,
      setUser,
      clearSession,
    }),
    [user, tenants, activeTenant, role, booting, login, register, logout, switchTenant, addTenant, refreshSession, clearSession]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

export default AuthContext;
