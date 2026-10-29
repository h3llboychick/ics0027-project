import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID, randomBytes } from 'node:crypto';
import { createDiskStorage } from '../src/lib/files/storage/disk-storage.ts';
import { readFileOperationConfig } from '../src/lib/files/config.ts';
import { aesGcmFileEncryptor } from '../src/lib/files/encryption.ts';

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'file-storage-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const storage = createDiskStorage(root);
  const part = `${randomUUID()}.${randomUUID()}.part`;
  return { root, storage, part, final: part.replace('.part', '.bin') };
}

test('exclusive staging/publication is durable, immutable and handles empty files', async t => {
  const { root, storage, part, final } = await fixture(t);
  await storage.stage(part, Buffer.alloc(0));
  await storage.publish(part, final);
  assert.equal((await storage.get(final)).length, 0);
  await assert.rejects(storage.stage(part, Buffer.from('overwrite')), { code: 'EEXIST' });
  await assert.rejects(storage.publish(part, final), { code: 'EEXIST' });
  assert.equal((await fs.stat(path.join(root, final))).mode & 0o777, 0o600);
  await storage.delete(part);
  await storage.delete(part);
  assert.equal((await storage.get(final)).length, 0);
});

test('storage rejects traversal, symlinks, special files and symlink roots', async t => {
  const { root, storage, part } = await fixture(t);
  await assert.rejects(storage.get('../outside'));
  await assert.rejects(storage.delete('/tmp/outside'));
  await assert.rejects(storage.stage('user-filename.part', Buffer.alloc(0)));
  const outside = path.join(root, 'outside');
  await fs.writeFile(outside, 'keep');
  await fs.symlink(outside, path.join(root, part));
  await assert.rejects(storage.get(part));
  await assert.rejects(storage.stage(part, Buffer.from('bad')));
  await assert.rejects(storage.publish(part, part.replace('.part', '.bin')));
  assert.equal(await fs.readFile(outside, 'utf8'), 'keep');
  const linkedRoot = path.join(root, 'linked-root');
  await fs.symlink(root, linkedRoot);
  await assert.rejects(createDiskStorage(linkedRoot).get(randomUUID()));
});

test('startup rejects unsafe configuration relationships', () => {
  assert.equal(readFileOperationConfig({}).leaseMs, 60000);
  for (const config of [{ FILE_LEASE_MS: 'NaN' }, { FILE_MAX_ATTEMPTS: '0' },
    { FILE_HEARTBEAT_MS: '40000' }, { FILE_IO_TIMEOUT_MS: '60000' }, { FILE_CLEANUP_GRACE_MS: '1' }]) {
    assert.throws(() => readFileOperationConfig(config));
  }
});

test('authenticated encryption never returns modified plaintext', () => {
  process.env.FILE_ENCRYPTION_KEK = randomBytes(32).toString('hex');
  const input = Buffer.from('private content');
  for (const mutate of [e => e.encryptedContent.ciphertext[0] ^= 1, e => e.encryptedContent.authTag[0] ^= 1,
    e => e.encryptedDataKey.authTag[0] ^= 1]) {
    const encrypted = aesGcmFileEncryptor.encrypt(input);
    mutate(encrypted);
    assert.throws(() => aesGcmFileEncryptor.decrypt(encrypted));
  }
});
