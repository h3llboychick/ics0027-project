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

## Planned Features

- Registration and login using email and password
- Opaque, cookie-based sessions managed by Better Auth
- Uploading files over TLS and encrypting them before they are written to storage
- Listing and searching only the authenticated user's files
- Downloading and decrypting files after a server-side ownership check
- Deleting files owned by the authenticated user
- Per-user storage quotas and upload-size limits
- Structured security logging without passwords, session tokens, encryption keys, or file contents

## Planned Routes

### User-facing routes

| Route | Access | Purpose |
| --- | --- | --- |
| `/` | Public | Landing page; redirects authenticated users to `/files`. |
| `/login` | Public | Email-and-password login page. |
| `/register` | Public | Account-registration page. |
| `/files` | Authenticated | File-management page for listing, searching, uploading, downloading, and deleting the current user's files. |

### Application API

| Method | Route | Access | Purpose |
| --- | --- | --- | --- |
| `GET` | `/api/health` | Public | Reports whether the application is running. It must not disclose configuration, dependency, or secret information. |
| `GET` | `/api/files` | Authenticated | Lists the current user's file metadata. An optional `search` query parameter filters by filename. |
| `POST` | `/api/files` | Authenticated | Uploads a file using `multipart/form-data`. The backend validates the request, encrypts the file, and stores its metadata. |
| `GET` | `/api/files/{id}` | Authenticated owner | Checks ownership, decrypts the requested file, and returns it as a download. |
| `DELETE` | `/api/files/{id}` | Authenticated owner | Checks ownership and deletes the file and its associated metadata. |

Every file endpoint validates the session on the server. Routes containing `{id}` use an opaque, server-generated file identifier and verify that the file's `ownerId` matches the authenticated user's ID.

### Authentication API

Better Auth will be mounted using the recommended Next.js catch-all route at `/api/auth/[...all]`. The main operations used by this application are:

| Method | Effective route | Purpose |
| --- | --- | --- |
| `POST` | `/api/auth/sign-up/email` | Registers a user with an email address and password. |
| `POST` | `/api/auth/sign-in/email` | Authenticates a user and creates a server-side session. |
| `POST` | `/api/auth/sign-out` | Revokes the current session and clears its cookie. |
| `GET` | `/api/auth/get-session` | Returns the current authenticated session, if one exists. |

The catch-all handler may expose additional Better Auth framework endpoints, but they are not part of the application's public feature set unless explicitly enabled and documented.

## Running the Application Locally

The application will be runnable locally using Docker Compose. Detailed setup instructions, environment-variable requirements, TLS configuration, and startup commands will be added as the application is developed.

## Security & Threat Model

For detailed information about the security architecture, threat analysis, and mitigation strategies implemented in this system, see [THREAT_MODEL.md](docs/THREAT_MODEL.md) and [AUTHENTICATION_AND_SESSION_MODEL.md](docs/AUTHENTICATION_AND_SESSION_MODEL.md).

---

> **Authorship note:** I wrote the content of this document. AI assistance was used to improve its wording and structure.
