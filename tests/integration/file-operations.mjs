import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fork } from 'node:child_process';
import pg from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../src/generated/prisma/client.ts';
import { prisma } from '../../src/lib/prisma.ts';
import { FileService } from '../../src/lib/files/service.ts';
import { prismaFileRepository } from '../../src/lib/files/repository/prisma-file-repository.ts';
import { createDiskStorage } from '../../src/lib/files/storage/disk-storage.ts';
import { operationRepository as repo } from '../../src/lib/files/runtime.ts';
import { OperationRepository } from '../../src/lib/files/operations/repository.ts';
import { OperationCoordinator } from '../../src/lib/files/operations/coordinator.ts';
import { candidatesOf, publicOperation } from '../../src/lib/files/operations/model.ts';
import { aesGcmFileEncryptor } from '../../src/lib/files/encryption.ts';
import { faultProxy } from '../helpers/fault-proxy.mjs';

assert.equal(process.env.FILE_OPERATION_TEST_DATABASE, '1', 'Use pnpm test:integration (owns isolated fixtures)');
const database = new URL(process.env.DATABASE_URL);
assert.equal(database.pathname, '/file_operations_test');
assert.equal(database.hostname, '127.0.0.1');
const admin = new pg.Client({ connectionString: database.href });
const storage = createDiskStorage();
const service = new FileService(prismaFileRepository, storage, repo);
const worker = new OperationCoordinator(repo, storage);
const legacyId = randomUUID();
const file = (name = 'file.txt') => new File(['private test bytes'], name);
const key = () => randomUUID();
const owned = id => repo.find(id, 'owner');
async function expire(id) { await admin.query('UPDATE file_operation SET "leaseUntil"=NOW()-interval \'1 minute\', "nextAttemptAt"=NOW()-interval \'1 minute\' WHERE id=$1', [id]); }
async function due(id) { await admin.query('UPDATE file_operation SET "nextAttemptAt"=NOW()-interval \'1 minute\', "cleanupNextAttemptAt"=NOW()-interval \'1 minute\' WHERE id=$1', [id]); }
async function upload(name = 'file.txt') { return service.uploadFile('owner', file(name), key()); }
async function ageCandidates(id) {
  const old = new Date(Date.now() - repo.config.graceMs - 10000);
  for (const c of candidatesOf(await owned(id))) {
    for (const key of [c.partKey, c.finalKey]) {
      try { await fs.utimes(path.join(process.env.FILE_STORAGE_DIRECTORY, key), old, old); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
  }
}
async function cleanup(id) {
  await ageCandidates(id);
  await due(id);
  const op = await repo.claimCleanup();
  assert.equal(op?.id, id);
  await worker.cleanup(op);
}

before(async () => {
  await admin.connect();
  assert.equal((await admin.query("SELECT count(*)::int AS n FROM pg_tables WHERE schemaname='public'")).rows[0].n, 0);
  const migrations = 'prisma/migrations';
  for (const name of (await fs.readdir(migrations)).sort()) {
    const source = path.join(migrations, name, 'migration.sql');
    if (!existsSync(source)) continue;
    if (name.includes('durable_file_operations')) {
      await admin.query('INSERT INTO "user" (id,name,email,"updatedAt") VALUES ($1,$1,$2,NOW()),($3,$3,$4,NOW())', ['owner','owner@example.test','other','other@example.test']);
      const encrypted = aesGcmFileEncryptor.encrypt(Buffer.from('legacy content'));
      await fs.writeFile(path.join(process.env.FILE_STORAGE_DIRECTORY, legacyId), encrypted.encryptedContent.ciphertext);
      await admin.query(`INSERT INTO file_metadata (id,"ownedBy",filename,"fileSizeBytes","encryptedFileAuthTag","encryptedFileIV","protectedEncryptionKey","protectedEncryptionKeyIV","protectedEncryptionKeyAuthTag") VALUES ($1,'owner','legacy.txt',14,$2,$3,$4,$5,$6)`,
        [legacyId, encrypted.encryptedContent.authTag, encrypted.encryptedContent.iv, encrypted.encryptedDataKey.ciphertext, encrypted.encryptedDataKey.iv, encrypted.encryptedDataKey.authTag]);
    }
    await admin.query(await fs.readFile(source, 'utf8'));
  }
});
after(async () => { await worker.close(); await prisma.$disconnect(); await admin.end(); });

test('AC-18: legacy migration preserves encryption metadata and old paths; account deletion is restricted', async () => {
  const metadata = await prisma.fileMetadata.findUnique({ where: { id: legacyId } });
  assert.equal(metadata.status, 'READY'); assert.equal(metadata.storageKey, legacyId);
  assert.equal(await (await service.downloadFile('owner', legacyId)).text(), 'legacy content');
  await assert.rejects(prisma.user.delete({ where: { id: 'owner' } }));
});

test('AC-01/06/14: durable reservation before disk, idempotent concurrency, conflict and owner isolation', async () => {
  let checked = false;
  const strictStorage = { ...storage, stage: async (...args) => {
    const id = args[0].split('.')[0];
    const metadata = await prisma.fileMetadata.findUnique({ where: { id } });
    assert.equal(metadata.status, 'UPLOADING');
    assert.equal((await owned(metadata.currentOperationId)).status, 'RUNNING');
    checked = true;
    return storage.stage(...args);
  } };
  const strictService = new FileService(prismaFileRepository, strictStorage, repo);
  const token = key();
  const results = await Promise.all([strictService.uploadFile('owner', file(), token), strictService.uploadFile('owner', file(), token)]);
  assert.equal(checked, true);
  assert.equal(results.filter(r => r.status === 201).length, 1);
  assert.equal(results[0].body.fileId, results[1].body.fileId);
  const id = results[0].body.fileId;
  assert.equal(await (await service.downloadFile('owner', id)).text(), 'private test bytes');
  assert.equal((await service.uploadFile('owner', file(), token)).status, 200);
  assert.equal((await service.uploadFile('owner', new File(['other'], 'file.txt'), token)).body.error, 'IDEMPOTENCY_CONFLICT');
  assert.equal(await service.downloadFile('other', id), undefined);
  assert.equal(await service.deleteFile('other', id), null);
  assert.equal(await repo.find(results[0].body.operationId, 'other'), null);
  assert.equal(await repo.findByKey('other', 'UPLOAD', token), null);
  assert.deepEqual(Object.keys(publicOperation(await owned(results[0].body.operationId))).sort(), ['error','fileId','operationId','phase','status','type']);
});

for (const phase of ['before-reservation','partial','part','published']) {
  test(`AC-02/03/04: SIGKILL at ${phase} leaves a discoverable recoverable outcome`, async () => {
    const token = key();
    const child = fork('tests/helpers/crash-upload.mjs', [], {
      execArgv: ['--import', './tests/register.mjs'], env: { ...process.env, CRASH_PHASE: phase, CRASH_KEY: token }, stdio: ['ignore','ignore','inherit','ipc'],
    });
    await new Promise((resolve, reject) => {
      child.once('message', resolve); child.once('exit', code => reject(new Error(`Child exited early: ${code}`)));
      child.once('error', reject);
    });
    child.kill('SIGKILL'); await new Promise(resolve => child.once('exit', resolve));
    const op = await repo.findByKey('owner', 'UPLOAD', token);
    if (phase === 'before-reservation') { assert.equal(op, null); return; }
    assert.equal(op.status, 'RUNNING');
    // Active leases protect even an obviously partial artifact.
    assert.equal(await repo.claim(), null);
    await expire(op.id);
    const claimed = await repo.claim(); assert.equal(claimed.id, op.id);
    await worker.recover(claimed);
    const result = await owned(op.id);
    assert.equal(result.status, phase === 'partial' ? 'FAILED' : 'SUCCEEDED');
    if (phase !== 'partial') assert.equal(await (await service.downloadFile('owner', op.fileId)).text(), 'crash-safe bytes');
    await cleanup(op.id);
  });
}

test('AC-08/17: late publication after takeover cannot change READY or destroy selected bytes', async () => {
  let release, paused;
  const barrier = new Promise(resolve => { paused = resolve; });
  const late = new Promise(resolve => { release = resolve; });
  const blockedStorage = { ...storage, publish: async (...args) => { paused(); await late; await storage.publish(...args); } };
  const token = key();
  const request = new FileService(prismaFileRepository, blockedStorage, repo).uploadFile('owner', file('late.txt'), token);
  await barrier;
  const original = await repo.findByKey('owner', 'UPLOAD', token);
  await expire(original.id);
  const claimed = await repo.claim();
  await worker.recover(claimed);
  const selected = await repo.metadata(claimed);
  assert.equal(selected.status, 'READY');
  assert.notEqual(selected.storageKey, candidatesOf(original)[0].finalKey);
  await assert.rejects(repo.heartbeat(original));
  await assert.rejects(repo.completeUpload(original, candidatesOf(original)[0].finalKey));
  release(); await request;
  await cleanup(original.id);
  assert.equal(await (await service.downloadFile('owner', original.fileId)).text(), 'private test bytes');
  assert.equal(await storage.get(candidatesOf(original)[0].finalKey), null);
});

test('AC-09/10/11: concurrent DELETE creates one intent; SQL failure after unlink preserves hidden metadata and receipt', async () => {
  const uploaded = await upload('delete-trigger.txt');
  const [first, second] = await Promise.all([service.deleteFile('owner', uploaded.body.fileId), service.deleteFile('owner', uploaded.body.fileId)]);
  assert.equal(first.id, second.id);
  assert.equal(await service.downloadFile('owner', first.fileId), undefined);
  await admin.query(`CREATE FUNCTION reject_test_delete() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected'; END $$;
    CREATE TRIGGER reject_test_delete BEFORE DELETE ON file_metadata FOR EACH ROW EXECUTE FUNCTION reject_test_delete();`);
  try { await worker.recover(await repo.claim()); }
  finally { await admin.query('DROP TRIGGER reject_test_delete ON file_metadata; DROP FUNCTION reject_test_delete()'); }
  assert.equal((await owned(first.id)).status, 'RETRY_WAIT');
  assert.equal((await repo.metadata(first)).status, 'DELETING');
  assert.equal(await storage.get((await repo.metadata(first)).storageKey), null);
  await due(first.id); await worker.recover(await repo.claim());
  assert.equal((await owned(first.id)).status, 'SUCCEEDED');
  assert.equal(await repo.metadata(first), null);
  assert.equal((await service.deleteFile('owner', first.fileId)).id, first.id);
});

test('AC-12/19/20: ENOSPC and cleanup EROFS retain residue; backoff and three attempts persist, worker continues', async () => {
  const badStorage = { ...storage, stage: async (key, contents) => {
    await fs.writeFile(path.join(process.env.FILE_STORAGE_DIRECTORY, key), contents.subarray(0, 2));
    throw Object.assign(new Error('sensitive device detail'), { code: 'ENOSPC' });
  } };
  const result = await new FileService(prismaFileRepository, badStorage, repo).uploadFile('owner', file('disk-full.txt'), key());
  let op = await owned(result.body.operationId);
  assert.equal(result.status, 202); assert.equal(op.attemptCount, 1); assert.equal(op.lastErrorCode, 'ENOSPC');
  assert.equal(op.nextAttemptAt.getTime() - op.updatedAt.getTime() >= 4900, true);
  await due(op.id); await worker.recover(await repo.claim());
  op = await owned(op.id); assert.equal(op.status, 'FAILED');
  await due(op.id);
  await ageCandidates(op.id);
  const brokenCleanup = new OperationCoordinator(repo, { ...storage, delete: async () => { throw Object.assign(new Error('sensitive'), { code: 'EROFS' }); } });
  for (let attempt = 1; attempt <= 3; attempt++) {
    await brokenCleanup.cleanup(await repo.claimCleanup()); await due(op.id);
  }
  op = await owned(op.id);
  assert.equal(op.cleanupStatus, 'NEEDS_ATTENTION'); assert.equal(op.cleanupAttemptCount, 3); assert.equal(op.cleanupErrorCode, 'EROFS');
  assert.equal((await storage.get(candidatesOf(op)[0].partKey)).length, 2);
  await repo.requeue(op.id); await cleanup(op.id);
  const uploaded = await upload('retry-delete.txt');
  const deletion = await service.deleteFile('owner', uploaded.body.fileId);
  const brokenWorker = new OperationCoordinator(repo, { ...storage, delete: async () => { throw Object.assign(new Error('sensitive'), { code: 'EIO' }); } });
  for (let attempt = 1; attempt <= 3; attempt++) { await brokenWorker.recover(await repo.claim()); await due(deletion.id); }
  op = await owned(deletion.id);
  assert.equal(op.status, 'NEEDS_ATTENTION'); assert.equal(op.attemptCount, 3);
  assert.equal(await repo.claim(), null);
  assert.equal((await upload('next-valid-job.txt')).status, 201);
  await repo.requeue(op.id); await worker.recover(await repo.claim());
  assert.equal((await owned(op.id)).status, 'SUCCEEDED');
});

test('AC-13: full corrupted ciphertext and wrong KEK are retained for attention', async () => {
  for (const wrongKey of [false, true]) {
    const storageFailure = { ...storage, publish: async () => { throw Object.assign(new Error(), { code: 'EIO' }); } };
    const result = await new FileService(prismaFileRepository, storageFailure, repo).uploadFile('owner', file('auth.txt'), key());
    const op = await owned(result.body.operationId), candidate = candidatesOf(op)[0];
    const bytes = await storage.get(candidate.partKey);
    const oldKey = process.env.FILE_ENCRYPTION_KEK;
    if (wrongKey) process.env.FILE_ENCRYPTION_KEK = 'f'.repeat(64);
    else { bytes[0] ^= 1; await fs.writeFile(path.join(process.env.FILE_STORAGE_DIRECTORY, candidate.partKey), bytes); }
    try { await due(op.id); await worker.recover(await repo.claim()); }
    finally { process.env.FILE_ENCRYPTION_KEK = oldKey; }
    assert.equal((await owned(op.id)).status, 'NEEDS_ATTENTION');
    assert.equal(await service.downloadFile('owner', op.fileId), undefined);
    assert.ok(await storage.get(candidate.partKey));
  }
});

test('AC-05/10: dropped TCP COMMIT acknowledgements for reservation, READY and DELETE preserve recoverable data', async () => {
  const proxy = await faultProxy(database.href);
  const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: proxy.url, connectionTimeoutMillis: 2000, statement_timeout: 5000 }) });
  const proxiedRepo = new OperationRepository(client, repo.config);
  const proxiedService = new FileService(prismaFileRepository, storage, proxiedRepo);
  try {
    let token = key();
    proxy.arm(text => /INSERT INTO.*file_operation/i.test(text));
    let result = await proxiedService.uploadFile('owner', file('lost-reservation-ack.txt'), token);
    assert.equal(proxy.dropped, 1); assert.equal(result.status, 202);
    let op = await repo.findByKey('owner', 'UPLOAD', token);
    assert.equal(op.status, 'RUNNING'); assert.equal(await storage.get(candidatesOf(op)[0].partKey), null);
    await expire(op.id); await worker.recover(await repo.claim());
    assert.equal((await owned(op.id)).status, 'FAILED');
    token = key();
    proxy.arm(text => /UPDATE.*file_metadata/i.test(text) && /READY/.test(text));
    result = await proxiedService.uploadFile('owner', file('lost-ready-ack.txt'), token);
    assert.equal(proxy.dropped, 2); assert.equal(result.body.status, 'SUCCEEDED');
    assert.equal(await (await service.downloadFile('owner', result.body.fileId)).text(), 'private test bytes');
    const deletion = await service.deleteFile('owner', result.body.fileId);
    proxy.arm(text => /DELETE FROM.*file_metadata/i.test(text));
    await new OperationCoordinator(proxiedRepo, storage).recover(await proxiedRepo.claim());
    assert.equal(proxy.dropped, 3); assert.equal((await owned(deletion.id)).status, 'SUCCEEDED');
    assert.equal(await repo.metadata(deletion), null);
  } finally { await client.$disconnect(); await proxy.close(); }
});

test('AC-15: cancellation before reservation creates no blob, cancellation after acceptance preserves the operation', async () => {
  const early = new AbortController(); early.abort();
  const earlyKey = key();
  await assert.rejects(service.uploadFile('owner', file('early-cancel.txt'), earlyKey, early.signal));
  assert.equal(await repo.findByKey('owner', 'UPLOAD', earlyKey), null);
  const late = new AbortController();
  const token = key();
  const signalStorage = { ...storage, stage: async (...args) => { late.abort(); return storage.stage(...args); } };
  const result = await new FileService(prismaFileRepository, signalStorage, repo).uploadFile('owner', file('late-cancel.txt'), token, late.signal);
  assert.equal(result.status, 201); assert.equal(late.signal.aborted, true);
  assert.equal((await repo.findByKey('owner', 'UPLOAD', token)).status, 'SUCCEEDED');
});

test('AC-07: heartbeat uses database time, does not change status time, and cannot resurrect an expired token', async () => {
  const token = key();
  const stopped = { ...storage, stage: async () => { throw Object.assign(new Error(), { code: 'EIO' }); } };
  const result = await new FileService(prismaFileRepository, stopped, repo).uploadFile('owner', file('heartbeat.txt'), token);
  await due(result.body.operationId);
  const op = await repo.claim();
  const before = await repo.metadata(op);
  await admin.query('UPDATE file_operation SET "leaseUntil"=NOW()+interval \'2 seconds\' WHERE id=$1', [op.id]);
  await repo.heartbeat(op);
  const renewed = await owned(op.id);
  assert.ok(renewed.leaseUntil.getTime() - (await repo.now()).getTime() > 59000);
  assert.equal((await repo.metadata(op)).statusChangedAt.getTime(), before.statusChangedAt.getTime());
  assert.equal(await repo.claim(), null);
  await expire(op.id);
  await assert.rejects(repo.heartbeat(op));
  await worker.recover(await repo.claim());
});

test('AC-17: late artifacts are rediscovered after cleanup and deletion; unknown legacy orphans remain untouched', async () => {
  const result = await upload('scan.txt');
  const op = await owned(result.body.operationId);
  const candidate = candidatesOf(op)[0];
  await cleanup(op.id);
  const legacyOrphan = randomUUID();
  await fs.writeFile(path.join(process.env.FILE_STORAGE_DIRECTORY, legacyOrphan), 'unknown legacy ciphertext');
  const deletion = await service.deleteFile('owner', op.fileId);
  await worker.recover(await repo.claim());
  assert.equal((await owned(deletion.id)).status, 'SUCCEEDED');
  // An old, non-cancelable write completes after deletion and housekeeping.
  await fs.writeFile(path.join(process.env.FILE_STORAGE_DIRECTORY, candidate.partKey), 'late residue');
  const old = new Date(Date.now() - repo.config.graceMs - 10000);
  await fs.utimes(path.join(process.env.FILE_STORAGE_DIRECTORY, candidate.partKey), old, old);
  await worker.scan();
  assert.equal((await owned(op.id)).cleanupStatus, 'PENDING');
  await cleanup(op.id);
  assert.equal(await storage.get(candidate.partKey), null);
  assert.equal(await fs.readFile(path.join(process.env.FILE_STORAGE_DIRECTORY, legacyOrphan), 'utf8'), 'unknown legacy ciphertext');
});

test('AC-19: a real worker process shuts down while idle without losing accepted work', async () => {
  const child = fork('dist/worker/worker.js', [], { execArgv: [], env: { ...process.env, FILE_WORKER_POLL_MS: '100' }, silent: true });
  let output = '';
  await new Promise((resolve, reject) => {
    child.stdout.on('data', bytes => { output += bytes; if (output.includes('file_worker_started')) resolve(); });
    child.once('error', reject); child.once('exit', code => reject(new Error(`Worker exited early: ${code}`)));
  });
  child.kill('SIGTERM');
  const code = await new Promise(resolve => child.once('exit', resolve));
  assert.equal(code, 0);
});

test('AC-01/09/14/15: actual route handlers enforce session/owner, safe statuses and cancellation', async () => {
  const { registerHooks } = await import('node:module');
  const hook = registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier === 'next/server') return nextResolve('next/server.js', context);
      if (specifier === '@/lib/auth-guard') return { url: 'test:auth', shortCircuit: true };
      return nextResolve(specifier, context);
    },
    load(url, context, nextLoad) {
      if (url === 'test:auth') return { shortCircuit: true, format: 'module', source: `
        export class UnauthenticatedError extends Error {};
        export async function requireUser(request) {
          const id = request.headers.get('x-test-owner');
          if (!id) throw new UnauthenticatedError();
          return { user: { id } };
        }` };
      return nextLoad(url, context);
    },
  });
  try {
    const { NextRequest } = await import('next/server.js');
    const files = await import('../../src/app/api/files/route.ts');
    const detail = await import('../../src/app/api/files/[fileId]/route.ts');
    const operations = await import('../../src/app/api/file-operations/route.ts');
    const operation = await import('../../src/app/api/file-operations/[operationId]/route.ts');
    const request = (url, owner = 'owner', options = {}) => new NextRequest(`https://localhost${url}`, {
      ...options, headers: { ...(owner ? { 'x-test-owner': owner } : {}), ...options.headers },
    });
    assert.equal((await files.GET(request('/api/files', null))).status, 401);
    assert.equal((await files.POST(request('/api/files', 'owner', { method: 'POST' }))).status, 422);
    const form = new FormData(); form.set('file', file('route-õ.txt'));
    const token = key();
    const uploaded = await files.POST(request('/api/files', 'owner', { method: 'POST', body: form, headers: { 'Idempotency-Key': token } }));
    assert.equal(uploaded.status, 201);
    const body = await uploaded.json();
    const context = { params: Promise.resolve({ fileId: body.fileId }) };
    const opContext = { params: Promise.resolve({ operationId: body.operationId }) };
    assert.equal(await (await detail.GET(request(`/api/files/${body.fileId}`), context)).text(), 'private test bytes');
    for (const endpoint of [() => detail.GET(request('/api/files/x','other'), context),
      () => detail.DELETE(request('/api/files/x','other', { method: 'DELETE' }), context),
      () => operation.GET(request('/api/file-operations/x','other'), opContext),
      () => operations.GET(request(`/api/file-operations?type=UPLOAD&idempotencyKey=${token}`,'other'))]) {
      assert.equal((await endpoint()).status, 404);
    }
    const info = await (await operation.GET(request('/api/file-operations/x'), opContext)).json();
    assert.equal(info.status, 'SUCCEEDED');
    assert.equal(JSON.stringify(info).includes('protectedEncryptionKey'), false);
    assert.equal(JSON.stringify(info).includes('storageKey'), false);
    const accepted = await detail.DELETE(request('/api/files/x', 'owner', { method: 'DELETE' }), context);
    assert.equal(accepted.status, 202);
    assert.equal((await detail.GET(request('/api/files/x'), context)).status, 404);
    const receipt = await accepted.json();
    await worker.recover(await repo.claim());
    assert.equal((await detail.DELETE(request('/api/files/x', 'owner', { method: 'DELETE' }), context)).status, 200);
    assert.equal((await owned(receipt.operationId)).status, 'SUCCEEDED');
    const signal = new AbortController(); signal.abort();
    assert.equal((await files.POST(request('/api/files', 'owner', { method: 'POST', signal: signal.signal, headers: { 'Idempotency-Key': key() } }))).status, 408);
  } finally { hook.deregister(); }
});

test('AC-08/17: an old write appearing after FAILED cleanup stays hidden and is reclaimed without touching a new upload', async () => {
  let paused, release;
  const barrier = new Promise(resolve => { paused = resolve; });
  const blocked = new Promise(resolve => { release = resolve; });
  const lateStorage = { ...storage, stage: async (...args) => { paused(); await blocked; return storage.stage(...args); } };
  const token = key();
  const pending = new FileService(prismaFileRepository, lateStorage, repo).uploadFile('owner', file('late-write.txt'), token);
  await barrier;
  const original = await repo.findByKey('owner', 'UPLOAD', token);
  await expire(original.id); await worker.recover(await repo.claim());
  assert.equal((await owned(original.id)).status, 'FAILED');
  await cleanup(original.id);
  const replacement = await upload('late-write.txt');
  release(); assert.equal((await pending).status, 409);
  const candidate = candidatesOf(original)[0];
  assert.ok(await storage.get(candidate.partKey));
  const old = new Date(Date.now() - repo.config.graceMs - 10000);
  await fs.utimes(path.join(process.env.FILE_STORAGE_DIRECTORY, candidate.partKey), old, old);
  await worker.scan(); await cleanup(original.id);
  assert.equal(await storage.get(candidate.partKey), null);
  assert.equal(await (await service.downloadFile('owner', replacement.body.fileId)).text(), 'private test bytes');
});

test('AC-19: an exception in one claimed job schedules its retry and the next queued job completes', async () => {
  const first = await upload('bad-job.txt'), second = await upload('good-job.txt');
  const bad = await service.deleteFile('owner', first.body.fileId);
  const good = await service.deleteFile('owner', second.body.fileId);
  const selected = (await repo.metadata(bad)).storageKey;
  const coordinator = new OperationCoordinator(repo, { ...storage, delete: async target => {
    if (target === selected) throw Object.assign(new Error(), { code: 'EIO' });
    return storage.delete(target);
  } });
  try { await coordinator.tick(); await coordinator.tick(); }
  finally { await coordinator.close(); }
  assert.equal((await owned(bad.id)).status, 'RETRY_WAIT');
  assert.equal((await owned(good.id)).status, 'SUCCEEDED');
  await due(bad.id); await worker.recover(await repo.claim());
});

test('AC-10/11: SIGKILL after unlink recovers the same DELETE receipt after restart', async () => {
  const uploaded = await upload('killed-delete.txt');
  const deletion = await service.deleteFile('owner', uploaded.body.fileId);
  const child = fork('tests/helpers/crash-delete.mjs', [], {
    execArgv: ['--import', './tests/register.mjs'], env: { ...process.env, DELETE_OP_ID: deletion.id }, stdio: ['ignore','ignore','inherit','ipc'],
  });
  await new Promise((resolve, reject) => {
    child.once('message', resolve); child.once('error', reject);
    child.once('exit', code => reject(new Error(`Worker exited early: ${code}`)));
  });
  child.kill('SIGKILL'); await new Promise(resolve => child.once('exit', resolve));
  assert.equal((await repo.metadata(deletion)).status, 'DELETING');
  await expire(deletion.id); await worker.recover(await repo.claim());
  assert.equal((await owned(deletion.id)).status, 'SUCCEEDED');
  assert.equal(await repo.metadata(deletion), null);
});

test('AC-08: a finalization stalled before CAS cannot supersede the recovered generation', async () => {
  let paused, release;
  const barrier = new Promise(resolve => { paused = resolve; });
  const blocked = new Promise(resolve => { release = resolve; });
  const stalled = new OperationRepository(prisma, repo.config);
  const finalize = stalled.completeUpload.bind(stalled);
  stalled.completeUpload = async (...args) => { paused(); await blocked; return finalize(...args); };
  const token = key();
  const pending = new FileService(prismaFileRepository, storage, stalled).uploadFile('owner', file('late-finalize.txt'), token);
  await barrier;
  const original = await repo.findByKey('owner','UPLOAD',token);
  await expire(original.id); await worker.recover(await repo.claim());
  const selected = (await repo.metadata(original)).storageKey;
  release(); const result = await pending;
  assert.equal(result.body.status, 'SUCCEEDED');
  assert.equal((await repo.metadata(original)).storageKey, selected);
  assert.notEqual(selected, candidatesOf(original)[0].finalKey);
  await cleanup(original.id);
  assert.equal(await (await service.downloadFile('owner', original.fileId)).text(), 'private test bytes');
});

test('AC-17: cleanup respects grace for newly appeared artifacts even after the receipt succeeded', async () => {
  const result = await upload('grace.txt');
  const op = await owned(result.body.operationId), candidate = candidatesOf(op)[0];
  await due(op.id);
  await worker.cleanup(await repo.claimCleanup());
  const deferred = await owned(op.id);
  assert.equal(deferred.cleanupStatus, 'PENDING');
  assert.equal(deferred.cleanupAttemptCount, 0);
  assert.ok(await storage.get(candidate.partKey));
  assert.ok(deferred.cleanupNextAttemptAt.getTime() - (await repo.now()).getTime() > repo.config.graceMs - 10000);
  await cleanup(op.id);
});
