import type { FileStorage } from './base';
import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { generationKeyPattern, storageKeyPattern } from '../operations/model';
import { MAX_UPLOAD_SIZE } from '../../contracts/files';

function isMissing(error: unknown) {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

/** The volume root is provisioned by the operator, never by an HTTP input. */
export function createDiskStorage(directory = process.env.FILE_STORAGE_DIRECTORY ?? 'storage'): FileStorage {
  const root = path.resolve(directory);
  async function ensureRoot() {
    await fs.mkdir(root, { recursive: true, mode: 0o700 });
    const stat = await fs.lstat(root);
    if (!stat.isDirectory() || stat.isSymbolicLink() || await fs.realpath(root) !== root) {
      throw new Error('Storage root must be a real directory');
    }
  }
  function location(key: string) {
    if (!storageKeyPattern.test(key) || path.dirname(path.resolve(root, key)) !== root) {
      throw new Error('Invalid storage key');
    }
    return path.join(root, key);
  }
  async function syncDirectory() {
    const directory = await fs.open(root, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    try { await directory.sync(); } finally { await directory.close(); }
  }
  return {
    async stage(key, contents, signal) {
      const target = location(key);
      if (!key.endsWith('.part')) throw new Error('Staging requires a generation key');
      await ensureRoot();
      signal?.throwIfAborted();
      const file = await fs.open(target, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      try {
        await file.writeFile(contents, { signal });
        await file.sync();
      } finally { await file.close(); }
      // Failed writes deliberately retain their registered remnants for recovery.
      await syncDirectory();
    },
    async publish(partKey, finalKey) {
      const source = location(partKey), target = location(finalKey);
      if (!partKey.endsWith('.part') || finalKey !== partKey.replace(/\.part$/, '.bin')) throw new Error('Invalid publication');
      await ensureRoot();
      const stat = await fs.lstat(source);
      if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Invalid staging file');
      // link(2) is an atomic, no-replace publication on the same Linux volume.
      // Keep .part until durable housekeeping; never expose an old mutable generation.
      await fs.link(source, target);
      await syncDirectory();
    },
    async get(key, signal) {
      const target = location(key);
      await ensureRoot();
      let file;
      try { file = await fs.open(target, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK); }
      catch (error) { if (isMissing(error)) return null; throw error; }
      try {
        const stat = await file.stat();
        if (!stat.isFile() || stat.size > MAX_UPLOAD_SIZE) throw new Error('Invalid stored file');
        return await file.readFile({ signal });
      } finally { await file.close(); }
    },
    async delete(key) {
      const target = location(key);
      await ensureRoot();
      try { await fs.unlink(target); } catch (error) { if (!isMissing(error)) throw error; }
      // Also flush on ENOENT: an earlier attempt may have unlinked before fsync failed.
      await syncDirectory();
    },
    async inspect(key) {
      const target = location(key);
      await ensureRoot();
      try {
        const stat = await fs.lstat(target);
        if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Invalid stored file');
        return { modifiedAt: stat.mtime };
      } catch (error) { if (isMissing(error)) return null; throw error; }
    },
    async *legacyKeys() {
      await ensureRoot();
      for await (const entry of await fs.opendir(root)) {
        if (storageKeyPattern.test(entry.name) && !generationKeyPattern.test(entry.name)) yield entry.name;
      }
    },
    async *generations() {
      await ensureRoot();
      const directory = await fs.opendir(root);
      for await (const entry of directory) {
        // Legacy paths and unknown names are never automatically removed.
        if (!generationKeyPattern.test(entry.name)) continue;
        try {
          const stat = await fs.lstat(location(entry.name));
          yield { key: entry.name, modifiedAt: stat.mtime };
        } catch (error) { if (!isMissing(error)) throw error; }
      }
    },
  };
}
export const diskStorage = createDiskStorage();
