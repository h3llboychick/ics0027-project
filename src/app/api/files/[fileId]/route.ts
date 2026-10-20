import { requireUser} from "@/lib/auth-guard";
import { NextRequest, NextResponse } from "next/server";
import { getFileRequestSchema } from "@/lib/contracts/files";
import { FileService } from "@/lib/files/service";
import { prismaFileRepository } from "@/lib/files/repository/prisma-file-repository";
import { diskStorage } from "@/lib/files/storage/disk-storage";
import { apiErrorResponse } from "@/lib/http/api-error-response";

type RouteContext = {
    params: Promise<{ fileId: string }>
}

export async function GET(request: NextRequest, context: RouteContext) {
  let session;
  try {
    session = await requireUser(request);
  } catch (error) {
    return apiErrorResponse(error, 'GET /api/files/[fileId] authentication failed');
  }
  const { fileId } = await context.params;
  let validatedFileId;
  try {
    validatedFileId = getFileRequestSchema.parse(fileId)
  } catch (err) {
    return apiErrorResponse(err, 'GET /api/files/[fileId] validation failed');
  }

  const fileService = new FileService(prismaFileRepository, diskStorage);
  let file: File | undefined;
  try {
    file = await fileService.downloadFile(session.user.id, validatedFileId);
  } catch (error) {
    return apiErrorResponse(error, 'GET /api/files/[fileId] download failed');
  }

  if (!file) {
    return NextResponse.json({ error: 'FILE_NOT_FOUND' }, { status: 404 });
  }

  // Response returned
  return new Response(file, {
      headers: {
        'Content-Type': 'application/octet-stream', 
        'Content-Disposition': `attachment; filename="${file?.name}"`,
      }
    })
}


export async function DELETE(request: NextRequest, context: RouteContext) {
  let session;
  try {
    session = await requireUser(request);
  } catch (error) {
    return apiErrorResponse(error, 'DELETE /api/files/[fileId] authentication failed');
  }
  const { fileId } = await context.params;
  let validatedFileId;
  try {
    validatedFileId = getFileRequestSchema.parse(fileId)
  } catch (err) {
    return apiErrorResponse(err, 'DELETE /api/files/[fileId] validation failed');
  }

  const fileService = new FileService(prismaFileRepository, diskStorage);
  let deletedFileId;
  try {
    deletedFileId = await fileService.deleteFile(session.user.id, validatedFileId);
  } catch (error) {
    return apiErrorResponse(error, 'DELETE /api/files/[fileId] failed');
  }

  if (!deletedFileId) return NextResponse.json({ error: 'FILE_NOT_FOUND' }, { status: 404 });
  return new Response(null, 
    { 
      status: 204 
    }
  );
}
