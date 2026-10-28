# Secure Web-Based File Encryption and Management System

This project is a web-based application designed to securely store and manage files for users. It provides encryption capabilities, allowing users to upload, access, and delete files securely. The system combines modern web technologies with strong cryptographic practices to ensure user privacy and data security.

## System Architecture Diagram
![System Architecture Diagram](docs/System%20Architecture%20Diagram.png)

## Technology Stack

1. Frontend & Backend: **Next.js**
[Next.js](https://nextjs.org/) is a modern framework that provides unified full-stack capabilities. It simplifies development by allowing both frontend and backend logic to be written in JavaScript or TypeScript. Its built-in route handlers eliminate the need for a separate backend application while maintaining a clean separation of concerns.

2. Database: **PostgreSQL + Prisma**
[PostgreSQL](https://www.postgresql.org/) is a robust, reliable relational database that ensures data durability and consistency. [Prisma](https://www.prisma.io/) serves as an ORM layer, providing type-safe database queries and automatic schema management. Together, they simplify database interactions while maintaining query performance and data integrity.

3. File Storage: **Docker Volume (Encrypted at Rest)**
Using a Docker volume for file storage keeps data local and allows for persistent storage across container deployments. All files are encrypted before being written to disk, ensuring that even if the storage is compromised, the data remains protected.

4. Encryption & Hashing: **Node.js Crypto + argon2**
The native Node.js [crypto](https://nodejs.org/api/crypto.html) module handles file encryption and decryption. [argon2](https://github.com/ranisalt/node-argon2/) is used for password hashing, providing strong protection against offline password-cracking attacks compared with older password-hashing algorithms.

5. Web Server & TLS: **nginx**
[Nginx](https://nginx.org) acts as a reverse proxy and terminates TLS connections. TLS protects data in transit between the browser and the server, while file encryption at rest is performed separately by the application.

6. Deployment: **Docker Compose**
Docker Compose simplifies deployment by defining and orchestrating all services (application, database, nginx, volumes) in a single configuration file. This ensures consistency across different environments (development, testing, production).

## Features

- Registration and login using email and password
- Required email verification and password reset through Better Auth
- Styled HTML and plain-text emails, with the application's lock logo in HTML messages
- Email delivery through Resend or application logs, selected with environment variables
- Opaque, cookie-based sessions managed by Better Auth, with a fixed 24-hour lifetime and Secure, HttpOnly, SameSite=Strict cookies
- Uploading files over TLS and encrypting them before they are written to storage
- Listing and paginating only the authenticated user's files
- Downloading and decrypting files after a server-side ownership check
- Deleting files owned by the authenticated user
- Backend validation of filenames and a 25 MiB per-file upload limit; nginx applies a separate request-body limit

Planned features:

- Filename search
- Per-user storage quotas
- A public `/api/health` endpoint
- Structured security logging without passwords, session tokens, encryption keys, or file contents

## Routes

### User-facing routes

| Route | Access | Purpose |
| --- | --- | --- |
| `/` | Authenticated | File-management page for listing, paginating, uploading, downloading, and deleting the current user's files. |
| `/sign-in` | Public | Email-and-password sign in page. |
| `/sign-up` | Public | Account-registration page. |
| `/forgot-password` | Public | Requests a password-reset link. |
| `/reset-password` | Public | Sets a new password using the emailed reset link. |
| `/email-verification-result` | Public | Email verification success or recovery page. |

### Application API

| Method | Route | Access | Purpose |
| --- | --- | --- | --- |
| `GET` | `/api/files` | Authenticated | Lists the current user's file metadata. Supports `page` (default `1`) and `pageSize` (`10`, `20`, or `40`; default `10`). |
| `POST` | `/api/files` | Authenticated | Uploads a file using `multipart/form-data`. The backend validates the request, encrypts the file, and stores its metadata. |
| `GET` | `/api/files/{id}` | Authenticated owner | Checks ownership, decrypts the requested file, and returns it as a download. |
| `DELETE` | `/api/files/{id}` | Authenticated owner | Checks ownership and deletes the file and its associated metadata. |

Every file endpoint validates the session on the server. Routes containing `{id}` use an opaque, server-generated file identifier and verify that the file's `ownedBy` field matches the authenticated user's ID.

### Authentication API

Better Auth is mounted through the Next.js catch-all route at `/api/auth/[...all]`. The main operations used by this application are:

| Method | Effective route | Purpose |
| --- | --- | --- |
| `POST` | `/api/auth/sign-up/email` | Registers a user with an email address and password. |
| `POST` | `/api/auth/sign-in/email` | Authenticates a user and creates a server-side session. |
| `POST` | `/api/auth/sign-out` | Revokes the current session and clears its cookie. |
| `GET` | `/api/auth/get-session` | Returns the current authenticated session, if one exists. |
| `POST` | `/api/auth/send-verification-email` | Requests a fresh verification link. |
| `GET` | `/api/auth/verify-email` | Verifies the emailed token and redirects to the verification-result page. |
| `POST` | `/api/auth/request-password-reset` | Requests a password-reset email. |
| `GET` | `/api/auth/reset-password/{token}` | Opens the password-reset form from an emailed link. |
| `POST` | `/api/auth/reset-password` | Sets a new password using a valid reset token. |

The catch-all handler may expose additional Better Auth framework endpoints, but they are not part of the application's public feature set unless explicitly enabled and documented.

## Running the Application with Docker

Docker Compose runs the Next.js app, PostgreSQL, and an nginx TLS reverse proxy. The database and encrypted files are kept in named volumes. You need Docker with the Compose plugin, Node.js 24 with Corepack, and OpenSSL.

Run the full setup from the repository root:

```sh
./scripts/setup-dev.sh
```

The script asks for the PostgreSQL database/user, Better Auth secret, PostgreSQL password, file-encryption KEK, and email provider. On a fresh setup, leave the Better Auth secret, PostgreSQL password, and KEK blank to generate random values. Existing values are kept when you press Enter. The default email provider is `console`, which supports verification and password reset without an email-service account. Choosing `resend` prompts for a required Resend API key.

The script installs dependencies with Corepack/pnpm, generates the Prisma client and TLS certificates, builds and starts the services, then applies database migrations. It keeps `.env` and private keys out of Git. It does not change your hosts file or OS/browser trust store, so add this entry if needed and trust the local CA certificate:

```text
127.0.0.1 secure-file-manager.dev
```

Trust `certs/ca/root-ca.crt`, then open [https://secure-file-manager.dev:8443](https://secure-file-manager.dev:8443). PostgreSQL is available on port `5432` from your machine and on `db:5432` from the app container.

Useful commands:

```sh
docker compose logs -f app       # follow application logs
docker compose down              # stop and remove containers; keep database and encrypted files
docker compose down -v           # permanently delete both database and encrypted-file volumes
```

The app image uses Next.js standalone output and a multi-stage build. Compose waits for PostgreSQL's health check before starting the app. Migrations run from `setup-dev.sh`; they do not run automatically when starting Compose directly.

When upgrading an existing installation, run `corepack pnpm exec prisma migrate deploy` with the database running. The session-policy migration caps existing session expiry at 24 hours after creation without extending earlier expiry times. Sessions already older than 24 hours will require a new sign-in.

Checks available after installing dependencies:

```sh
corepack pnpm test               # download-header regression tests (Node.js 24)
corepack pnpm lint
corepack pnpm build
```

## Email Verification and Password Reset

Better Auth generates and validates the verification and password-reset links. Both expire after one hour. Verification is required before signing in; opening a valid verification link also signs the user in. Sessions expire after 24 hours without sliding refresh, and session-cookie caching is disabled so logout and password-reset revocation take effect on the next request. The setup uses HTTPS because session cookies are always Secure.

`EmailService` in `src/lib/emails/service.ts` renders the templates and prepares messages, including the sender, recipient, and inline logo attachment. Providers implement `sendEmail(message)` and only deliver the finished content. `src/lib/email.ts` selects the provider and connects the service to Better Auth's callbacks.

The templates in `src/lib/emails/email-templates.ts` share the application's monochrome colors, rounded card, dark action button, and lock icon. Both include a personalized greeting, expiration information, a copyable link, and a plain-text alternative. Dynamic HTML values are escaped.

The HTML header uses a PNG rendition of the application's Lucide `LockKeyhole` logo, embedded as a CID attachment; it does not require an externally hosted image. The image is bundled in `src/lib/emails/logo.ts` so standalone Docker builds can send it without additional asset configuration. Plain-text and console messages retain the application name.

Email delivery is configured in `.env`; see `.env.example` for all settings:

| Variable | Purpose |
| --- | --- |
| `EMAIL_PROVIDER` | `console` prints messages to server logs; `resend` delivers through Resend. Defaults to `console` when unset. Unsupported or empty values cause an error when email is used. |
| `EMAIL_FROM` | Sender name and address. Defaults to `SecureFileManager <onboarding@resend.dev>`. For real Resend recipients, configure a sender on your verified domain. |
| `RESEND_API_KEY` | Required only for the `resend` provider. |

For local development or a demonstration, set `EMAIL_PROVIDER=console`. No email-service account or API key is required. Register an account or request a password reset, then follow the application logs:

```sh
docker compose logs -f app
```

Open the link printed for your email address in the browser. Console messages include the sender, recipient, subject, and plain-text body. These links grant account access, so keep the logs private. Provider selection is independent of `NODE_ENV`, so console delivery also works with the production build used by Docker.

To send to inboxes, set `EMAIL_PROVIDER=resend`, supply `RESEND_API_KEY`, and configure `EMAIL_FROM` for your Resend sender. Delivery failures reject the send operation and never switch providers automatically. Better Auth handles errors from its email callbacks; the service does not change its authentication responses. Configuration is resolved on first use, so builds do not require email credentials. Restart the application after changing email settings; for Docker, recreate the app container with `docker compose up -d app`.

## Security & Threat Model

For the security architecture, threat analysis, and planned mitigations, see [THREAT_MODEL.md](docs/THREAT_MODEL.md). The implemented authentication and session policy is described in [AUTHENTICATION_AND_SESSION_MODEL.md](docs/AUTHENTICATION_AND_SESSION_MODEL.md).

---

> **Authorship note:** I wrote the content of this document. AI assistance was used to improve its wording and structure.
