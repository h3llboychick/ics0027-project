let pendingToken: Promise<string> | undefined;

async function getToken(signal?: AbortSignal | null) {
  // Share initial issuance within a tab. Re-read for each mutation so another
  // tab's cookie changes do not leave a permanently stale client-side token.
  pendingToken ??= fetch('/api/csrf', { cache: 'no-store', credentials: 'same-origin' })
    .then(async response => {
      if (!response.ok) throw new Error('Could not prepare a secure request');
      return (await response.json()).token as string;
    }).finally(() => { pendingToken = undefined; });
  const token = await pendingToken;
  signal?.throwIfAborted();
  return token;
}

export async function csrfFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
  if (['GET', 'HEAD', 'OPTIONS'].includes(method)) return fetch(input, init);
  const url = new URL(input instanceof Request ? input.url : input.toString(), window.location.origin);
  if (url.origin !== window.location.origin) throw new Error('Request must be same-origin');
  const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
  headers.set('X-CSRF-Token', await getToken(init?.signal));
  return fetch(input, { ...init, headers, credentials: 'same-origin' });
}
