# Secure Web-Based File Encryption and Management System

Checkpoint 3 report draft, revised 15 November 2026.

## 1. Introduction

File storage applications handle several forms of sensitive data at once:
uploaded content, credentials, sessions, ownership records and cryptographic
keys. Protecting the storage volume alone does not prevent a web application
from returning another user's file or executing an attacker-supplied filename.
This project implements a browser-based file manager that combines encrypted
storage with authentication, ownership checks and common web attack defences.

The application supports registration, email verification, login, password
recovery and logout. Authenticated users upload, search, list, download and
delete their files. The security objectives are confidentiality of file content,
integrity of stored data and ownership, bounded resource use, and an audit trail
that does not expose account-access secrets. Availability also depends on
recovering operations interrupted between a database update and a filesystem
operation.

This is server-side encryption. The trusted backend handles plaintext during
upload and authorized download and holds the key-encryption key. It therefore
does not protect content from a compromised application server or its operator.
The browser, filenames, request bodies, identifiers and client-side validation
are treated as untrusted. Nginx, the application, PostgreSQL and encrypted file
storage form separate components within the server environment. The deployment separates the browser, TLS proxy, application, database, worker
and encrypted-file volume; the implementation section describes their roles.

## 2. Implementation

### 2.1 Components and deployment

Next.js and React implement the interface and HTTP route handlers in TypeScript.
PostgreSQL stores identities, sessions, file metadata and durable operation
receipts. Prisma provides typed queries and parameterized raw SQL for locking
and worker coordination. A dedicated Node.js worker recovers pending operations
and removes obsolete encrypted generations. Docker Compose runs these services
with nginx, which terminates development TLS. The browser connects to nginx;
the application and worker share a persistent encrypted-file volume. The
database is exposed locally for development administration.

`scripts/setup-dev.sh` installs locked dependencies, generates development
secrets and certificates, applies migrations and starts the services. Hostname
mapping and local CA trust remain explicit machine setup steps. Environment
files, private keys, generated clients, storage and local mail are excluded
from version control. The Docker image uses standalone application output and
runs as the unprivileged `node` user.

![Figure 1. Original architecture diagram](System%20Architecture%20Diagram.png)

### 2.2 Authentication and sessions

Better Auth implements email/password authentication, verification and recovery.
Passwords use Argon2id with individual salts, 47,104 KiB of memory, one iteration
and one parallel lane. The database stores password hashes rather than plaintext
passwords. Email verification is required before login. Verification and reset
links expire after one hour. Resend delivers real mail; the local development
provider saves messages to a private mailbox rather than exposing links in logs.

Session state is stored in the database. An opaque signed token is sent in a
Secure, HttpOnly, SameSite=Strict cookie. Sessions have a fixed 24-hour lifetime,
without sliding refresh or cookie-based session caching. A successful login
creates a fresh token. Logout removes the server-side session, and password
reset revokes existing sessions. Protected APIs validate the session independently
of the page redirect, so bypassing the interface does not bypass authentication.

### 2.3 File encryption and lifecycle

Each upload receives a random 256-bit data-encryption key (DEK). Node.js crypto
encrypts the contents using AES-256-GCM with a random 96-bit IV and an
authentication tag. A separate AES-256-GCM operation wraps the DEK under the
deployment's 256-bit key-encryption key (KEK), using another random IV and tag.
PostgreSQL stores the wrapped key, IVs, tags, original filename, size and owner;
the file volume holds encrypted content under server-generated identifiers.
The KEK is supplied through the environment and is not stored alongside the data.

Downloads query metadata using both file ID and authenticated owner and require
READY status. The backend unwraps the DEK and authenticates the file ciphertext
before returning a download. A modified ciphertext or tag produces no plaintext
response. Temporary byte arrays for keys and plaintext are cleared where the
implementation owns them, although JavaScript and HTTP processing can create
copies whose lifetime is managed by the runtime.

Uploads require an idempotency key scoped to the user. A database transaction
reserves the operation and metadata before encrypted bytes are written. A
fingerprint distinguishes a retry from different content submitted under the
same key. Files move through UPLOADING, READY, DELETING and FAILED states.
Immutable generations, exclusive creation, atomic publication and worker leases
prevent an expired writer from replacing the selected generation. A lost HTTP
response can be resolved through an owner-scoped operation receipt.

Deletion accepts a durable intent, immediately hides the file, and returns 202.
The worker removes encrypted generations and metadata before marking the
receipt successful. Recovery and cleanup have bounded retries and retain an
attention state when intervention is needed. This provides logical deletion;
it does not prove physical erasure from SSDs, snapshots or backups. Backup
retention and access to historical wrapped keys require separate operational
controls.

### 2.4 Validation, search and quotas

New uploads accept TXT, CSV, JSON, PDF, PNG and JPEG files up to 25 MiB. The
backend validates names and extensions, rejects path separators and control
characters, checks text encoding or binary signatures, and limits actual
multipart request bytes. Client-supplied MIME types are not authoritative.
Uploads are never executed, included in templates, previewed or extracted.
Original filenames are metadata and never become storage paths. Downloads use
attachment disposition, application/octet-stream and nosniff.

Filename search uses bounded, literal, case-insensitive matching within the
authenticated owner's READY files. Pagination accepts only supported page sizes.
A configurable per-user quota defaults to 100 MiB. The reservation transaction
locks the owner's row before checking usage, preventing concurrent requests
from reserving more than the available space. Uploads in progress, deleting
files and failed uploads awaiting cleanup continue to reserve their bytes.
The UI reports used/reserved space independently of the current search filter.

## 3. Security Analysis

### 3.1 Cross-site request forgery

All authentication and file mutations pass through one security wrapper. It
requires an exact match to the configured public Origin, rejects foreign Fetch
Metadata, and validates a signed double-submit CSRF token. `/api/csrf` issues
the token in JSON and a host-only Secure, HttpOnly, SameSite=Strict cookie;
the client echoes it in `X-CSRF-Token`. The signature uses HMAC-SHA-256 with the
authentication secret, and comparisons use constant-time equality. The
`__Host-` prefix prevents sibling-domain cookies from overriding it. The
wrapper checks these values before parsing a mutation body or changing state.
Better Auth's built-in origin and callback checks remain enabled.

An attacker page cannot read the token because of browser same-origin rules,
cannot supply the custom header in a simple HTML form, and cannot pass the
exact-origin comparison. Tests also submit forged requests with a victim's
cookies through an HTTP client, removing reliance on SameSite cookie behaviour
alone. Emailed verification and recovery GET links are the intentional exception
to ordinary form processing and require expiring account-access tokens.

### 3.2 Cross-site scripting and file inclusion

React renders user-controlled names as text. No filename or account name is
inserted as raw HTML. Each dynamically rendered page receives a fresh random
CSP script nonce. Production CSP denies inline event handlers, unapproved
scripts, objects, frames and foreign form targets; production scripts allow
neither unsafe-inline nor unsafe-eval. Style attributes remain permitted for
component positioning, while style elements are restricted. Downloaded content
is an inert attachment, not an application-origin preview.

Filesystem access accepts generated storage keys under a fixed root and rejects
traversal, symlinks and special files. Extensions and content signatures add
validation, but signatures are not a malware scanner. A legitimate PDF or image
may still contain dangerous content for a separate viewer. The application
does not make a claim that all accepted documents are harmless.

### 3.3 Injection and broken access control

Prisma query APIs bind values as parameters. Raw database operations use tagged
templates with separately bound values; request data is never concatenated
into SQL text. Search limits bound work and escape LIKE metacharacters so the
search remains a literal substring operation. Authentication inputs also pass
server-side schema validation.

Every file and receipt lookup includes the authenticated owner. Delete acceptance
rechecks ownership inside its database transaction. Listing, searching,
downloading, deleting, receipt polling and idempotency-key lookup all enforce
the same boundary. A valid identifier is not authorization. Foreign and absent
files return the same 404 response to avoid revealing which identifiers exist.

### 3.4 Error handling and auditability

Unexpected failures return a generic error without SQL text, storage paths,
cryptographic details or stack traces. A server-generated request ID connects
the response to its audit record. Logs contain a timestamp, fixed event name,
known user ID, trusted proxy source address, outcome, status and a safe error
code where available. Background jobs and anonymous requests use null identity
or address fields when those values are unavailable.

The logger copies only approved fields and never serializes an entire request,
error or authentication response. Passwords, cookies, CSRF/recovery tokens,
encryption keys, filenames and file contents are excluded. Nginx overwrites
forwarded address headers and its access log omits URLs. Local email delivery
uses a separate restricted mailbox. Audit storage still needs host-level access
controls, retention and protection from deletion; stdout JSON alone is not a
tamper-resistant audit service.

### 3.5 Security checks and observed results

Development validation on 13 November 2026 included unit checks, database and
filesystem fault tests, and HTTPS requests through the production Docker image
and nginx with a disposable PostgreSQL database. Real account registration,
email verification, password recovery and logout were exercised. Browser checks
covered normal file operations, contextual output escaping and CSP enforcement.
The development run passed 34 unit cases, 22 database/recovery cases and 16 HTTPS
cases. These figures describe that development run, including the dedicated
security checks performed at the time.

| Area | Input or attempt | Observed outcome |
| --- | --- | --- |
| CSRF | Cross-origin login, upload and deletion; missing or forged token | HTTP 403; the original user and file remained unchanged. |
| XSS | Filename `<svg onload=alert(1)>.txt`; account name containing markup | Names appeared as text. Parser-inserted script and event-handler payloads did not execute. |
| SQL injection | Search value `' OR 1=1 --` and a `DROP TABLE` payload | Search returned no matches; table contents were unchanged. Malformed identifiers were rejected. |
| Ownership | Bob requested Alice's file, deletion receipt and upload key | HTTP 404 for the foreign resources; Alice could still download the original content. |
| File validation | HTML/PHP extensions, fake PNG/PDF signatures and NUL-containing text | HTTP 422; malformed multipart was rejected with HTTP 400. |
| Resource limits | Oversized upload; two concurrent 700-byte uploads under a 1024-byte test quota | Oversized request returned HTTP 413. One concurrent upload succeeded and the other exceeded quota. |
| Integrity | One stored ciphertext byte was modified before an authorized download | HTTP 500 with a generic error and request ID; no plaintext was returned. |
| Sessions and logs | Reset password, replay the old session, log in again and log out; inspect audit records | Old sessions returned HTTP 401. Logs attributed outcomes without the tested passwords, tokens, keys or file content. |

The browser demonstration submitted an ordinary login form from a separate
HTTP origin to the application's HTTPS origin. It returned HTTP 403 with
`CSRF_REJECTED`; the victim tab retained its original identity. File upload,
download and asynchronous deletion also completed through the normal interface.

### 3.6 Limitations and further work

These tests provide evidence for the implemented controls rather than a proof
that every attack is impossible. Uploads/downloads are bounded but buffered in
memory. Logical quotas do not cover metadata, operation receipts, recovery
copies, backups or local mail. Large deployments need concurrency limits,
global capacity monitoring, retention policies and centralized protected logs.
The shared KEK remains a high-value secret; rotation and recovery procedures
need further operational development. Development certificates are not a
substitute for publicly trusted production TLS. Dependency auditing and updates
must continue after this checkpoint.

The production-only dependency audit performed on 13 November 2026 reported
zero known advisories after updating Next.js, Better Auth and Zod and pinning patched
transitive dependencies. The full audit at that time reported 33 development-tool
advisories (11 high, 18 moderate, 4 low) in tooling such as shadcn and Prisma's
development dependencies. Those findings were absent from the production-only audit;
build machines and developer tooling still require separate remediation and
review. A clean runtime audit is not a claim of a clean entire toolchain.

## 4. Conclusion

The application combines authenticated encrypted storage with owner-scoped
operations, CSRF protection, output escaping, CSP, validated file handling and
structured audit records. Durable operation receipts and the recovery worker
address failures that cannot be solved by a database transaction alone. The
checkpoint's evidence includes both legitimate end-to-end flows and explicit
attempts to forge mutations, inject input, tamper with ciphertext and access
another user's files.

The remaining work is chiefly operational: reviewing this report against the
complete course formatting requirements, improving capacity controls, planning
KEK rotation and backups, and protecting and retaining audit records. The system
should be presented as a tested course implementation with documented limits,
not as a production storage service that has undergone an independent audit.

## References and drafting note

- [Project specification](specification.pdf), requirements and checkpoint deliverables.
- [Implementation controls](SECURITY_CONTROLS.md) and [authentication model](AUTHENTICATION_AND_SESSION_MODEL.md).
- [Next.js CSP documentation](https://nextjs.org/docs/app/guides/content-security-policy).
- [Better Auth security documentation](https://better-auth.com/docs/reference/security).
- [OWASP CSRF Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html).

This draft was prepared with AI assistance from the repository and executed
checks. The supplied specification PDF contains the project chapter (pages
9-12); the referenced Section 1.3 is absent. The requested Introduction,
Implementation, Security Analysis and Conclusion sections are included, but
formatting requirements from that missing section still need to be checked.
