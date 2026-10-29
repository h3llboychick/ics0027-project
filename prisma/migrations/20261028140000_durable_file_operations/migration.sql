CREATE TYPE "FileStatus" AS ENUM ('UPLOADING','READY','DELETING','FAILED');
CREATE TYPE "FileOperationType" AS ENUM ('UPLOAD','DELETE');
CREATE TYPE "FileOperationStatus" AS ENUM ('PENDING','RUNNING','RETRY_WAIT','SUCCEEDED','FAILED','NEEDS_ATTENTION');
ALTER TABLE file_metadata
  ADD COLUMN status "FileStatus" NOT NULL DEFAULT 'READY',
  ADD COLUMN "statusChangedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "storageKey" TEXT,
  ADD COLUMN "currentOperationId" TEXT;
UPDATE file_metadata SET "storageKey" = id;
ALTER TABLE file_metadata ALTER COLUMN status SET DEFAULT 'UPLOADING';
CREATE UNIQUE INDEX "file_metadata_storageKey_key" ON file_metadata("storageKey");
ALTER TABLE file_metadata DROP CONSTRAINT "file_metadata_ownedBy_fkey";
ALTER TABLE file_metadata ADD CONSTRAINT "file_metadata_ownedBy_fkey" FOREIGN KEY ("ownedBy") REFERENCES "user"(id) ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE TABLE file_operation (
  id TEXT PRIMARY KEY, "ownerId" TEXT NOT NULL, "fileId" TEXT NOT NULL,
  type "FileOperationType" NOT NULL, "idempotencyKey" TEXT NOT NULL, "inputFingerprint" TEXT NOT NULL,
  status "FileOperationStatus" NOT NULL, phase TEXT NOT NULL,
  "attemptCount" INTEGER NOT NULL DEFAULT 0, "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "leaseToken" TEXT, "leaseUntil" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastAttemptAt" TIMESTAMP(3), "finishedAt" TIMESTAMP(3), "lastErrorCode" TEXT, "lastErrorMessage" TEXT,
  result JSONB, candidates JSONB NOT NULL DEFAULT '[]',
  "cleanupStatus" TEXT NOT NULL DEFAULT 'NONE', "cleanupAttemptCount" INTEGER NOT NULL DEFAULT 0,
  "cleanupNextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "cleanupLeaseToken" TEXT, "cleanupLeaseUntil" TIMESTAMP(3), "cleanupErrorCode" TEXT,
  CONSTRAINT "file_operation_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "user"(id) ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "file_operation_ownerId_type_idempotencyKey_key" ON file_operation("ownerId",type,"idempotencyKey");
-- A receipt remains unique even after the target metadata has been removed.
CREATE UNIQUE INDEX "file_operation_one_delete_per_file" ON file_operation("fileId") WHERE type = 'DELETE';
CREATE INDEX "file_operation_fileId_type_idx" ON file_operation("fileId",type);
CREATE INDEX "file_operation_ownerId_idx" ON file_operation("ownerId");
CREATE INDEX "file_operation_status_nextAttemptAt_leaseUntil_idx" ON file_operation(status,"nextAttemptAt","leaseUntil");
CREATE INDEX "file_operation_cleanupStatus_cleanupNextAttemptAt_cleanupLeaseUntil_idx" ON file_operation("cleanupStatus","cleanupNextAttemptAt","cleanupLeaseUntil");
