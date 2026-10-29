import { operationRepository } from '../../src/lib/files/runtime.ts';
import { OperationCoordinator } from '../../src/lib/files/operations/coordinator.ts';
import { createDiskStorage } from '../../src/lib/files/storage/disk-storage.ts';
const storage = createDiskStorage();
const unlink = storage.delete.bind(storage);
storage.delete = async key => {
  await unlink(key);
  process.send({ unlinked: true });
  await new Promise(() => {});
};
const op = await operationRepository.claim();
if (op?.id !== process.env.DELETE_OP_ID) throw new Error('Unexpected fixture operation');
await new OperationCoordinator(operationRepository, storage).recover(op);
