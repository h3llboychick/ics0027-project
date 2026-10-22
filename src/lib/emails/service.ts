import type { User } from "better-auth";
import { createPasswordResetEmail, createVerificationEmail, type EmailTemplate } from "./email-templates";
import { EMAIL_LOGO_CONTENT_ID, EMAIL_LOGO_PNG_BASE64 } from "./logo";
import type { EmailMessage, EmailProvider } from "./providers/base";

export const EMAIL_LINK_EXPIRES_IN_SECONDS = 3600;

export type EmailPayload = {
  user: User;
  url: string;
  token: string;
};

export class EmailService {
  constructor(
    private readonly provider: EmailProvider,
    private readonly from: string,
  ) {}

  async sendEmail(message: Omit<EmailMessage, "from">): Promise<void> {
    await this.provider.sendEmail({ ...message, from: this.from });
  }

  async sendVerificationEmail({ user, url }: EmailPayload): Promise<void> {
    const template = createVerificationEmail({
      name: user.name,
      url,
      expiresInSeconds: EMAIL_LINK_EXPIRES_IN_SECONDS,
    });

    await this.sendAuthEmail(user.email, template);
  }

  async sendResetPassword({ user, url }: EmailPayload): Promise<void> {
    const template = createPasswordResetEmail({
      name: user.name,
      url,
      expiresInSeconds: EMAIL_LINK_EXPIRES_IN_SECONDS,
    });

    await this.sendAuthEmail(user.email, template);
  }

  private async sendAuthEmail(to: string, template: EmailTemplate): Promise<void> {
    await this.sendEmail({
      to,
      ...template,
      attachments: [{
        filename: "lock-logo.png",
        content: EMAIL_LOGO_PNG_BASE64,
        contentType: "image/png",
        contentId: EMAIL_LOGO_CONTENT_ID,
      }],
    });
  }
}
