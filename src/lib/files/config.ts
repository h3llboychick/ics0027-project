export type FileOperationConfig = ReturnType<typeof readFileOperationConfig>;

export function readFileOperationConfig(env = process.env) {
  function integer(name: string, fallback: number, min = 1, max = 3_600_000) {
    const value = env[name] ?? String(fallback);
    if (!/^\d+$/.test(value) || Number(value) < min || Number(value) > max) {
      throw new Error(`Invalid ${name}`);
    }
    return Number(value);
  }
  const config = {
    leaseMs: integer('FILE_LEASE_MS', 60_000),
    heartbeatMs: integer('FILE_HEARTBEAT_MS', 15_000),
    pollMs: integer('FILE_WORKER_POLL_MS', 5_000),
    uiPollMs: integer('NEXT_PUBLIC_FILE_OPERATION_POLL_MS', 2_000, 100, 60_000),
    maxAttempts: integer('FILE_MAX_ATTEMPTS', 3, 1, 10),
    retryMs: [integer('FILE_RETRY_FIRST_MS', 5_000), integer('FILE_RETRY_SECOND_MS', 30_000)],
    graceMs: integer('FILE_CLEANUP_GRACE_MS', 300_000),
    ioTimeoutMs: integer('FILE_IO_TIMEOUT_MS', 10_000),
    databaseTimeoutMs: integer('FILE_DATABASE_TIMEOUT_MS', 5_000),
    attemptTimeoutMs: integer('FILE_ATTEMPT_TIMEOUT_MS', 120_000),
  };
  if (config.heartbeatMs * 2 >= config.leaseMs || config.ioTimeoutMs >= config.leaseMs ||
      config.databaseTimeoutMs + config.heartbeatMs >= config.leaseMs ||
      config.attemptTimeoutMs <= config.ioTimeoutMs || config.graceMs < config.leaseMs) {
    throw new Error('Invalid file operation timeout relationships');
  }
  return config;
}

export function validateFileEncryptionKey() {
  if (!/^[\da-f]{64}$/i.test(process.env.FILE_ENCRYPTION_KEK ?? '')) {
    throw new Error('FILE_ENCRYPTION_KEK must be a 32-byte hexadecimal key');
  }
}
