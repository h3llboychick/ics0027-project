import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { isIP } from 'node:net';

type AuditContext = { requestId: string; userId: string | null; sourceAddress: string | null; code?: string };
const context = new AsyncLocalStorage<AuditContext>();
type LogFields = {
  outcome: 'success' | 'denied' | 'error' | 'pending';
  userId?: string | null;
  fileId?: string;
  operationId?: string;
  code?: string;
  status?: number;
};

/** Whitelist fields; never serialize requests, errors, bodies, URLs or headers. */
export function securityLog(event: string, fields: LogFields) {
  const current = context.getStore();
  console.info(JSON.stringify({
    timestamp: new Date().toISOString(), event,
    requestId: current?.requestId ?? null,
    userId: fields.userId ?? current?.userId ?? null,
    sourceAddress: current?.sourceAddress ?? null,
    outcome: fields.outcome,
    status: fields.status,
    code: fields.code ?? current?.code,
    fileId: fields.fileId,
    operationId: fields.operationId,
  }));
}

export function auditUser(userId: string) { const current = context.getStore(); if (current) current.userId = userId; }
export function auditError(code: string) { const current = context.getStore(); if (current) current.code = code; }

export async function auditRequest(request: Request, event: string, action: () => Promise<Response>) {
  const address = process.env.TRUST_PROXY_HEADERS === 'true' ? request.headers.get('x-real-ip') : null;
  return context.run({ requestId: randomUUID(), userId: null, sourceAddress: address && isIP(address) ? address : null }, async () => {
    const response = await action();
    response.headers.set('X-Request-Id', context.getStore()!.requestId);
    response.headers.set('Cache-Control', 'no-store');
    securityLog(event, { status: response.status, outcome: response.status >= 500 ? 'error' : response.status >= 400 ? 'denied' : response.status === 202 ? 'pending' : 'success' });
    return response;
  });
}
