import { createHash, randomUUID } from 'node:crypto';
import type { FileRepository } from './repository/base';
import type { FileStorage } from './storage/base';
import { aesGcmFileEncryptor } from './encryption';
import { FileStorageError } from './errors';
import { OperationRepository } from './operations/repository';
import { OperationCoordinator } from './operations/coordinator';
import { publicOperation, type Operation } from './operations/model';
import { idempotencyKeySchema, uploadFileRequestSchema } from '../contracts/files';

export class FileService {
  constructor(private readonly repository: FileRepository, private readonly storage: FileStorage,
    readonly operations: OperationRepository) {}

  listForOwner(ownerId: string, page: number, pageSize: number) {
    return this.repository.listByOwner(ownerId, page, pageSize);
  }

  async uploadFile(ownerId: string, file: File, key: string, signal?: AbortSignal) {
    uploadFileRequestSchema.parse(file);
    idempotencyKeySchema.parse(key);
    signal?.throwIfAborted();
    const bytes = await file.bytes();
    signal?.throwIfAborted();
    const fingerprint = createHash('sha256').update(JSON.stringify([file.name, file.size])).update(bytes).digest('hex');
    let encrypted;
    try {
      const existing = await this.operations.findByKey(ownerId, 'UPLOAD', key);
      if (existing) return this.uploadResult(existing, fingerprint, true);
      encrypted = aesGcmFileEncryptor.encrypt(bytes);
    } finally { bytes.fill(0); }
    signal?.throwIfAborted()
    let operation;
    try {
      operation = await this.operations.reserve({
        id: randomUUID(), ownedBy: ownerId, filename: file.name, fileSizeBytes: file.size,
        encryptedFileAuthTag: encrypted.encryptedContent.authTag, encryptedFileIV: encrypted.encryptedContent.iv,
        protectedEncryptionKey: encrypted.encryptedDataKey.ciphertext,
        protectedEncryptionKeyIV: encrypted.encryptedDataKey.iv, protectedEncryptionKeyAuthTag: encrypted.encryptedDataKey.authTag,
      }, key, fingerprint);
    } catch (error) {
      // Duplicate upload request race under unique-key loser and unknown COMMIT both resolve by the original key.
      const persisted = await this.operations.findByKey(ownerId, 'UPLOAD', key);
      if (persisted) return this.uploadResult(persisted, fingerprint, true);
      throw error;
    }
    // From this point the request's cancellation signal is deliberately detached.
    const result = await new OperationCoordinator(this.operations, this.storage).upload(operation, encrypted.encryptedContent.ciphertext);
    return this.uploadResult(result, fingerprint, false);
  }

  private uploadResult(operation: Operation, fingerprint: string, repeated: boolean) {
    const body = publicOperation(operation);
    if (operation.inputFingerprint !== fingerprint) return { status: 409, body: { ...body, error: 'IDEMPOTENCY_CONFLICT' } };
    if (operation.status === 'FAILED' || operation.status === 'NEEDS_ATTENTION') return { status: 409, body };
    return { status: operation.status === 'SUCCEEDED' ? (repeated ? 200 : 201) : 202, body };
  }

  async downloadFile(ownerId: string, fileId: string): Promise<File | undefined> {
    const metadata = await this.repository.getFileEncryptionMetadata(fileId, ownerId);
    if (!metadata) return undefined;
    const ciphertext = metadata.storageKey ? await this.storage.get(metadata.storageKey, AbortSignal.timeout(this.operations.config.ioTimeoutMs)) : null;
    if (!ciphertext) {
      console.warn(JSON.stringify({ event: 'ready_blob_missing', fileId }));
      throw new FileStorageError('Stored content is unavailable');
    }
    const plaintext = aesGcmFileEncryptor.decrypt({
      encryptedContent: { iv: metadata.encryptedFileIV, ciphertext, authTag: metadata.encryptedFileAuthTag },
      encryptedDataKey: { iv: metadata.protectedEncryptionKeyIV, ciphertext: metadata.protectedEncryptionKey, authTag: metadata.protectedEncryptionKeyAuthTag },
    });
    try { return new File([plaintext], metadata.filename); } finally { plaintext.fill(0); }
  }

  async deleteFile(ownerId: string, fileId: string) {
    try { return await this.operations.acceptDelete(ownerId, fileId); }
    catch (error) {
      const existing = await this.operations.findDelete(ownerId, fileId);
      if (existing) return existing;
      throw error;
    }
  }
}
