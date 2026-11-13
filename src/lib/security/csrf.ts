import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const CSRF_COOKIE = '__Host-sfm-csrf';
export const CSRF_HEADER = 'X-CSRF-Token';

export class CsrfError extends Error {
  constructor() { super('CSRF validation failed'); }
}

function signature(nonce: string) {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret || secret.length < 32) throw new Error('Invalid authentication secret');
  return createHmac('sha256', secret).update(`csrf:${nonce}`).digest('hex');
}

function equal(a: string, b: string) {
  const left = Buffer.from(a), right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function validCsrfToken(token: string) {
  if (!/^[a-f0-9]{64}\.[a-f0-9]{64}$/.test(token)) return false;
  const [nonce, mac] = token.split('.');
  return equal(mac, signature(nonce));
}

export function csrfCookie(request: Request) {
  return request.headers.get('cookie')?.split(';').map(part => part.trim())
    .find(part => part.startsWith(`${CSRF_COOKIE}=`))?.slice(CSRF_COOKIE.length + 1) ?? '';
}

export function createCsrfToken() {
  const nonce = randomBytes(32).toString('hex');
  return `${nonce}.${signature(nonce)}`;
}

/** Compare with configured public origin, never attacker-controlled Host headers. */
export function requireSameOrigin(request: Request) {
  const expected = new URL(process.env.BETTER_AUTH_URL!).origin;
  if (request.headers.get('origin') !== expected) throw new CsrfError();
  const site = request.headers.get('sec-fetch-site');
  if (site && site !== 'same-origin') throw new CsrfError();
}

/** Signed double-submit token, with a host-only, Secure, HttpOnly cookie. */
export function requireCsrf(request: Request) {
  requireSameOrigin(request);
  const token = request.headers.get(CSRF_HEADER) ?? '';
  if (!validCsrfToken(token) || !equal(token, csrfCookie(request))) throw new CsrfError();
}
