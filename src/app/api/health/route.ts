export function GET() {
  // Public liveness only: no secrets, connection strings or dependency details.
  return Response.json({ status: 'ok' }, { headers: { 'Cache-Control': 'no-store' } });
}
