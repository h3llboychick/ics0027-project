// Own all destructive fixtures: a fresh local container, database and temp volume.
// Never read .env or connect to the project's database/volume.
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
const name = `ics0027-file-tests-${randomBytes(6).toString('hex')}`;
const password = randomBytes(24).toString('hex');
const storage = await mkdtemp(path.join(os.tmpdir(), 'ics0027-file-tests-'));
function docker(args) {
  const result = spawnSync('docker', args, { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr || 'Docker command failed');
  return result.stdout.trim();
}
try {
  docker(['run', '--detach', '--rm', '--name', name, '-e', `POSTGRES_PASSWORD=${password}`,
    '-e', 'POSTGRES_DB=file_operations_test', '-p', '127.0.0.1::5432', 'postgres:17-alpine']);
  const port = docker(['port', name, '5432/tcp']).split(':').at(-1);
  for (let i = 0; i < 100; i++) {
    const ready = spawnSync('docker', ['exec', name, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres'], { stdio: 'ignore' });
    if (ready.status === 0) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  const env = { ...process.env,
    DATABASE_URL: `postgresql://postgres:${password}@127.0.0.1:${port}/file_operations_test`,
    FILE_OPERATION_TEST_DATABASE: '1', FILE_STORAGE_DIRECTORY: storage,
    FILE_ENCRYPTION_KEK: randomBytes(32).toString('hex'),
    BETTER_AUTH_SECRET: randomBytes(32).toString('hex'), BETTER_AUTH_URL: 'https://localhost:8443',
  };
  const child = spawn(process.execPath, ['--import', './tests/register.mjs', '--test', '--test-concurrency=1', 'tests/integration/file-operations.mjs'],
    { stdio: 'inherit', env });
  const status = await new Promise(resolve => child.once('exit', code => resolve(code ?? 1)));
  process.exitCode = status;
} finally {
  spawnSync('docker', ['rm', '-f', name], { stdio: 'ignore' });
  await rm(storage, { recursive: true, force: true });
}
