import { randomBytes } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { securityLog } from '@/lib/security/log';

export async function proxy(request: NextRequest) {
  const nonce = randomBytes(32).toString('base64');
  const dev = process.env.NODE_ENV === 'development';
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ''}`,
    `style-src-elem 'self' 'nonce-${nonce}'`,
    // Base UI positions popovers with style attributes; no inline script allowed.
    "style-src-attr 'unsafe-inline'",
    "img-src 'self' data: blob:", "font-src 'self'",
    `connect-src 'self'${dev ? ' ws: wss:' : ''}`,
    "object-src 'none'", "base-uri 'none'", "form-action 'self'", "frame-ancestors 'none'",
  ].join('; ');
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('Content-Security-Policy', csp);
  requestHeaders.set('x-nonce', nonce);
  let response: NextResponse;
  try {
    if (request.nextUrl.pathname === '/' && !await auth.api.getSession({ headers: request.headers })) {
      response = NextResponse.redirect(new URL('/sign-in', request.url));
    } else {
      response = NextResponse.next({ request: { headers: requestHeaders } });
    }
  } catch {
    securityLog('page.session_check', { outcome: 'error', code: 'DEPENDENCY_UNAVAILABLE' });
    response = NextResponse.json({ error: 'SERVICE_UNAVAILABLE' }, { status: 503 });
  }
  response.headers.set('Content-Security-Policy', csp);
  response.headers.set('Cache-Control', 'no-store');
  return response;
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
};
