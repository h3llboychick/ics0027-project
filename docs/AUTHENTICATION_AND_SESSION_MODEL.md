## Authentication and session model

This documents present the authentication and session model for secure file storage application.

### Library
In this project authentication is implemented using [Better Auth](https://better-auth.com/). It's a framework agnostic library for TypeScript. It has a built-in support for secure email and password authentication, socia sign-on, built-in rate limiter, automatic DB management and configurable session security settings (https://better-auth.com/docs/introduction). Next.js creators recommend using such frameworks for implementing auth solutions:
> *"While you can implement a custom auth solution, for increased security and simplicity, we recommend using an authentication library. These offer built-in solutions for authentication, session management, and authorization, as well as additional features such as social logins, multi-factor authentication, and role-based access control. You can find a list in the Auth Libraries section."* 
>
> Source: https://nextjs.org/docs/app/guides/authentication

### Authentication Model & Session Management
Email/password credentials model is used for this project. Password are hashed using Argon2id algorithm and never storred/loggen in plaintext. After successful registration or login, Better Auth handles creation of session record in database and sends the client an opaque, signed sessioon identifier in a cookie. This cookies doesn't contain any sensitive information. Information about the session is stored in the correpsonding database record. This record contains the id of the user whom the session belongs, expiration time, creation timestamp and some client metadata such as the IP address and user agent.

### Sesssion Cookie
Session cookie is configured with the following attributes:
- `HttpOnly`: ensures that session cookie can't be accessed, read or modified by client-side scripts
- `Secure`: ensure that the cookies can only sent over HTTPS
- `Same-Site=Strict`: prevents browser from sending the cookies with cross-site requests.
- `Path=/`: makes the session cookie available to application routes

Session identifiers are accepted only from cookies. We never accept them through URL parameters or request bodies. Authentcation and CSRF(Origin checks, Fetch Metadata Protection for First-Login CSRF) checks provided by Better Auth remain enabled.
> More about CSRF protection and authentication/session management provided by BetterAuth: https://better-auth.com/docs/reference/security 

### Session Lifetime and Revocation
Each session have a lifetime of 24 hours. Automatic sliding
session refresh is disabled, so a session cannot remain active indefinitely. Logging out deletes the server-side session and clears the browser cookie. Sessions are also revoked after password reset. Cookie-based session caching is disabled so that revocation takes effect on the next request.

### Session Fixation Prevention

The application never upgrades an existing anonymous or
client-supplied session identifier into an authenticated session.
Successful login and registration create a new server-generated session
with a new unpredictable token, which replaces any previous session
cookie.

After security-sensitive authentication changes, such as password reset,
existing sessions are revoked and a new login is required. Session
identifiers are accepted only through the protected session cookie and
are never read from URLs. These measures prevent an attacker from
selecting a session identifier and causing a victim to authenticate into
that session.

Every protected page, Server Action, and Route Handler validates the
session on the server. File access additionally checks that the
authenticated user's ID matches the file's `ownerId`; possession of a
valid session does not grant access to another user's files.

---

> **Authorship note:** I wrote the content of this document. AI assistance was used to improve its wording and structure.
