import type { FileStorage } from '../storage/base';
import { aesGcmFileEncryptor } from '../encryption';
import type { OperationRepository } from './repository';
import { OperationLease } from './lease';
import { AttentionError, candidatesOf, errorCode, LeaseLostError, type Metadata, type Operation } from './model';

export function decrypt(metadata: Metadata, ciphertext: Uint8Array<ArrayBuffer>) {
  return aesGcmFileEncryptor.decrypt({
    encryptedContent: { iv: metadata.encryptedFileIV, authTag: metadata.encryptedFileAuthTag, ciphertext },
    encryptedDataKey: { iv: metadata.protectedEncryptionKeyIV, authTag: metadata.protectedEncryptionKeyAuthTag, ciphertext: metadata.protectedEncryptionKey },
  });
}

export class OperationCoordinator {
  constructor(readonly repository: OperationRepository, readonly storage: FileStorage) {}

  async upload(op: Operation, ciphertext: Uint8Array<ArrayBuffer>) {
    const lease = new OperationLease(this.repository, op);
    const candidate = candidatesOf(op)[0];
    try {
      await lease.check();
      await lease.io(signal => this.storage.stage(candidate.partKey, ciphertext, signal));
      await this.repository.phase(op, 'PUBLISH');
      await lease.check();
      await lease.io(() => this.storage.publish(candidate.partKey, candidate.finalKey));
      await lease.check();
      return await this.repository.completeUpload(op, candidate.finalKey);
    } catch (error) {
      await this.handleError(op, error);
      // Only a fresh read can confirm an outcome after any unknown commit.
      const current = await this.repository.find(op.id, op.ownerId);
      if (!current) throw error;
      return current;
    } finally { lease.stop(); }
  }

  async recover(op: Operation, shutdown?: AbortSignal) {
    const lease = new OperationLease(this.repository, op, shutdown);
    try {
      await lease.check();
      if (op.type === 'DELETE') await this.remove(op, lease);
      else await this.recoverUpload(op, lease);
    } catch (error) { await this.handleError(op, error); }
    finally { lease.stop(); }
  }

  private async handleError(op: Operation, error: unknown) {
    // If a commit succeeded or ownership changed, retry() is a no-op via CAS.
    if (error instanceof LeaseLostError) return;
    const code = errorCode(error);
    console.warn(JSON.stringify({ event: 'file_operation_attempt', operationId: op.id, fileId: op.fileId,
      attempt: op.attemptCount, phase: op.phase, code }));
    try { await this.repository.retry(op, code, error instanceof AttentionError); }
    catch { /* DB outcome/ownership unknown: keep candidates and let the lease expire. */ }
  }

  private async recoverUpload(op: Operation, lease: OperationLease) {
    const metadata = await this.repository.metadata(op);
    if (!metadata || metadata.status !== 'UPLOADING' || metadata.currentOperationId !== op.id) throw new AttentionError('METADATA_STATE_MISMATCH');
    let complete: Uint8Array<ArrayBuffer> | undefined;
    let authenticationFailed = false;
    for (const candidate of candidatesOf(op).toReversed()) {
      for (const key of [candidate.finalKey, candidate.partKey]) {
        const bytes = await lease.io(signal => this.storage.get(key, signal));
        if (!bytes || bytes.length !== metadata.fileSizeBytes) continue;
        try {
          // Authenticate a snapshot; never publish a previous writer's mutable inode.
          const plaintext = decrypt(metadata, bytes);
          plaintext.fill(0);
          complete = bytes;
          break;
        } catch { authenticationFailed = true; }
      }
      if (complete) break;
    }
    if (!complete) {
      if (authenticationFailed) throw new AttentionError('AUTHENTICATION_OR_KEY_FAILURE');
      // Missing bytes cannot be reconstructed. Housekeeping has its own durable
      // attempts, so a cleanup failure never loses the manifest or looks clean.
      await this.repository.failUpload(op);
      return;
    }
    const { operation, candidate } = await this.repository.registerCandidate(op);
    await lease.check();
    await lease.io(signal => this.storage.stage(candidate.partKey, complete!, signal));
    await this.repository.phase(op, 'PUBLISH');
    await lease.check();
    await lease.io(() => this.storage.publish(candidate.partKey, candidate.finalKey));
    await lease.check();
    await this.repository.completeUpload(operation, candidate.finalKey);
  }

  private async remove(op: Operation, lease: OperationLease) {
    const metadata = await this.repository.metadata(op);
    if (!metadata || metadata.status !== 'DELETING' || metadata.currentOperationId !== op.id || !metadata.storageKey) throw new AttentionError('METADATA_STATE_MISMATCH');
    const upload = await this.repository.uploadForFile(op.fileId, op.ownerId);
    const keys = new Set([metadata.storageKey, ...(upload ? candidatesOf(upload).flatMap(c => [c.partKey, c.finalKey]) : [])]);
    for (const key of keys) {
      await lease.check();
      await lease.io(() => this.storage.delete(key));
    }
    await lease.check();
    await this.repository.completeDelete(op);
  }

  async cleanup(op: Operation) {
    try {
      let deferMs = 0;
      for (const candidate of candidatesOf(op)) {
        for (const key of [candidate.partKey, candidate.finalKey]) {
          if (await this.repository.cleanupAllowed(op, key)) {
            const stat = await this.boundedIO(() => this.storage.inspect(key));
            if (stat) {
              const age = (await this.repository.now()).getTime() - stat.modifiedAt.getTime();
              if (age < this.repository.config.graceMs) {
                deferMs = Math.max(deferMs, this.repository.config.graceMs - age);
                continue;
              }
            }
            await this.boundedIO(() => this.storage.delete(key));
          }
        }
      }
      if (deferMs) await this.repository.deferCleanup(op, deferMs);
      else await this.repository.finishCleanup(op);
    } catch (error) {
      if (!(error instanceof LeaseLostError)) await this.repository.finishCleanup(op, errorCode(error));
    }
  }
  private async boundedIO<T>(action: () => Promise<T>) {
    let timer: ReturnType<typeof setTimeout>;
    try {
      return await Promise.race([action(), new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('IO_TIMEOUT')), this.repository.config.ioTimeoutMs);
      })]);
    } finally { clearTimeout(timer!); }
  }
  private scanIterator: AsyncIterator<{ key: string; modifiedAt: Date }> | undefined;
  /** Bounded, resumable scan catches registered generations appearing after cleanup. */
  async scan() {
    this.scanIterator ??= this.storage.generations()[Symbol.asyncIterator]();
    const now = await this.repository.now();
    for (let count = 0; count < 100; count++) {
      const entry = await this.boundedIO(() => this.scanIterator!.next());
      if (entry.done) { this.scanIterator = undefined; return; }
      if (now.getTime() - entry.value.modifiedAt.getTime() < this.repository.config.graceMs) continue;
      const op = await this.repository.uploadForFile(entry.value.key.split('.')[0]);
      if (!op || !['SUCCEEDED','FAILED'].includes(op.status)) continue;
      const metadata = await this.repository.metadata(op);
      if (metadata?.storageKey === entry.value.key) continue;
      if (!candidatesOf(op).some(c => c.partKey === entry.value.key || c.finalKey === entry.value.key)) continue;
      await this.repository.enqueueCleanup(op);
    }
  }
  async close() { await this.scanIterator?.return?.(); }
  async tick(shutdown?: AbortSignal) {
    try {
      const op = await this.repository.claim();
      if (op) await this.recover(op, shutdown);
    } catch { console.warn(JSON.stringify({ event: 'file_worker_cycle', code: 'DEPENDENCY_UNAVAILABLE' })); }
    if (shutdown?.aborted) return;
    try {
      const cleanup = await this.repository.claimCleanup();
      if (cleanup) await this.cleanup(cleanup);
      await this.scan();
    } catch { console.warn(JSON.stringify({ event: 'file_worker_cleanup', code: 'DEPENDENCY_UNAVAILABLE' })); }
  }
}
