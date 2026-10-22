import type { EmailProvider } from "./emails/providers/base";
import { consoleEmailProvider } from "./emails/providers/console";
import { resendEmailProvider } from "./emails/providers/resend";
import { EmailService, type EmailPayload } from "./emails/service";

export { EMAIL_LINK_EXPIRES_IN_SECONDS } from "./emails/service";

let emailService: EmailService | undefined;

// Resolve configuration on first use so Next.js builds do not need email credentials.
export function getEmailService(): EmailService {
  if (emailService) return emailService;

  const providerName = process.env.EMAIL_PROVIDER?.trim() ?? "console";
  let provider: EmailProvider;

  switch (providerName) {
    case "console":
      provider = consoleEmailProvider;
      break;
    case "resend":
      provider = resendEmailProvider;
      break;
    default:
      throw new Error("EMAIL_PROVIDER must be either console or resend");
  }

  const from = process.env.EMAIL_FROM?.trim() || "SecureFileManager <onboarding@resend.dev>";
  return (emailService = new EmailService(provider, from));
}

export async function sendVerificationEmail(payload: EmailPayload): Promise<void> {
  await getEmailService().sendVerificationEmail(payload);
}

export async function sendResetPassword(payload: EmailPayload): Promise<void> {
  await getEmailService().sendResetPassword(payload);
}
