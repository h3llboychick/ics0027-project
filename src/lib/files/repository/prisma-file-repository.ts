import { prisma } from "@/lib/prisma"
import type { CreateFileMetadata, FileEncryptionMetadata, FileRepository, FileMetadata, FileListings} from "./base";
import { FileMetadataError } from "../errors";

async function withMetadataError<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    throw new FileMetadataError("File metadata operation failed", { cause: error });
  }
}

export const prismaFileRepository: FileRepository = {
  async create(input: CreateFileMetadata): Promise<FileMetadata> {
    return withMetadataError(async () => await prisma.fileMetadata.create({ data: input }));
  },

  async getFileEncryptionMetadata(id: string, ownerId: string): Promise<FileEncryptionMetadata | null> {
    return withMetadataError(async () => await prisma.fileMetadata.findUnique({ where: { id, ownedBy: ownerId }}));
  },

  async findById(id: string, ownerId: string): Promise<FileMetadata | null> {
    return withMetadataError(async () => await prisma.fileMetadata.findUnique({ where: { id, ownedBy: ownerId }, select: { id: true, ownedBy: true, createdAt: true, filename: true, fileSizeBytes: true}}));
  },

  async listByOwner(ownerId: string, page: number, pageSize: number): Promise<FileListings> {
    return withMetadataError(async () => {
      const files = await prisma.fileMetadata.findMany({
        select: {
          ownedBy: true,
          createdAt: true,
          filename: true,
          id: true,
          fileSizeBytes: true
        },
        where: { ownedBy: ownerId },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (page - 1) * pageSize,
        take:  pageSize + 1
      });
      const hasMorePages = files.length > pageSize;

      if (hasMorePages) files.pop();

      return {
        files,
        hasMorePages,
        page
      };
    });
  },

  async deleteById(id: string): Promise<void> {
    await withMetadataError(async () => await prisma.fileMetadata.delete({ where: { id } }));
  },
};
