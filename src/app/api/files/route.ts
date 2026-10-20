import { requireUser } from "@/lib/auth-guard";
import { NextRequest, NextResponse } from "next/server";
import { listFilesRequestSchema, uploadFileRequestSchema } from "@/lib/contracts/files";
import { FileService } from "@/lib/files/service";
import { diskStorage } from "@/lib/files/storage/disk-storage";
import { prismaFileRepository } from "@/lib/files/repository/prisma-file-repository";
import * as z from 'zod'
import { apiErrorResponse } from "@/lib/http/api-error-response";


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
  

  const fileService = new FileService(prismaFileRepository, diskStorage);
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

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch (error) {
    console.warn('POST /api/files received invalid multipart form data', error);
    return NextResponse.json({ error: 'INVALID_REQUEST' }, { status: 400 });
  }

  let validatedFile;
  try {
    validatedFile = uploadFileRequestSchema.parse(formData.get("file"))
  } catch (err) {
    return apiErrorResponse(err, 'POST /api/files validation failed');
  }

  // Service called
  const fileService = new FileService(prismaFileRepository, diskStorage);
  try {
    const fileId = await fileService.uploadFile(session.user.id, validatedFile);
    return NextResponse.json({ fileId }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error, 'POST /api/files upload failed');
  }
}
