# Durable file operations

Uploads reserve encryption metadata and an operation in PostgreSQL **before** touching the storage volume. The request writes ciphertext to a unique generation, flushes it, publishes without replacement, flushes the directory, and conditionally commits `READY`/`SUCCEEDED`. Only a confirmed success returns 201. An uncertain SQL result never triggers destructive compensation.

Deletion transactionally changes an owned `READY` file to `DELETING` and creates one durable job. The worker removes ciphertext idempotently, then transactionally removes metadata and completes the retained receipt. New downloads and listings exclude `UPLOADING`, `DELETING`, and `FAILED` files.

## States and ownership

- File: `UPLOADING → READY → DELETING → removed`, or `UPLOADING → FAILED`.
- Operation: `PENDING/RUNNING → SUCCEEDED/FAILED`, or `RUNNING → RETRY_WAIT → RUNNING`; exhausted or uncertain authentication/configuration outcomes become `NEEDS_ATTENTION`.
- Every claim replaces its lease token. Heartbeat and finalization require the same owner, token, unexpired lease, and current file operation. SQL clocks determine lease expiration; `statusChangedAt` is unrelated to heartbeat.
- Upload attempts, including the initial HTTP attempt, total three by default. DELETE begins attempt one in the worker. HTTP retries and status reads do not increment attempts.
- Cleanup has a separate persisted status, attempt count, lease, schedule, and error code. It runs after terminal uploads too. A cleanup failure never changes a ready file into a failed upload.
- The worker processes one operation at a time. Deploy exactly one worker instance. PostgreSQL coordinates it with concurrent HTTP handlers; this is not a distributed scheduler.

A manifest registers all candidate paths before I/O. Each attempt uses `<fileId>.<token>.part` and `.bin`. Publication uses same-volume `link(2)` with no replacement; the `.part` link is retained for later housekeeping. Recovery authenticates a ciphertext snapshot, then writes its own generation rather than selecting an inode an older writer might still modify. Stale attempts cannot change the selected generation. Failed/timed-out filesystem calls may finish late; the manifest, CAS, and periodic bounded scan retain responsibility for those artifacts.

The disk adapter validates generated keys, restricts paths to its root, opens with `O_NOFOLLOW`, rejects symlink roots/special files, and uses exclusive staging with mode 0600. The storage directory and its ancestors are operator-controlled. Do not allow untrusted local processes to rename the mounted root. Unknown legacy blobs are retained for manual inspection (`node dist/worker/worker.js --inspect-legacy` reports unreferenced legacy IDs without deleting anything); the scanner only requeues **registered** new-generation artifacts.

## API

Every POST/DELETE also requires the CSRF cookie, `X-CSRF-Token` and the configured public Origin; browser clients handle this automatically. See [security controls](SECURITY_CONTROLS.md).

`Idempotency-Key` is required on POST: 16–128 ASCII letters, digits, `_` or `-` (a browser UUID works). The server fingerprints filename, size and bytes. Keys are scoped by owner and operation type. A different fingerprint gives 409 without side effects. A new conscious attempt after failure needs a new key.

| Request | Result |
| --- | --- |
| `POST /api/files` | 201 for new confirmed success; 200 for completed replay; 202 for confirmed acceptance awaiting recovery; 409 for conflict or terminal failed upload. |
| `DELETE /api/files/{fileId}` | 202 for confirmed intent; 200 for a completed replay. Repeats find the same receipt even after file metadata is gone. |
| `GET /api/file-operations/{operationId}` | Own receipt or the same 404 used for absent/foreign operations. |
| `GET /api/file-operations?type=UPLOAD&idempotencyKey=...` | Own receipt when the initial response was lost. DELETE lookup also works with its file ID as key. |
| `GET /api/files` and `GET /api/files/{fileId}` | Owned READY files only; a missing READY blob produces a safe 5xx storage incident. |

Operation JSON contains only `operationId`, `fileId`, `type`, `status`, `phase`, and a public `error` (or null). It contains no encryption metadata, storage paths, lease tokens, fingerprints or raw dependency errors. A failed DB read cannot establish acceptance: no speculative 202 is returned.

The browser keeps each transfer and its stable key for the lifetime of the page, polls pending operations every two seconds, stops at a terminal state/unmount/sign-out, and refreshes the ready list after completion. Lost responses retain an unknown-result row and a button to retry the same request/key. Original files are held only in memory while needed for a retry. A page reload does not persist the original upload bytes or pending rows; this version does not implement resumable browser storage.

## Configuration and worker

Web startup (`instrumentation.ts`) and worker startup validate the KEK format and timeout configuration. The KEK must be the **same** 32-byte hexadecimal value in both processes. Keep the existing KEK when upgrading. A syntactically valid wrong KEK causes authentication failure and preserves candidates for attention.

| Setting | Default |
| --- | --- |
| `FILE_USER_QUOTA_BYTES` | 104857600 (100 MiB) |
| `FILE_LEASE_MS` | 60000 |
| `FILE_HEARTBEAT_MS` | 15000 |
| `FILE_WORKER_POLL_MS` | 5000 |
| `NEXT_PUBLIC_FILE_OPERATION_POLL_MS` (build-time browser setting) | 2000 |
| `FILE_MAX_ATTEMPTS` | 3 |
| `FILE_RETRY_FIRST_MS`, `FILE_RETRY_SECOND_MS` | 5000, 30000 |
| `FILE_CLEANUP_GRACE_MS` | 300000 |
| `FILE_IO_TIMEOUT_MS` | 10000 |
| `FILE_DATABASE_TIMEOUT_MS` | 5000 |
| `FILE_ATTEMPT_TIMEOUT_MS` | 120000 |
| `FILE_STORAGE_DIRECTORY` | `storage` (in the image, `/app/storage`) |

Rebuild the image after changing the public browser poll interval; Compose passes it as a build argument. Other intervals are runtime settings. Heartbeat must be less than half the lease; I/O and DB timeouts must fit the lease; grace must be at least the lease. An attempt deadline stops renewal/new stages even if an underlying dependency cannot be canceled. Timeout is not proof of rollback. The worker stops taking work on SIGTERM/SIGINT, abandons bounded work safely, and exits within 15 seconds; SIGKILL recovery depends on persisted state rather than finally blocks.

For local execution, after migrations and with `.env` configured:

```sh
corepack pnpm exec prisma generate
corepack pnpm build:worker
corepack pnpm worker
```

The compiler emits ESM, resolves local aliases, and packages the installed worker dependency graph and Prisma runtime assets into `dist/worker`. Production uses `node dist/worker/worker.js`, without TypeScript hooks, email configuration or a listening port. Web and worker in Compose use the same image, database, KEK and encrypted-file volume.

After fixing the cause of `NEEDS_ATTENTION`, requeue one known operation locally:

```sh
docker compose exec worker node dist/worker/worker.js --retry OPERATION_UUID
# Or locally:
node --env-file=.env dist/worker/worker.js --retry OPERATION_UUID
```

This resets the selected main-job or cleanup attempt budget explicitly, retains all encryption metadata and candidates, and creates no public admin API. Main job success is never reset. After 32 candidate generations, manual inspection is required before further retries. Receipts/history and attention states are never purged automatically.

## Upgrade and rollback

1. Stop the old web/worker/nginx. Securely back up PostgreSQL, the encrypted-files volume **and the existing KEK** together.
2. Start PostgreSQL only, set `DATABASE_URL` to that database, then run `corepack pnpm exec prisma migrate deploy`.
3. Generate the Prisma client and build/start the matching web, worker and nginx versions. `setup-dev.sh` now follows database → migration → application order for initial setup.

```sh
docker compose stop app worker nginx
docker compose up -d db
corepack pnpm exec prisma migrate deploy
corepack pnpm exec prisma generate
docker compose up --build -d app worker nginx
```

Old metadata becomes `READY` with `storageKey=id`; legacy ciphertext is not renamed or deleted. New receipts have no foreign key/cascade from file metadata. User deletion is restricted by foreign keys while files or receipts exist; there is no account-deletion protocol in this release. Do not remove files/users through SQL or ORM shortcuts: they bypass the filesystem protocol.

An old application version is incompatible with the new states and generation paths. Prefer a forward fix. Before rollback, stop processes and assess compatibility or restore the matching protected backup; never drop operation history to force a downgrade.

## Verification

```sh
corepack pnpm test
corepack pnpm test:integration
corepack pnpm lint
corepack pnpm exec tsc --noEmit --incremental false
corepack pnpm exec prisma validate
corepack pnpm build
corepack pnpm build:worker
```

The integration runner provisions/removes its own PostgreSQL container and temporary storage, refuses other database names/hosts, applies migrations to empty/legacy fixtures, and exercises real FS/crypto/Prisma, process kills, SQL triggers and dropped TCP COMMIT acknowledgements. It never uses the project's storage volume or `.env` database.

The report's Security Analysis section summarizes the development checks and
observed attack outcomes. Process crashes and managed I/O faults were tested.
Power loss, host filesystem corruption, sustained load, KEK backup recovery,
and a full storage durability SLA remain outside those proofs. There is still
a 25 MiB limit and full in-memory AES-GCM encryption/decryption.
