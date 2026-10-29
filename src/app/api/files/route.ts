import { requireUser } from "@/lib/auth-guard";
import { NextRequest, NextResponse } from "next/server";
import { idempotencyKeySchema, listFilesRequestSchema, uploadFileRequestSchema } from "@/lib/contracts/files";
import { FileService } from "@/lib/files/service";
import { diskStorage } from "@/lib/files/storage/disk-storage";
import { prismaFileRepository } from "@/lib/files/repository/prisma-file-repository";
import * as z from 'zod'
import { apiErrorResponse } from "@/lib/http/api-error-response";
import { operationRepository } from '@/lib/files/runtime';


export async function GET(request: NextRequest) {
  let session;
  try {
    session = await requireUser(request);
  } catch (error) {
    return apiErrorResponse(error, 'GET /api/files authentication failed');
  }
  
  let listFilesRequest;
  try {
    listFilesRequest = listFilesRequestSchema.parse(Object.fromEntries(request.nextUrl.searchParams))
  } catch (err) {
    if (err instanceof z.ZodError) {
        return NextResponse.json({ error: "Invalid request" }, { status: 422 })
    } else {
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 })
    }
  }
  

  const fileService = new FileService(prismaFileRepository, diskStorage, operationRepository);
  try {
    const filesPage = await fileService.listForOwner(session.user.id, listFilesRequest.page, listFilesRequest.pageSize);
    return NextResponse.json(filesPage, { status: 200 });
  } catch (error) {
    return apiErrorResponse(error, 'GET /api/files listing failed');
  }  
}


export async function POST(request: NextRequest) {
  let session;
  try {
    session = await requireUser(request);
  } catch (error) {
    return apiErrorResponse(error, 'POST /api/files authentication failed');
  }

  let key: string;
  try {
    request.signal.throwIfAborted();
    key = idempotencyKeySchema.parse(request.headers.get('Idempotency-Key'));
  } catch (error) { return apiErrorResponse(error, 'POST /api/files validation failed'); }
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    if (request.signal.aborted) return NextResponse.json({ error: 'REQUEST_CANCELLED' }, { status: 408 });
    return NextResponse.json({ error: 'INVALID_REQUEST' }, { status: 400 });
  }

  let validatedFile;
  try {
    validatedFile = uploadFileRequestSchema.parse(formData.get("file"))
  } catch (err) {
    return apiErrorResponse(err, 'POST /api/files validation failed');
  }

  // Service called
  const fileService = new FileService(prismaFileRepository, diskStorage, operationRepository);
  try {
    const result = await fileService.uploadFile(session.user.id, validatedFile, key, request.signal);
    return NextResponse.json(result.body, { status: result.status, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return apiErrorResponse(error, 'POST /api/files upload failed');
  }
}
