import { FilePolicyError } from '@/lib/files/errors';

/** Enforce actual streamed size too; Content-Length is optional and untrusted. */
export function boundedBody(request: Request, maximum: number): Response {
  const declared = request.headers.get('content-length');
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > maximum)) {
    throw new FilePolicyError('REQUEST_TOO_LARGE', 413);
  }
  let received = 0;
  const body = request.body?.pipeThrough(new TransformStream({
    transform(chunk, controller) {
      received += chunk.byteLength;
      if (received > maximum) throw new FilePolicyError('REQUEST_TOO_LARGE', 413);
      controller.enqueue(chunk);
    },
  }));
  return new Response(body, { headers: request.headers });
}
