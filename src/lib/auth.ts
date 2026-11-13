import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { prisma } from "./prisma";
import { hash, verify } from "@/lib/password_hashing";
import { EMAIL_LINK_EXPIRES_IN_SECONDS, sendVerificationEmail, sendResetPassword } from "./email";
import { securityLog } from './security/log';

export const auth = betterAuth({
  appName: "SecureFileManager",
  logger: {
    level: 'warn',
    // Library messages can contain attacker-controlled URLs and error details.
    log: () => securityLog('auth.internal', { outcome: 'error', code: 'AUTH_LIBRARY_ERROR' }),
  },
  database: prismaAdapter(prisma, {
    provider: "postgresql",
  }),
  session: {
    expiresIn: 60 * 60 * 24,
    disableSessionRefresh: true,
    cookieCache: {
      enabled: false,
    },
  },
  advanced: {
    useSecureCookies: true,
    defaultCookieAttributes: {
      httpOnly: true,
      secure: true,
      sameSite: "strict",
      path: "/",
    },
  },
  emailAndPassword: {
    enabled: true,
    disableSignUp: false,
    requireEmailVerification: true,
    minPasswordLength: 8,
    maxPasswordLength: 32,
    revokeSessionsOnPasswordReset: true,
    sendResetPassword,
    resetPasswordTokenExpiresIn: EMAIL_LINK_EXPIRES_IN_SECONDS,
    password: {
      hash,
      verify,
    },
  },
  emailVerification: {
    sendVerificationEmail,
    sendOnSignUp: true,
    autoSignInAfterVerification: true,
    expiresIn: EMAIL_LINK_EXPIRES_IN_SECONDS,
  },
});
