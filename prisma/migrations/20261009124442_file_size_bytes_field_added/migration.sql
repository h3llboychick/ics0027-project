/*
  Warnings:

  - Added the required column `fileSizeBytes` to the `file_metadata` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "file_metadata" ADD COLUMN     "fileSizeBytes" INTEGER NOT NULL;
