import { auth } from "@/lib/auth"
import { toNextJsHandler } from "better-auth/next-js";
import { securityHandler } from '@/lib/http/security-handler';
import { auditUser } from '@/lib/security/log';
import { boundedBody } from '@/lib/http/bounded-body';
import { z } from 'zod';

const handlers = toNextJsHandler(auth);
async function handle(request: Request) {
  if (request.method === 'POST') {
    const session = await auth.api.getSession({ headers: request.headers });
    if (session) auditUser(session.user.id);
    const text = await boundedBody(request, 16 * 1024).text();
    if (text) {
      if (!request.headers.get('content-type')?.startsWith('application/json')) {
        return Response.json({ error: 'INVALID_REQUEST' }, { status: 415 });
      }
      let body;
      try { body = JSON.parse(text); }
      catch { return Response.json({ error: 'INVALID_REQUEST' }, { status: 400 }); }
      z.object({
        name: z.string().trim().min(1).max(100).optional(),
        email: z.email().max(254).optional(),
      }).passthrough().parse(body);
    }
    request = new Request(request.url, { method: request.method, headers: request.headers, body: text, signal: request.signal });
  }
  const response = await (request.method === 'GET' ? handlers.GET(request) : handlers.POST(request));
  if (response.status >= 500) return Response.json({ error: 'INTERNAL_SERVER_ERROR' }, { status: 500 });
  if (response.ok && response.headers.get('content-type')?.includes('application/json')) {
    const body = await response.clone().json();
    if (typeof body?.user?.id === 'string') auditUser(body.user.id);
  }
  return response;
}
export const POST = securityHandler('auth.mutation', handle);
export const GET = securityHandler('auth.read', handle);
