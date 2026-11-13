# Implemented security controls

All POST and DELETE handlers use `securityHandler`. Before authentication or body
parsing, it checks the exact configured `BETTER_AUTH_URL` origin, rejects foreign
Fetch Metadata, and verifies a signed double-submit CSRF token. `/api/csrf` issues
the token in JSON and a `__Host-` cookie (Secure, HttpOnly, SameSite=Strict, Path=/,
no Domain). Clients send it as `X-CSRF-Token`. It is signed with an HMAC derived
from `BETTER_AUTH_SECRET`; comparing with the cookie uses constant-time equality.
Missing, forged, mismatched and cross-origin requests fail with 403. No mutation
is attempted. Better Auth's own Origin, callback URL and Fetch Metadata checks
remain enabled. Emailed verification/reset GET links rely on their expiring
tokens; they do not accept arbitrary file mutations.

Page responses use a fresh random script nonce and dynamic rendering. CSP denies
inline event handlers, objects, external scripts, framing and foreign form
destinations. Production scripts allow neither unsafe-inline nor unsafe-eval.
Style attributes are allowed for Base UI positioning; style elements require the
nonce or a same-origin URL. Development alone allows eval and WebSockets for HMR.
React renders filenames and account names as text, never raw HTML. Downloads are
attachments with application/octet-stream, nosniff, sandbox CSP and no-store.

Application audit records use a field whitelist: timestamp, event, request ID,
user ID, source address, outcome, status, safe error code and optional opaque file
and operation IDs. They omit bodies, filenames, URLs, cookies, credentials and
error stacks. Request IDs are generated on the server and returned in
`X-Request-Id`. User-facing internal failures are generic. Anonymous requests and
background jobs have a null user/source where no trustworthy identity/address is
available. `TRUST_PROXY_HEADERS=true` is appropriate only behind the supplied
nginx, which overwrites X-Real-IP and X-Forwarded-For. The app has no public port
in Compose. Nginx access logs omit URLs; error logging is restricted to critical
failures so upstream request URLs cannot expose recovery tokens.

The compatibility name `EMAIL_PROVIDER=console` now delivers messages to private
`.mail-outbox/*.txt` files instead of logging account-access links. Files use mode
0600 and the directory is created with mode 0700. Compose keeps this mailbox in
the `local_mail` volume. Read it locally with
`docker compose exec app sh -c 'cat .mail-outbox/*.txt'`. Treat these files like an
inbox: they intentionally contain account recovery links. They are excluded from
Git and Docker build context. Use Resend for real delivery. Audit logs record
only delivery success, never mail contents. `EMAIL_OUTBOX_DIRECTORY` overrides
the local path when running without Compose.

References: [Next.js CSP](https://nextjs.org/docs/app/guides/content-security-policy),
[Better Auth security](https://better-auth.com/docs/reference/security).

## File and resource policy

New uploads accept TXT, CSV, JSON, PDF, PNG and JPEG extensions only. Filenames
are bounded to 255 characters; path separators, colons, control characters and
blank names are rejected. Text must be valid UTF-8 without NULs. PDF, PNG and JPEG
content must have the corresponding signature; MIME headers are not trusted.
This is a format policy, not antivirus scanning or a complete format decoder.
Files are never interpreted, previewed or extracted. Existing files remain
downloadable, even if their types are no longer accepted for new uploads.

The backend validates the 25 MiB file limit and counts actual request bytes up to
25 MiB + 64 KiB of multipart overhead before parsing. Nginx also limits requests
to 26 MiB. Authentication bodies are limited to 16 KiB; names and email addresses
are bounded before Better Auth's endpoint validation. File listing accepts page
sizes 10/20/40, a page bounded to one million, and a 100-character search term.
Search uses case-insensitive, literal filename substrings within the current
owner's READY files. Prisma query APIs and tagged raw SQL parameterize all data.

`FILE_USER_QUOTA_BYTES` defaults to 104857600 (100 MiB). Reservation locks the
owner's database row and checks aggregate usage in the same transaction, across
all web processes. Pending uploads and deleting files count; failed uploads
count until their cleanup receipt is DONE. Cleanup/deletion releases their
reservation. Retrying the same accepted idempotency key does not reserve again.
The UI shows usage and reservations independently of its current filename
filter. The quota bounds logical file bytes, not metadata, receipts, recovery
copies, mail or backups. Uploads/downloads are bounded but currently buffered in
memory; deployment-wide concurrency and volume monitoring remain necessary.

`GET /api/health` is public liveness only and returns `{"status":"ok"}`. It makes
no dependency-readiness claim and reveals no database or key configuration.
