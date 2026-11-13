import { setTimeout as delay } from 'node:timers/promises';
import { prisma } from './lib/prisma';
import { fileOperationConfig, operationCoordinator, operationRepository, validateFileRuntime } from './lib/files/runtime';
import { diskStorage } from './lib/files/storage/disk-storage';
import { securityLog } from './lib/security/log';

validateFileRuntime();
const shutdown = new AbortController();
let forcedShutdown: ReturnType<typeof setTimeout> | undefined;
function stop() {
  if (shutdown.signal.aborted) return;
  shutdown.abort();
  // A hung dependency must not keep a container alive indefinitely. All work is
  // durable and the next process will recover it after lease expiration.
  forcedShutdown = setTimeout(() => process.exit(0), 15_000);
  forcedShutdown.unref();
}
process.once('SIGTERM', stop);
process.once('SIGINT', stop);
try {
  if (process.argv[2] === '--inspect-legacy') {
    for await (const fileId of diskStorage.legacyKeys()) {
      if (!await operationRepository.storageReferenced(fileId)) {
        securityLog('worker.legacy_blob_unreferenced', { outcome: 'success', fileId });
      }
    }
  } else if (process.argv[2] === '--retry') {
    const id = process.argv[3];
    if (!id || !/^[\da-f-]{36}$/i.test(id)) throw new Error('Pass an operation UUID');
    const result = await operationRepository.requeue(id);
    securityLog('worker.operation_requeued', { outcome: 'success', operationId: result.id, userId: result.ownerId });
  } else {
    securityLog('worker.started', { outcome: 'success' });
    while (!shutdown.signal.aborted) {
      await operationCoordinator.tick(shutdown.signal);
      try { await delay(fileOperationConfig.pollMs, undefined, { signal: shutdown.signal }); }
      catch { break; }
    }
  }
} catch {
  securityLog('worker.failed', { outcome: 'error', code: 'CONFIGURATION_OR_DATABASE_ERROR' });
  process.exitCode = 1;
} finally {
  await operationCoordinator.close();
  await prisma.$disconnect();
  if (forcedShutdown) clearTimeout(forcedShutdown);
}
