import { EMAIL_LOGO_CONTENT_ID } from "./logo";

export type EmailTemplate = {
  subject: string;
  html: string;
  text: string;
};

export type AuthEmailTemplateInput = {
  name?: string | null;
  url: string;
  expiresInSeconds: number;
};

type ActionEmailInput = AuthEmailTemplateInput & {
  subject: string;
  preview: string;
  title: string;
  description: string;
  message: string;
  action: string;
  notice: string;
};

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderActionEmail(input: ActionEmailInput): EmailTemplate {
  const name = input.name?.trim();
  const greeting = name ? `Hi ${name},` : "Hi,";
  const minutes = Math.ceil(input.expiresInSeconds / 60);
  const duration = minutes % 60 === 0
    ? `${minutes / 60} ${minutes === 60 ? "hour" : "hours"}`
    : `${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
  const expiration = `This link expires in ${duration}.`;
  const url = escapeHtml(input.url);

  return {
    subject: input.subject,
    text: [
      "SecureFileManager",
      input.title,
      greeting,
      input.message,
      `${input.action}:\n${input.url}`,
      expiration,
      input.notice,
    ].join("\n\n"),
    // Keep core styles inline: emails cannot use the application's Tailwind CSS.
    html: `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="light" />
    <title>${escapeHtml(input.subject)}</title>
    <style>
      @media only screen and (max-width: 520px) {
        .email-shell { padding: 28px 16px !important; }
        .email-card { padding: 24px 20px !important; }
      }
    </style>
  </head>
  <body style="margin: 0; padding: 0; background-color: #ffffff; color: #0a0a0a; font-family: Arial, Helvetica, sans-serif; -webkit-text-size-adjust: 100%;">
    <div aria-hidden="true" style="display: none; max-height: 0; overflow: hidden; opacity: 0; font-size: 1px; line-height: 1px; mso-hide: all;">${escapeHtml(input.preview)}</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: #ffffff;">
      <tr>
        <td class="email-shell" align="center" style="padding: 48px 24px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width: 100%; max-width: 480px; table-layout: fixed;">
            <tr>
              <td align="center" style="padding: 0 0 28px;">
                <img src="cid:${EMAIL_LOGO_CONTENT_ID}" alt="SecureFileManager" width="40" height="40" style="display: block; width: 40px; height: 40px; border: 0;" />
              </td>
            </tr>
            <tr>
              <td class="email-card" style="padding: 32px; border: 1px solid #e5e5e5; border-radius: 14px; background-color: #ffffff;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width: 100%; table-layout: fixed;">
                  <tr>
                    <td>
                      <h1 style="margin: 0 0 8px; color: #0a0a0a; font-size: 22px; line-height: 30px; font-weight: 600; letter-spacing: -0.5px;">${escapeHtml(input.title)}</h1>
                      <p style="margin: 0; color: #737373; font-size: 14px; line-height: 22px;">${escapeHtml(input.description)}</p>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding: 28px 0 24px;">
                      <p style="margin: 0 0 12px; color: #0a0a0a; font-size: 14px; line-height: 22px; overflow-wrap: anywhere;">${escapeHtml(greeting)}</p>
                      <p style="margin: 0; color: #0a0a0a; font-size: 14px; line-height: 22px;">${escapeHtml(input.message)}</p>
                    </td>
                  </tr>
                  <tr>
                    <td>
                      <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                        <tr>
                          <td align="center" bgcolor="#171717" style="border-radius: 8px; background-color: #171717;">
                            <a href="${url}" style="display: inline-block; padding: 12px 20px; border: 1px solid #171717; border-radius: 8px; background-color: #171717; color: #fafafa; font-size: 14px; line-height: 20px; font-weight: 600; text-align: center; text-decoration: none; mso-padding-alt: 0;">${escapeHtml(input.action)}</a>
                          </td>
                        </tr>
                      </table>
                      <p style="margin: 12px 0 0; color: #737373; font-size: 12px; line-height: 20px;">${escapeHtml(expiration)}</p>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding: 24px 0;">
                      <p style="margin: 0 0 8px; color: #737373; font-size: 12px; line-height: 20px;">If the button doesn't work, copy and paste this link into your browser:</p>
                      <p style="margin: 0; font-size: 12px; line-height: 20px; word-break: break-all; overflow-wrap: anywhere;">
                        <a href="${url}" style="color: #737373; text-decoration: underline; word-break: break-all; overflow-wrap: anywhere;">${url}</a>
                      </p>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding: 20px 0 0; border-top: 1px solid #e5e5e5;">
                      <p style="margin: 0; color: #737373; font-size: 12px; line-height: 20px;">${escapeHtml(input.notice)}</p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td align="center" style="padding: 20px 12px 0; color: #737373; font-size: 12px; line-height: 20px;">
                SecureFileManager &middot; Account security
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`,
  };
}

export function createVerificationEmail(input: AuthEmailTemplateInput): EmailTemplate {
  return renderActionEmail({
    ...input,
    subject: "Verify your email · SecureFileManager",
    preview: "Confirm your email address to finish setting up your account.",
    title: "Verify your email",
    description: "One last step to get started.",
    message: "Thanks for creating a SecureFileManager account. Confirm your email address to start securely storing and managing your files.",
    action: "Verify email address",
    notice: "If you didn't create a SecureFileManager account, you can ignore this email.",
  });
}

export function createPasswordResetEmail(input: AuthEmailTemplateInput): EmailTemplate {
  return renderActionEmail({
    ...input,
    subject: "Reset your password · SecureFileManager",
    preview: "Use this link to choose a new password for your account.",
    title: "Reset your password",
    description: "Choose a new password for your account.",
    message: "We received a request to reset the password for your SecureFileManager account. Use the button below to choose a new password.",
    action: "Reset password",
    notice: "If you didn't request a password reset, you can ignore this email. Your password will stay the same.",
  });
}
