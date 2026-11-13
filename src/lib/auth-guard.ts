import { auth } from '@/lib/auth';
import { auditUser } from './security/log';

export class UnauthenticatedError extends Error {
  constructor() {
    super('Authentication required');
    this.name = 'UnauthenticatedError';
  }
}

export async function requireUser(request: Request) {
  const session = await auth.api.getSession({
    headers: request.headers,
  });

  if (!session) {
    throw new UnauthenticatedError();
  }

  auditUser(session.user.id);
  return session;
}
