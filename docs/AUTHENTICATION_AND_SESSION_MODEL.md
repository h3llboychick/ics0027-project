## Authentication and session model

This document describes the authentication and session model for the secure file storage application.

### Library
Authentication is implemented using [Better Auth](https://better-auth.com/), a TypeScript library with email/password authentication, rate limiting, database adapters, and configurable session security settings. This application enables email/password authentication with required email verification. Next.js recommends using an authentication library:
> *"While you can implement a custom auth solution, for increased security and simplicity, we recommend using an authentication library. These offer built-in solutions for authentication, session management, and authorization, as well as additional features such as social logins, multi-factor authentication, and role-based access control. You can find a list in the Auth Libraries section."* 
>
> Source: https://nextjs.org/docs/app/guides/authentication

### Authentication Model & Session Management
Passwords are hashed with Argon2id and are never stored or logged in plaintext. Registration sends an email-verification link; an unverified account cannot sign in. Successful login or automatic sign-in after verification creates a database session and sends a signed, opaque session token in a cookie. The cookie contains no user details, but its token grants account access and must be protected. The database session records the user ID, expiration time, timestamps, IP address, and user agent.

### Session Cookie
Session cookie is configured with the following attributes:
- `HttpOnly`: ensures that session cookie can't be accessed, read or modified by client-side scripts
- `Secure`: ensures that cookies are sent only over HTTPS, including in development
- `SameSite=Strict`: prevents the browser from sending the cookie with cross-site requests
- `Path=/`: makes the session cookie available to application routes

Session identifiers are accepted only from cookies, never URL parameters or request bodies. Better Auth's authentication and CSRF checks remain enabled for its authentication endpoints. CSRF protection for the application's file-write endpoints is tracked separately in the threat model.
> More about CSRF protection and authentication/session management provided by BetterAuth: https://better-auth.com/docs/reference/security 

### Session Lifetime and Revocation
The settings are explicit in `src/lib/auth.ts`. Each session has a lifetime of 24 hours. Automatic sliding
session refresh is disabled, so a session cannot remain active indefinitely. Logging out deletes the server-side session and clears the browser cookie. Sessions are also revoked after password reset. Cookie-based session caching is disabled so that revocation takes effect on the next request.

The `20261028120000_cap_session_lifetime` database migration applies the 24-hour cap to sessions created under the previous policy. It preserves any earlier expiry. Run the migrations when upgrading an existing database; sessions created more than 24 hours ago will then be expired.

### Session Fixation Prevention

The application never upgrades an existing anonymous or
client-supplied session identifier into an authenticated session.
Successful login and automatic sign-in after email verification create a new server-generated session
with a new unpredictable token, which replaces any previous session
cookie.

After security-sensitive authentication changes, such as password reset,
existing sessions are revoked and a new login is required. Session
identifiers are accepted only through the protected session cookie and
are never read from URLs. These measures prevent an attacker from
selecting a session identifier and causing a victim to authenticate into
that session.

The protected dashboard and every file Route Handler validate the
session on the server. File access additionally checks that the
authenticated user's ID matches the file's `ownedBy` field; possession of a
valid session does not grant access to another user's files.

---

> **Authorship note:** I wrote the content of this document. AI assistance was used to improve its wording and structure.
