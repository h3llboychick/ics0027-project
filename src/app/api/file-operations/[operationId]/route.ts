import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth-guard';
import { getFileRequestSchema } from '@/lib/contracts/files';
import { operationRepository } from '@/lib/files/runtime';
import { publicOperation } from '@/lib/files/operations/model';
import { apiErrorResponse } from '@/lib/http/api-error-response';

export async function GET(request: NextRequest, context: { params: Promise<{ operationId: string }> }) {
  try {
    const { user } = await requireUser(request);
    const id = getFileRequestSchema.parse((await context.params).operationId);
    const operation = await operationRepository.find(id, user.id);
    return NextResponse.json(operation ? publicOperation(operation) : { error: 'OPERATION_NOT_FOUND' },
      { status: operation ? 200 : 404, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return apiErrorResponse(error, 'GET /api/file-operations/[operationId]'); }
}
