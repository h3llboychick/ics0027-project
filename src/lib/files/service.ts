import { FileListings, FileRepository } from "./repository/base";
import { FileStorage } from "./storage/base";
import { aesGcmFileEncryptor } from "./encryption";
import { FileUploadError, FileUploadRollbackError } from "./errors";
import crypto from 'crypto';

export class FileService {
    constructor(private readonly repository: FileRepository, private readonly storage: FileStorage) {}

    async listForOwner(
        ownerId: string,
        page: number,
        pageSize: number,
    ): Promise<FileListings> {
        return await this.repository.listByOwner(ownerId, page, pageSize)
    }

    async uploadFile(
        ownerId: string,
        file: File
    ): Promise<crypto.UUID> {
        const fileId = crypto.randomUUID();
        let fileBytes: Uint8Array<ArrayBuffer>;
        try {
            fileBytes = await file.bytes();
        } catch (error) {
            throw new FileUploadError("Could not read uploaded file", { cause: error });
        }
        const encryptedContent = aesGcmFileEncryptor.encrypt(fileBytes);

        await this.storage.put(fileId, encryptedContent.encryptedContent.ciphertext);
        try {
            await this.repository.create({
                id: fileId,
                ownedBy: ownerId,
                filename: file.name,
                fileSizeBytes: file.size,
                encryptedFileAuthTag: encryptedContent.encryptedContent.authTag,
                encryptedFileIV: encryptedContent.encryptedContent.iv,
                protectedEncryptionKey: encryptedContent.encryptedDataKey.ciphertext,
                protectedEncryptionKeyIV: encryptedContent.encryptedDataKey.iv,
                protectedEncryptionKeyAuthTag: encryptedContent.encryptedDataKey.authTag,
            });
        } catch (metadataError) {
            try {
                await this.storage.delete(fileId);
            } catch (cleanupError) {
                throw new FileUploadRollbackError({
                    cause: new AggregateError([metadataError, cleanupError]),
                });
            }
            throw metadataError;
        }

        return fileId;
    }

    async downloadFile(
        ownerId: string,
        fileId: string
    ): Promise<File | undefined> {
        const fileMetadata = await this.repository.getFileEncryptionMetadata(fileId, ownerId);
        if (!fileMetadata) return undefined;

        const encryptedFile = await this.storage.get(fileId);
        if (!encryptedFile) return undefined;

        const decryptedFileBytes = aesGcmFileEncryptor.decrypt({
            encryptedContent: {
                iv: fileMetadata.encryptedFileIV,
                ciphertext: encryptedFile,
                authTag: fileMetadata.encryptedFileAuthTag,
            },
            encryptedDataKey: {
                iv: fileMetadata.protectedEncryptionKeyIV,
                ciphertext: fileMetadata.protectedEncryptionKey,
                authTag: fileMetadata.protectedEncryptionKeyAuthTag,
            },
        });

        return new File([decryptedFileBytes], fileMetadata.filename);
    }

    async deleteFile(ownerId: string, fileId: string): Promise<string | null> {
        const fileMetadata = await this.repository.getFileEncryptionMetadata(fileId, ownerId);
        if (!fileMetadata) return null;

        await this.storage.delete(fileId);
        await this.repository.deleteById(fileId, ownerId);

        return fileId;
    }
}
