import type { FileOperation, FileMetadata } from '@/generated/prisma/client';
import { z } from 'zod';

export type Operation = FileOperation;
export type Metadata = FileMetadata;
const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
export const generationKeyPattern = new RegExp(`^(${uuid})\\.(${uuid})\\.(part|bin)$`, 'i');
export const storageKeyPattern = new RegExp(`^(?:${uuid}|${uuid}\\.${uuid}\\.(?:part|bin))$`, 'i');
const candidateSchema = z.object({
  generation: z.uuid(),
  partKey: z.string().regex(generationKeyPattern),
  finalKey: z.string().regex(generationKeyPattern),
  createdAt: z.iso.datetime(),
});
export type Candidate = z.infer<typeof candidateSchema>;
export function candidatesOf(operation: Operation): Candidate[] {
  const candidates = z.array(candidateSchema).max(32).parse(operation.candidates);
  for (const candidate of candidates) {
    if (candidate.partKey !== `${operation.fileId}.${candidate.generation}.part` ||
        candidate.finalKey !== `${operation.fileId}.${candidate.generation}.bin`) {
      throw new Error('Invalid candidate manifest');
    }
  }
  return candidates;
}
export function candidateFor(fileId: string, generation: string): Candidate {
  return { generation, partKey: `${fileId}.${generation}.part`, finalKey: `${fileId}.${generation}.bin`, createdAt: new Date().toISOString() };
}
export function publicOperation(operation: Operation) {
  return {
    operationId: operation.id, fileId: operation.fileId, type: operation.type,
    status: operation.status, phase: operation.phase,
    error: operation.status === 'FAILED' ? 'UPLOAD_FAILED' :
      operation.status === 'NEEDS_ATTENTION' ? 'OPERATION_NEEDS_ATTENTION' : null,
  };
}
export class LeaseLostError extends Error {
  constructor() { super('Operation lease is no longer confirmed'); }
}
export class AttentionError extends Error {
  constructor(readonly code: string) { super(code); }
}
export function errorCode(error: unknown): string {
  if (error instanceof AttentionError) return error.code;
  if (error instanceof Error && 'code' in error && typeof error.code === 'string') {
    // Never persist arbitrary SQL/provider messages or identifiers.
    const code = error.code;
    if (/^(ENOSPC|EROFS|EIO|EACCES|EPERM|ETIMEDOUT|ECONNRESET|ECONNREFUSED|ENOENT|EEXIST|P\d{4})$/.test(code)) return code;
  }
  return 'DEPENDENCY_UNAVAILABLE';
}
