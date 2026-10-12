import { useCallback, useEffect, useRef, useState } from 'react';
import api, { apiMessage } from '../services/api.js';

/** Debounce any value (search boxes) without re-rendering on each keystroke. */
export function useDebounced(value, delay = 350) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

/**
 * Paginated list state: `{ rows, meta, page, setPage, loading, error, reload }`.
 * Resets to page 1 whenever `params` change (search, filters, tenant switch).
 */
export function usePagedList(path, params = {}, { limit = 20 } = {}) {
  const paramsKey = JSON.stringify(params);
  const [rows, setRows] = useState([]);
  const [meta, setMeta] = useState({ total: 0, page: 1, totalPages: 1 });
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const firstLoad = useRef(true);

  const load = useCallback(
    async (p = 1) => {
      setLoading(true);
      setError('');
      try {
        const query = { page: p, limit, ...JSON.parse(paramsKey) };
        Object.keys(query).forEach((k) => {
          const v = query[k];
          if (v === '' || v == null || (Array.isArray(v) && v.length === 0)) delete query[k];
        });
        const { data } = await api.get(path, { params: query });
        setRows(data.data || []);
        setMeta(data.meta || { total: 0, page: 1, totalPages: 1 });
      } catch (err) {
        setRows([]);
        setError(apiMessage(err, 'Could not load the list.'));
      } finally {
        setLoading(false);
        firstLoad.current = false;
      }
    },
    [path, paramsKey, limit]
  );

  // New filters → back to page 1.
  useEffect(() => {
    setPage(1);
  }, [paramsKey, path]);

  useEffect(() => {
    load(page);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load, page]);

  const reload = useCallback(() => load(page), [load, page]);

  return { rows, meta, page, setPage, loading, error, reload };
}
