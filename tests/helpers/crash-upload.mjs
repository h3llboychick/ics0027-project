import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { FileService } from '../../src/lib/files/service.ts';
import { prismaFileRepository } from '../../src/lib/files/repository/prisma-file-repository.ts';
import { operationRepository } from '../../src/lib/files/runtime.ts';
import { createDiskStorage } from '../../src/lib/files/storage/disk-storage.ts';
const phase = process.env.CRASH_PHASE;
const storage = createDiskStorage();
const pause = async () => { process.send({ phase }); await new Promise(() => {}); };
if (phase === 'before-reservation') operationRepository.reserve = pause;
if (phase === 'partial') storage.stage = async (key, bytes) => {
  await fs.mkdir(process.env.FILE_STORAGE_DIRECTORY, { recursive: true });
  const file = await fs.open(path.join(process.env.FILE_STORAGE_DIRECTORY, key), 'wx', 0o600);
  await file.write(bytes.subarray(0, 2)); await file.sync();
  await pause();
};
if (phase === 'part' || phase === 'published') {
  const name = phase === 'part' ? 'stage' : 'publish';
  const original = storage[name].bind(storage);
  storage[name] = async (...args) => { await original(...args); await pause(); };
}
await new FileService(prismaFileRepository, storage, operationRepository).uploadFile(
  'owner', new File(['crash-safe bytes'], `${phase}.txt`), process.env.CRASH_KEY ?? randomUUID());
