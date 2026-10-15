import { errors } from './errors.js';

/**
 * Safe list-query parsing: pagination + sort allowlist.
 * Sort fields come from an allowlist — arbitrary query params are never
 * interpolated into database ordering.
 */
export function parseListQuery(query = {}, { sortAllowlist = [], defaultSort = '-createdAt', maxLimit = 100 } = {}) {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  let limit = parseInt(query.limit, 10) || 20;
  if (limit < 1) limit = 1;
  if (limit > maxLimit) limit = maxLimit;

  const rawSort = String(query.sort || defaultSort).trim();
  const desc = rawSort.startsWith('-');
  const field = desc ? rawSort.slice(1) : rawSort;

  if (!sortAllowlist.includes(field)) {
    if (rawSort !== defaultSort && rawSort !== `-${defaultSort.replace(/^-/, '')}`) {
      throw errors.badRequest('Invalid sort field.');
    }
    return { page, limit, orderBy: mapSort(defaultSort, sortAllowlist) };
  }

  return { page, limit, orderBy: mapSort(rawSort, sortAllowlist) };
}

function mapSort(raw, allowlist) {
  const desc = raw.startsWith('-');
  const field = desc ? raw.slice(1) : raw;
  if (!allowlist.includes(field)) return { createdAt: 'desc' };
  return { [field]: desc ? 'desc' : 'asc' };
}

/** Standard paginated response envelope. */
export function paged(rows, total, page, limit) {
  return {
    data: rows,
    meta: {
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
      hasNext: page * limit < total,
      hasPrev: page > 1,
    },
  };
}

/** Case-insensitive search term → { field: { contains, mode: 'insensitive' } } filters.
 *  Dotted paths address relations (`customer.name` → `{ customer: { name: … } }`). */
export function searchFilter(term, fields) {
  if (!term || !String(term).trim()) return {};
  const q = String(term).trim();
  return {
    OR: fields.map((f) => nestField(f, { contains: q, mode: 'insensitive' })),
  };
}

function nestField(path, leaf) {
  const parts = String(path).split('.');
  let node = leaf;
  for (let i = parts.length - 1; i >= 0; i -= 1) node = { [parts[i]]: node };
  return node;
}

export const ok = (res, data = null, meta = undefined) =>
  res.json({ success: true, data, ...(meta ? { meta } : {}) });

export const created = (res, data = null) => res.status(201).json({ success: true, data });
