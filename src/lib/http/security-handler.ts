import { requireCsrf } from '@/lib/security/csrf';
import { auditRequest } from '@/lib/security/log';
import { apiErrorResponse } from './api-error-response';
import type { NextRequest } from 'next/server';

export function securityHandler<Context>(event: string, action: (request: NextRequest, context: Context) => Promise<Response>) {
  return (request: NextRequest, context: Context) => auditRequest(request, event, async () => {
    try {
      if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) requireCsrf(request);
      return await action(request, context);
    } catch (error) { return apiErrorResponse(error); }
  });
}
