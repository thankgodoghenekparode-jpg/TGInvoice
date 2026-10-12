import crypto from 'node:crypto';
import config from '../config.js';

/**
 * Stateless, signed public-share tokens.
 *
 * A token proves "this one document may be viewed publicly" without storing
 * anything in the database and without requiring a sign-in. It is HMAC-signed
 * with a server secret, so links cannot be forged or enumerated, and every
 * token expires. Each token is scoped to a single document + tenant.
 */

function sign(body) {
  return crypto.createHmac('sha256', config.share.secret).update(body).digest('base64url');
}

export function signShareToken({ kind, id, tenantId }) {
  const payload = {
    kind,
    id,
    tenantId,
    exp: Date.now() + config.share.ttlDays * 24 * 60 * 60 * 1000,
  };
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${body}.${sign(body)}`;
}

export function verifyShareToken(token) {
  if (!token || typeof token !== 'string') return null;
  const [body, signature] = token.split('.');
  if (!body || !signature) return null;

  const expected = sign(body);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!payload?.id || !payload?.tenantId || !payload?.kind) return null;
    if (!payload.exp || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

/** Absolute, client-reachable URL for a signed document token. */
export function publicDocumentUrl(token) {
  return `${String(config.share.baseUrl).replace(/\/+$/, '')}/api/public/documents/${token}`;
}
