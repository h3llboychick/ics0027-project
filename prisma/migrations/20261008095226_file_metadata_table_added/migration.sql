-- CreateTable
CREATE TABLE "file_metadata" (
    "id" TEXT NOT NULL,
    "ownedBy" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "encryptedFileAuthTag" BYTEA NOT NULL,
    "encryptedFileIV" BYTEA NOT NULL,
    "protectedEncryptionKey" BYTEA NOT NULL,
    "protectedEncryptionKeyIV" BYTEA NOT NULL,
    "protectedEncryptionKeyAuthTag" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "file_metadata_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "file_metadata_ownedBy_idx" ON "file_metadata"("ownedBy");

-- AddForeignKey
ALTER TABLE "file_metadata" ADD CONSTRAINT "file_metadata_ownedBy_fkey" FOREIGN KEY ("ownedBy") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
