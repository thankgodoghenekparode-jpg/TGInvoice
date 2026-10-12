import axios from 'axios';

/**
 * API client.
 *  - Bearer access token kept in memory (XSS-resistant; refresh cookie renews it)
 *  - X-Tenant-Id carries the ACTIVE BUSINESS — the backend re-verifies
 *    membership on every request, so this header can never escalate access.
 *  - On 401 the client silently refreshes once, then retries.
 */

const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:5050/api';
const TENANT_KEY = 'tg_invoice_tenant';

let accessToken = null;
export const setAccessToken = (token) => {
  accessToken = token;
};
export const getAccessToken = () => accessToken;

export const getStoredTenantId = () => localStorage.getItem(TENANT_KEY);
export const setStoredTenantId = (id) => {
  if (id) localStorage.setItem(TENANT_KEY, id);
  else localStorage.removeItem(TENANT_KEY);
};

const api = axios.create({ baseURL: BASE_URL, withCredentials: true });

api.interceptors.request.use((config) => {
  if (accessToken) config.headers.Authorization = `Bearer ${accessToken}`;
  const tenantId = getStoredTenantId();
  if (tenantId) config.headers['X-Tenant-Id'] = tenantId;
  return config;
});

let refreshPromise = null;

/**
 * Single-flight session refresh.
 * StrictMode, route guards and 401 retries can all ask for a refresh at the
 * same time; the refresh token is single-use (rotated), so exactly one
 * request may be in flight — everyone else awaits the same promise.
 */
export const refreshSession = () => {
  if (!refreshPromise) {
    const p = axios.post(`${BASE_URL}/auth/refresh`, {}, { withCredentials: true });
    refreshPromise = p;
    p.catch(() => {}).finally(() => {
      if (refreshPromise === p) refreshPromise = null;
    });
  }
  return refreshPromise;
};

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const original = error.config || {};
    const url = original.url || '';
    const isAuthRoute = url.includes('/auth/login') || url.includes('/auth/register') || url.includes('/auth/refresh');

    if (error.response?.status === 401 && !original._retried && !isAuthRoute) {
      original._retried = true;
      try {
        const { data } = await refreshSession();
        setAccessToken(data.data.accessToken);
        setStoredTenantId(data.data.activeTenant?.id ?? getStoredTenantId());
        original.headers = { ...original.headers, Authorization: `Bearer ${data.data.accessToken}` };
        return api(original);
      } catch {
        setAccessToken(null);
        setStoredTenantId(null);
        if (!window.location.pathname.startsWith('/login')) {
          window.location.href = '/login';
        }
      }
    }
    return Promise.reject(error);
  }
);

/** Friendly message from any API error. */
export const apiMessage = (error, fallback = 'Something went wrong. Please try again.') => {
  const data = error?.response?.data;
  if (data?.error?.details?.length) return data.error.details[0].message || data.error.message;
  if (data?.error?.message) return data.error.message;
  if (error?.message === 'Network Error') return 'Cannot reach the server. Please check your connection.';
  return error?.message || fallback;
};

/** Field errors from Zod validation → { fieldName: message } */
export const apiFieldErrors = (error) => {
  const details = error?.response?.data?.error?.details;
  if (!Array.isArray(details)) return {};
  return Object.fromEntries(details.map((d) => [d.path, d.message]));
};

export default api;
export { api }; // named alias for `import { api }` call sites
