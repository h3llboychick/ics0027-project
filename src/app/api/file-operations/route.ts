import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth-guard';
import { operationLookupSchema } from '@/lib/contracts/files';
import { operationRepository } from '@/lib/files/runtime';
import { publicOperation } from '@/lib/files/operations/model';
import { apiErrorResponse } from '@/lib/http/api-error-response';

export async function GET(request: NextRequest) {
  try {
    const { user } = await requireUser(request);
    const input = operationLookupSchema.parse(Object.fromEntries(request.nextUrl.searchParams));
    const operation = await operationRepository.findByKey(user.id, input.type, input.idempotencyKey);
    return NextResponse.json(operation ? publicOperation(operation) : { error: 'OPERATION_NOT_FOUND' },
      { status: operation ? 200 : 404, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return apiErrorResponse(error, 'GET /api/file-operations'); }
}
