import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { prisma } from "./prisma";
import { hash, verify } from "@/lib/password_hashing";
import { sendVerificationEmail, sendResetPassword } from "./email";

export const auth = betterAuth({
  appName: "SecureFileManager",
  database: prismaAdapter(prisma, {
    provider: "postgresql",
  }),
  emailAndPassword: {
    enabled: true,
    disableSignUp: false,
    requireEmailVerification: true,
    minPasswordLength: 8,
    maxPasswordLength: 32,
    sendResetPassword,
    resetPasswordTokenExpiresIn: 3600,
    password: {
      hash,
      verify,
    },
  },
  emailVerification: {
    sendVerificationEmail,
    sendOnSignUp: true,
    autoSignInAfterVerification: true,
    expiresIn: 3600,
  },
});