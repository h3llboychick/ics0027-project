**Checkpoint 2 repository review — 28 October 2026**

**Follow-up: issues 2–5 resolved**

- **2 — Download filenames:** added safe ASCII fallback and UTF-8 `filename*` headers, with response construction inside the route's error boundary. ASCII, spaces, quotes, backslashes, accented letters, Chinese characters, emoji, and control-character handling are covered by 12 passing regression tests (`corepack pnpm test`). HTTPS downloads preserved the original bytes and names.
- **3 — Sessions:** explicitly configured a 24-hour lifetime, disabled sliding refresh and cookie caching, and set Strict/Secure/HttpOnly cookies. Added a migration that caps legacy session expiry without extending shorter lifetimes. Five disposable legacy-session cases and an idempotent rerun passed. Apply migrations when upgrading an existing database.
- **4 — Lint:** the full lint command now passes. Verification/reset query values come from server page props, verification state is derived directly, file-list requests are abortable, and the mobile hook uses an external-store subscription. TypeScript and the production build also pass.
- **5 — Documentation:** README now marks search, `/api/health`, quotas, and structured logging as planned; documents pagination, the implemented session policy, and migration/test commands; and correctly describes deletion of both volumes with `down -v`.

Browser checks passed for sign-in, pagination, changing page size, upload/list refresh, deletion, signup, verification from an external-page simulation, the confirmation redirect, missing/expired verification states, and password reset from an external-page simulation. Password reset revoked the previous browser session. No console warnings or errors were observed in those flows. The isolated browser used a temporary certificate exception; separate HTTPS checks verified the existing local CA and hostname. Disposable accounts, a fresh database, and separate volumes were used.

The user's nginx change accepts 2 MiB uploads. An exact 25 MiB file still returned 413 because `client_max_body_size 25M` also counts multipart overhead. Allow a little request overhead (for example, `26M`) while retaining the backend's 25 MiB file limit. The nginx file was left as edited by the user.

The remaining text records the **initial audit**, before these follow-up fixes.

Assessed against [checkpoint2.txt](../checkpoint2.txt), using the current working tree at commit `9967d5f`, including the existing uncommitted README and signup-form changes. The checkpoint text matches the Checkpoint 2 section of [the course specification](specification.pdf).

**Initial assessment: the core implementation is largely present, but fix the upload and download bugs and finish the submission documentation before submitting.** The remaining work is mostly fixes, verification, and documentation.

**Initial requirement coverage**

| Checkpoint 2 requirement | Current state | Remaining work |
| --- | --- | --- |
| Basic working web interface and core flows | Registration, sign-in, verification, password reset, listing, pagination, upload, download, deletion, and logout have UI implementations. Core API flows work with small files. | Fix uploads through nginx and downloads with Unicode filenames; complete a browser walkthrough after trusting the local CA. |
| Server-side encryption and decryption | AES-256-GCM with a random key per file; that key is encrypted under the environment-supplied KEK. A download reproduced the original bytes; the storage volume contained ciphertext; modified ciphertext was rejected. | No missing basic encryption feature was found. Preserve these checks when fixing file handling. |
| Password hashing and secure sessions | Stored passwords use Argon2id. HTTPS sessions have Secure and HttpOnly cookies. Unverified login, unauthenticated file access, expired sessions, and revoked sessions are rejected. | Reconcile the configured session policy with the documented policy. |
| TLS in development | nginx serves HTTPS; the generated certificate passed CA and hostname verification in the HTTP smoke checks. | Document certificate trust concretely and verify the browser experience. |
| Clean-machine run instructions | A fresh source copy installed dependencies, generated Prisma, built the Docker image, and applied all three migrations to a new database. | Address or document the fixed-container-name conflict; improve prerequisite and certificate-trust instructions. See the environment limitation below. |
| Incremental commit history | History shows successive database, encryption, API, UI, recovery, TLS, setup, and email changes. | Ensure the submitted remote revision contains all intended work. |
| Short progress note | No dedicated Checkpoint 2 progress note was present before this review. | Add a short final progress note describing completed features, verification, known limitations, and next steps. |

**Original prioritized submission checklist**

1. **Fix the upload limit through nginx.** The interface advertises 25 MB and the backend allows `25 * 1024 * 1024` bytes, but a 2 MiB upload through the documented HTTPS URL returned **413**. [nginx/default.conf](../nginx/default.conf) does not configure a request-body limit. Set a bounded proxy limit that accommodates the allowed file plus multipart overhead, keep the backend file-size limit, and make the UI explain oversized-file failures. Relevant code: [file contracts](../src/lib/contracts/files.ts), [upload route](../src/app/api/files/route.ts), and [file interface](../src/components/file-transfer.tsx). Done when a file at the advertised limit uploads and downloads correctly through HTTPS, while an oversized file is rejected clearly.

2. **Fix download response headers for filenames.** Uploading `aruanne-õ-文件.txt` returned **201**, but downloading it returned **500**. The [download handler](../src/app/api/files/[fileId]/route.ts) interpolates the original filename directly into `Content-Disposition`. Generate a safe ASCII fallback and a correctly encoded UTF-8 filename parameter; handle quotes and backslashes as well. Keep response construction inside the error-handling boundary. Done when ASCII, spaces, quotes, accented letters, and non-Latin filenames download with intact bytes and usable names.

3. **Make session configuration and documentation agree.** [The session model](AUTHENTICATION_AND_SESSION_MODEL.md) promises `SameSite=Strict`, a 24-hour lifetime, and disabled sliding refresh. [auth.ts](../src/lib/auth.ts) supplies no corresponding overrides. Runtime cookies were **SameSite=Lax**, with **Max-Age=604800** (seven days), and database session lifetime was seven days. The installed Better Auth defaults also allow refresh, with a one-day update interval. Implement the intended policy explicitly or document the actual policy and explain the change from the design. Done when cookie inspection, database expiry, refresh behavior, and the written model agree. Existing Secure/HttpOnly cookies and revocation behavior already passed the checks.

4. **Fix the failing lint command.** `corepack pnpm lint` exits with **six errors and one warning**. The effect/state rule reports errors in [email-verification-result.tsx](../src/components/email-verification-result.tsx), [file-transfer.tsx](../src/components/file-transfer.tsx), [reset-password-form.tsx](../src/components/reset-password-form.tsx), and [use-mobile.ts](../src/hooks/use-mobile.ts). Internal-link errors occur in the verification-result component and [ui/logo.tsx](../src/components/ui/logo.tsx); the file interface also has an unused router variable. Restructure the affected effects and links, and remove the unused variable. Done when lint passes and the affected flows still work. This is a quality fix; lint is not a separately stated checkpoint deliverable.

5. **Correct the README feature and route claims.** [README.md](../README.md) describes filename search, but there is no search control, request-schema field, or repository filter. A request with a nonmatching `search` value still returned all of the user's files. It also lists `/api/health`, which returned **404**. Implement these features or mark them as planned. State separately that per-file size validation exists and per-user storage quotas do not. Correct the `docker compose down -v` explanation: it deletes both the database and encrypted-file volumes. Search, health reporting, and quotas are not explicit Checkpoint 2 requirements, so accurate documentation is sufficient for this submission.

6. **Finish and rehearse the documented browser setup.** Specify a tested OS/shell, how to obtain Node.js 24 and Corepack, and concrete steps to trust `certs/ca/root-ca.crt` in the supported OS/browser. The automated browser attempt stopped at `ERR_CERT_AUTHORITY_INVALID` for the newly generated audit CA; the HTTPS API checks passed with that CA explicitly trusted. After trust is configured, rehearse registration → verification from console logs → logout/login → upload → list → download → delete → password reset. Record the result in the progress note. Check the small-screen layout and the verification redirects during that walkthrough.

7. **Add the required short progress note.** A concise `docs/CHECKPOINT2_PROGRESS.md` would be sufficient: describe the working core features, summarize the encryption and session design actually used, give the run URL, list checks and results, and identify unfinished work for Checkpoint 3. Update it after the preceding fixes so its claims match the submitted revision. This review records the assessment and test results; the final progress note should describe the state being submitted.

8. **Check the submitted Git revision.** At review time, `main` was eight commits ahead of the local `origin/main` tracking reference; `README.md` and `src/components/signup-form.tsx` were modified, and `checkpoint2.txt` was untracked. Review and commit the intended changes, include the progress note, push to the submission branch, and verify the commit visible in the hosted repository. Keep `.env`, private certificates, generated files, dependencies, and stored uploads excluded. The remote tracking reference was inspected locally; the hosted branch was not independently checked.

**Useful setup improvement**

Remove the hardcoded `container_name` entries from [compose.yaml](../compose.yaml), or explain the conflict/recovery procedure. The fresh-copy setup built successfully but could not start because this machine already had stopped containers named `secure-file-manager-db`, `secure-file-manager-app`, and `secure-file-manager-nginx`. For the audit, only the temporary copy's container names were changed; the existing containers were preserved. The isolated stack then started and the migrations passed. This is an existing-installation/multiple-checkout issue, rather than evidence that a genuinely clean machine cannot run the application. The fresh copy ran on the same Linux host with its existing toolchain and host package cache; a separate clean OS installation was not tested.

**Initial verification performed**

| Check | Observed result |
| --- | --- |
| `corepack pnpm build` | Passed, including Next.js compilation, TypeScript, and page generation. |
| `corepack pnpm exec tsc --noEmit --incremental false` | Passed. |
| `corepack pnpm lint` | Failed: six errors, one warning. |
| `bash -n scripts/setup-dev.sh` | Passed. |
| `corepack pnpm exec prisma validate` | Passed. |
| Fresh-copy install, Prisma generation, Docker build | Passed. |
| `prisma migrate deploy` on a fresh isolated database | All three migrations applied successfully. |
| HTTPS certificate | CA chain and hostname verified with the generated audit CA. |
| Unauthenticated `/` and file listing | Redirect to `/sign-in`; file API returned 401. |
| Registration and email verification | Registration 200; unverified login 403; emailed console link verified the account and created a session. |
| Password hashes in database | Argon2id, `m=47104,p=1,t=1`; no plaintext passwords in the password field. |
| Successful repeated login | Both requests returned 200 and received different session tokens. |
| Logout, password reset, and expiration | Reusing a logged-out or reset-revoked session returned 401; an expired session returned 401. |
| Password reset credentials | Reset succeeded; old password returned 401; new password returned 200. |
| File encryption round trip | Upload 201; download 200; bytes matched exactly. Stored bytes differed from plaintext and did not contain the plaintext marker. |
| Ciphertext tampering | Altering a stored ciphertext byte caused 500 with the generic `FILE_ENCRYPTION_FAILED` response; no plaintext was returned. |
| Per-user file isolation | Second user saw an empty list and received 404 for another user's download and delete; unauthenticated download returned 401. |
| Owner deletion | 204; subsequent download returned 404. |
| Invalid pagination and file identifier | 422. |
| Upload of 2 MiB through nginx | Failed: 413. |
| Unicode filename | Upload 201; download failed with 500. |
| Documented search and health route | Search ignored; health route 404. |
| Full browser interaction | Not completed: the newly generated audit CA was untrusted by the browser. |

Runtime checks used disposable accounts, console email delivery, a new database, new storage volumes, and generated secrets in a temporary source copy. No real email was sent. Application source files in the working repository were not changed by this review. No automated test suite or CI workflow was found in the tracked repository; the checks above were audit smoke checks.

To repeat the functional smoke checks after the fixes, use two disposable verified accounts. As account A, upload a small binary file, a file near the maximum size, and files with the filename variants listed above; compare downloaded bytes against the originals. As account B, try A's file identifiers for download and deletion and check that A's files never appear in B's list. Confirm deletion, logout revocation, and password-reset revocation, then record the commands or browser steps and observed outcomes with the submission.

**Work to track for Checkpoint 3**

The course specification places complete CSRF/XSS defenses, completed validation, structured security logging, security test evidence, and the draft report in Checkpoint 3. These deserve explicit backlog entries without treating every planned mitigation as a missing Checkpoint 2 feature:

- Add and demonstrate CSRF protection on the custom file-write endpoints. Better Auth's checks protect its own endpoints; the custom upload/delete handlers contain no equivalent explicit Origin/token checks.
- Add a Content Security Policy and document/test filename rendering and upload validation. No CSP configuration was found in the application or nginx configuration inspected.
- Implement structured security events and redaction. Keep console email delivery explicitly scoped to local demos because its verification/reset links grant account access.
- Complete resource controls: per-user quotas, bounded concurrent uploads, and checks before accepting/buffering oversized requests. Current multipart handling buffers the body before file-size validation.
- Improve deletion failure recovery: [FileService.deleteFile](../src/lib/files/service.ts) removes the blob before deleting metadata, so a database failure can leave a visible record with missing content. Also make the repository's delete operation use its `ownerId` argument; current normal requests are protected by the service's preceding ownership check.
- Add repeatable security tests and results, and prepare the draft project report required for Checkpoint 3.
