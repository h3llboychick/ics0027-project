import { randomUUID } from 'node:crypto';
import type { PrismaClient, Prisma } from '@/generated/prisma/client';
import type { CreateFileMetadata } from '../repository/base';
import type { FileOperationConfig } from '../config';
import { candidateFor, candidatesOf, LeaseLostError, type Operation, type Candidate } from './model';

type Transaction = Prisma.TransactionClient;
export class OperationRepository {
  constructor(readonly db: PrismaClient, readonly config: FileOperationConfig) {}

  async now(db: Pick<PrismaClient, '$queryRaw'> = this.db) {
    const rows = await db.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AT TIME ZONE 'UTC' AS now`;
    return rows[0].now;
  }
  find(id: string, ownerId: string) {
    return this.db.fileOperation.findFirst({ where: { id, ownerId } });
  }
  findByKey(ownerId: string, type: 'UPLOAD' | 'DELETE', idempotencyKey: string) {
    return this.db.fileOperation.findUnique({ where: { ownerId_type_idempotencyKey: { ownerId, type, idempotencyKey } } });
  }
  findDelete(ownerId: string, fileId: string) {
    return this.db.fileOperation.findFirst({ where: { ownerId, fileId, type: 'DELETE' } });
  }
  metadata(operation: Operation) {
    return this.db.fileMetadata.findFirst({ where: { id: operation.fileId, ownedBy: operation.ownerId } });
  }
  private transaction<T>(action: (tx: Transaction) => Promise<T>) {
    return this.db.$transaction(action, { maxWait: this.config.databaseTimeoutMs, timeout: this.config.databaseTimeoutMs });
  }
  private async lock(tx: Transaction, op: Operation) {
    const rows = await tx.$queryRaw<Operation[]>`SELECT * FROM file_operation
      WHERE id = ${op.id} AND "ownerId" = ${op.ownerId} AND status = 'RUNNING'
      AND "leaseToken" = ${op.leaseToken} AND "leaseUntil" > (clock_timestamp() AT TIME ZONE 'UTC') FOR UPDATE`;
    if (!rows[0]) throw new LeaseLostError();
    return rows[0];
  }
  async assertOwned(op: Operation) {
    return this.transaction(async tx => { await this.lock(tx, op); });
  }
  async reserve(input: CreateFileMetadata, idempotencyKey: string, inputFingerprint: string) {
    const id = randomUUID(), token = randomUUID();
    const candidate = candidateFor(input.id, token);
    return this.transaction(async tx => {
      const now = (await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AT TIME ZONE 'UTC' AS now`)[0].now;
      const operation = await tx.fileOperation.create({ data: {
        id, ownerId: input.ownedBy, fileId: input.id, type: 'UPLOAD', idempotencyKey, inputFingerprint,
        status: 'RUNNING', phase: 'WRITE', attemptCount: 1, leaseToken: token,
        leaseUntil: new Date(now.getTime() + this.config.leaseMs), lastAttemptAt: now,
        candidates: [candidate],
      } });
      await tx.fileMetadata.create({ data: { ...input, status: 'UPLOADING', currentOperationId: id } });
      return operation;
    });
  }
  async acceptDelete(ownerId: string, fileId: string) {
    return this.transaction(async tx => {
      // Serialize competing intents against the target. The partial unique index
      // also guarantees one receipt after the target row no longer exists.
      await tx.$queryRaw`SELECT id FROM file_metadata WHERE id = ${fileId} AND "ownedBy" = ${ownerId} FOR UPDATE`;
      const previous = await tx.fileOperation.findFirst({ where: { ownerId, fileId, type: 'DELETE' } });
      if (previous) return previous;
      const file = await tx.fileMetadata.findFirst({ where: { id: fileId, ownedBy: ownerId, status: 'READY' } });
      if (!file) return null;
      const id = randomUUID();
      const operation = await tx.fileOperation.create({ data: {
        id, ownerId, fileId, type: 'DELETE', idempotencyKey: fileId, inputFingerprint: fileId,
        status: 'PENDING', phase: 'CLEANUP',
      } });
      await tx.fileMetadata.update({ where: { id: fileId, ownedBy: ownerId, status: 'READY' },
        data: { status: 'DELETING', statusChangedAt: await this.now(tx), currentOperationId: id } });
      return operation;
    });
  }
  async heartbeat(op: Operation) {
    const count = await this.db.$executeRaw`UPDATE file_operation SET
      "leaseUntil" = (clock_timestamp() AT TIME ZONE 'UTC') + ${this.config.leaseMs} * interval '1 millisecond',
      "updatedAt" = (clock_timestamp() AT TIME ZONE 'UTC')
      WHERE id = ${op.id} AND "ownerId" = ${op.ownerId} AND status = 'RUNNING'
      AND "leaseToken" = ${op.leaseToken} AND "leaseUntil" > (clock_timestamp() AT TIME ZONE 'UTC')`;
    if (count !== 1) throw new LeaseLostError();
  }
  async claim() {
    return this.transaction(async tx => {
      const rows = await tx.$queryRaw<Operation[]>`SELECT * FROM file_operation
        WHERE ((status IN ('PENDING','RETRY_WAIT') AND "nextAttemptAt" <= (clock_timestamp() AT TIME ZONE 'UTC'))
        OR (status = 'RUNNING' AND "leaseUntil" <= (clock_timestamp() AT TIME ZONE 'UTC')))
        ORDER BY "nextAttemptAt", "createdAt" LIMIT 1 FOR UPDATE SKIP LOCKED`;
      const op = rows[0];
      if (!op) return null;
      if (op.attemptCount >= this.config.maxAttempts) {
        await tx.fileOperation.update({ where: { id: op.id }, data: {
          status: 'NEEDS_ATTENTION', lastErrorCode: 'ATTEMPTS_EXHAUSTED',
          lastErrorMessage: 'Automatic attempts exhausted', leaseToken: null, leaseUntil: null, finishedAt: await this.now(tx),
        } });
        return null;
      }
      const token = randomUUID();
      const now = await this.now(tx);
      return tx.fileOperation.update({ where: { id: op.id }, data: {
        status: 'RUNNING', attemptCount: { increment: 1 }, leaseToken: token,
        leaseUntil: new Date(now.getTime() + this.config.leaseMs), lastAttemptAt: now,
      } });
    });
  }
  async registerCandidate(op: Operation): Promise<{ operation: Operation; candidate: Candidate }> {
    return this.transaction(async tx => {
      const current = await this.lock(tx, op);
      const candidates = candidatesOf(current);
      if (candidates.length >= 32) throw new Error('Candidate limit reached; manual inspection required');
      const candidate = candidateFor(op.fileId, op.leaseToken!);
      const operation = await tx.fileOperation.update({ where: { id: op.id, ownerId: op.ownerId }, data: {
        candidates: [...candidates, candidate], phase: 'WRITE',
      } });
      return { operation, candidate };
    });
  }
  async phase(op: Operation, phase: string) {
    return this.transaction(async tx => {
      await this.lock(tx, op);
      return tx.fileOperation.update({ where: { id: op.id, ownerId: op.ownerId }, data: { phase } });
    });
  }
  async completeUpload(op: Operation, storageKey: string) {
    return this.transaction(async tx => {
      const current = await this.lock(tx, op);
      if (!candidatesOf(current).some(c => c.finalKey === storageKey && c.generation === op.leaseToken)) throw new LeaseLostError();
      const now = await this.now(tx);
      const updated = await tx.fileMetadata.updateMany({ where: {
        id: op.fileId, ownedBy: op.ownerId, status: 'UPLOADING', currentOperationId: op.id,
      }, data: { status: 'READY', storageKey, statusChangedAt: now } });
      if (updated.count !== 1) throw new LeaseLostError();
      await this.lock(tx, op);
      return tx.fileOperation.update({ where: { id: op.id, ownerId: op.ownerId }, data: {
        status: 'SUCCEEDED', phase: 'FINALIZE', finishedAt: now, leaseToken: null, leaseUntil: null,
        result: { fileId: op.fileId }, lastErrorCode: null, lastErrorMessage: null,
        cleanupStatus: 'PENDING', cleanupNextAttemptAt: new Date(now.getTime() + this.config.graceMs),
      } });
    });
  }
  async completeDelete(op: Operation) {
    return this.transaction(async tx => {
      await this.lock(tx, op);
      const removed = await tx.fileMetadata.deleteMany({ where: {
        id: op.fileId, ownedBy: op.ownerId, status: 'DELETING', currentOperationId: op.id,
      } });
      if (removed.count !== 1) throw new LeaseLostError();
      await this.lock(tx, op);
      return tx.fileOperation.update({ where: { id: op.id, ownerId: op.ownerId }, data: {
        status: 'SUCCEEDED', phase: 'FINALIZE', finishedAt: await this.now(tx), leaseToken: null, leaseUntil: null,
        lastErrorCode: null, lastErrorMessage: null, result: { fileId: op.fileId },
      } });
    });
  }
  async failUpload(op: Operation) {
    return this.transaction(async tx => {
      await this.lock(tx, op);
      const now = await this.now(tx);
      const result = await tx.fileMetadata.updateMany({ where: {
        id: op.fileId, ownedBy: op.ownerId, status: 'UPLOADING', currentOperationId: op.id,
      }, data: { status: 'FAILED', statusChangedAt: now } });
      if (result.count !== 1) throw new LeaseLostError();
      await this.lock(tx, op);
      return tx.fileOperation.update({ where: { id: op.id, ownerId: op.ownerId }, data: {
        status: 'FAILED', phase: 'CLEANUP', finishedAt: now, leaseToken: null, leaseUntil: null,
        lastErrorCode: 'UPLOAD_INCOMPLETE', lastErrorMessage: 'Original bytes must be sent again',
        cleanupStatus: 'PENDING', cleanupNextAttemptAt: new Date(now.getTime() + this.config.graceMs),
      } });
    });
  }
  async retry(op: Operation, code: string, attention = false) {
    return this.transaction(async tx => {
      await this.lock(tx, op);
      const terminal = attention || op.attemptCount >= this.config.maxAttempts;
      const now = await this.now(tx);
      return tx.fileOperation.update({ where: { id: op.id, ownerId: op.ownerId }, data: {
        status: terminal ? 'NEEDS_ATTENTION' : 'RETRY_WAIT', lastErrorCode: code,
        lastErrorMessage: 'File operation requires recovery', leaseToken: null, leaseUntil: null,
        nextAttemptAt: new Date(now.getTime() + this.config.retryMs[Math.min(op.attemptCount - 1, 1)]),
        finishedAt: terminal ? now : null,
      } });
    });
  }
  async uploadForFile(fileId: string, ownerId?: string) {
    return this.db.fileOperation.findFirst({ where: { fileId, ownerId, type: 'UPLOAD' } });
  }
  async claimCleanup() {
    return this.transaction(async tx => {
      const rows = await tx.$queryRaw<Operation[]>`SELECT * FROM file_operation
        WHERE status IN ('SUCCEEDED','FAILED') AND
        (("cleanupStatus" = 'PENDING' AND "cleanupNextAttemptAt" <= (clock_timestamp() AT TIME ZONE 'UTC')) OR
         ("cleanupStatus" = 'RUNNING' AND "cleanupLeaseUntil" <= (clock_timestamp() AT TIME ZONE 'UTC')))
        ORDER BY "cleanupNextAttemptAt" LIMIT 1 FOR UPDATE SKIP LOCKED`;
      const op = rows[0];
      if (!op) return null;
      if (op.cleanupAttemptCount >= this.config.maxAttempts) {
        await tx.fileOperation.update({ where: { id: op.id }, data: { cleanupStatus: 'NEEDS_ATTENTION', cleanupLeaseToken: null, cleanupLeaseUntil: null } });
        return null;
      }
      return tx.fileOperation.update({ where: { id: op.id }, data: {
        cleanupStatus: 'RUNNING', cleanupAttemptCount: { increment: 1 }, cleanupLeaseToken: randomUUID(),
        cleanupLeaseUntil: new Date((await this.now(tx)).getTime() + this.config.leaseMs),
      } });
    });
  }
  async cleanupAllowed(op: Operation, key: string) {
    const current = await this.find(op.id, op.ownerId);
    const now = await this.now();
    if (!current || current.cleanupLeaseToken !== op.cleanupLeaseToken || current.cleanupStatus !== 'RUNNING' ||
        !current.cleanupLeaseUntil || current.cleanupLeaseUntil <= now) throw new LeaseLostError();
    if (!candidatesOf(current).some(c => c.partKey === key || c.finalKey === key)) throw new LeaseLostError();
    const file = await this.metadata(op);
    // A chosen generation is immutable forever; deleting it is the DELETE job's responsibility.
    if (await this.storageReferenced(key) || file?.status === 'UPLOADING' || file?.status === 'DELETING' ||
        (file && file.currentOperationId !== op.id)) return false;
    return true;
  }
  private async lockCleanup(tx: Transaction, op: Operation) {
    const rows = await tx.$queryRaw<Operation[]>`SELECT * FROM file_operation WHERE id = ${op.id}
      AND "ownerId" = ${op.ownerId} AND "cleanupStatus" = 'RUNNING'
      AND "cleanupLeaseToken" = ${op.cleanupLeaseToken}
      AND "cleanupLeaseUntil" > (clock_timestamp() AT TIME ZONE 'UTC') FOR UPDATE`;
    if (!rows[0]) throw new LeaseLostError();
  }
  async finishCleanup(op: Operation, code?: string) {
    return this.transaction(async tx => {
      await this.lockCleanup(tx, op);
      const terminal = op.cleanupAttemptCount >= this.config.maxAttempts;
      return tx.fileOperation.update({ where: { id: op.id, ownerId: op.ownerId }, data: {
        cleanupStatus: code ? (terminal ? 'NEEDS_ATTENTION' : 'PENDING') : 'DONE',
        cleanupErrorCode: code ?? null, cleanupLeaseToken: null, cleanupLeaseUntil: null,
        cleanupNextAttemptAt: new Date((await this.now(tx)).getTime() + this.config.retryMs[Math.min(op.cleanupAttemptCount - 1, 1)]),
      } });
    });
  }
  async deferCleanup(op: Operation, delayMs: number) {
    return this.transaction(async tx => {
      await this.lockCleanup(tx, op);
      return tx.fileOperation.update({ where: { id: op.id, ownerId: op.ownerId }, data: {
        cleanupStatus: 'PENDING', cleanupAttemptCount: { decrement: 1 },
        cleanupLeaseToken: null, cleanupLeaseUntil: null,
        cleanupNextAttemptAt: new Date((await this.now(tx)).getTime() + delayMs),
      } });
    });
  }
  async storageReferenced(storageKey: string) {
    return !!await this.db.fileMetadata.findFirst({ where: { storageKey }, select: { id: true } });
  }
  async enqueueCleanup(op: Operation) {
    await this.db.fileOperation.updateMany({ where: {
      id: op.id, ownerId: op.ownerId, status: { in: ['SUCCEEDED','FAILED'] }, cleanupStatus: { in: ['NONE','DONE'] },
    }, data: { cleanupStatus: 'PENDING', cleanupAttemptCount: 0, cleanupNextAttemptAt: await this.now() } });
  }
  /** Local operator command only; retained key material/manifest is never discarded. */
  async requeue(id: string) {
    return this.transaction(async tx => {
      const rows = await tx.$queryRaw<Operation[]>`SELECT * FROM file_operation WHERE id = ${id} FOR UPDATE`;
      const op = rows[0];
      if (!op) throw new Error('Operation not found');
      if (op.status === 'NEEDS_ATTENTION') {
        if (candidatesOf(op).length >= 32) throw new Error('Inspect the candidate manifest before further attempts');
        return tx.fileOperation.update({ where: { id }, data: { status: 'RETRY_WAIT', attemptCount: 0, nextAttemptAt: await this.now(tx), finishedAt: null } });
      }
      if (op.cleanupStatus === 'NEEDS_ATTENTION') {
        return tx.fileOperation.update({ where: { id }, data: { cleanupStatus: 'PENDING', cleanupAttemptCount: 0, cleanupNextAttemptAt: await this.now(tx) } });
      }
      throw new Error('Only operations requiring attention may be requeued');
    });
  }
}
