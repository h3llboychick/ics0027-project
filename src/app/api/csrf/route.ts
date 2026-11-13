import { NextRequest, NextResponse } from 'next/server';
import { createCsrfToken, csrfCookie, CSRF_COOKIE, validCsrfToken } from '@/lib/security/csrf';

export function GET(request: NextRequest) {
  const site = request.headers.get('sec-fetch-site');
  if (site && site !== 'same-origin' && site !== 'none') {
    return NextResponse.json({ error: 'CSRF_REJECTED' }, { status: 403, headers: { 'Cache-Control': 'no-store' } });
  }
  const existing = csrfCookie(request);
  const token = validCsrfToken(existing) ? existing : createCsrfToken();
  const response = NextResponse.json({ token }, { headers: { 'Cache-Control': 'no-store' } });
  response.cookies.set(CSRF_COOKIE, token, { httpOnly: true, secure: true, sameSite: 'strict', path: '/' });
  return response;
}
