import { auth } from "@/lib/auth"
import { toNextJsHandler } from "better-auth/next-js";
import { securityHandler } from '@/lib/http/security-handler';
import { auditUser } from '@/lib/security/log';

const handlers = toNextJsHandler(auth);
async function handle(request: Request) {
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
