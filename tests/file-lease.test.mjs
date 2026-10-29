import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { OperationLease } from '../src/lib/files/operations/lease.ts';
import { readFileOperationConfig } from '../src/lib/files/config.ts';

test('AC-07: handler remains alive past one minute with heartbeats; lost renewal stops further stages', async t => {
  t.mock.timers.enable({ apis: ['setInterval', 'setTimeout'] });
  let beats = 0, lost = false;
  const repository = { config: readFileOperationConfig({}),
    heartbeat: async () => { beats++; if (lost) throw new Error('lost ACK'); },
    assertOwned: async () => {},
  };
  const lease = new OperationLease(repository, {});
  try {
    for (let i = 0; i < 5; i++) { t.mock.timers.tick(15000); await setImmediate(); }
    assert.equal(beats, 5); assert.equal(lease.signal.aborted, false);
    lost = true; t.mock.timers.tick(15000); await setImmediate();
    assert.equal(lease.signal.aborted, true);
    await assert.rejects(lease.check());
  } finally { lease.stop(); }
});

test('shutdown stops an in-flight wait and further stages even when underlying IO finishes later', async () => {
  const shutdown = new AbortController();
  const lease = new OperationLease({ config: readFileOperationConfig({}), heartbeat: async () => {}, assertOwned: async () => {} }, {}, shutdown.signal);
  let complete;
  try {
    const action = lease.io(() => new Promise(resolve => { complete = resolve; }));
    shutdown.abort();
    await assert.rejects(action);
    complete('late result');
    await assert.rejects(lease.check());
  } finally { lease.stop(); }
});

test('IO deadlines reject stalled calls without treating late completion as cancellation of its side effect', async () => {
  const config = { ...readFileOperationConfig({}), ioTimeoutMs: 5 };
  const lease = new OperationLease({ config, heartbeat: async () => {} }, {});
  const keepAlive = setTimeout(() => {}, 100);
  let release;
  try {
    const call = lease.io(() => new Promise(resolve => { release = resolve; }));
    await assert.rejects(call, { name: 'TimeoutError' });
    release('late completion');
  } finally { clearTimeout(keepAlive); lease.stop(); }
});
