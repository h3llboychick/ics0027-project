import { Resend } from 'resend';
import type { User } from 'better-auth';

let resend: Resend | undefined;

function getResend(): Resend {
  const apiKey = process.env.RESEND_API_KEY;

  if (!apiKey) {
    throw new Error("RESEND_API_KEY is required to send email");
  }

  return (resend ??= new Resend(apiKey));
}

export type EmailPayload = {
  user: User;
  url: string;
  token: string;
};

export async function sendVerificationEmail(
  { user, url, token }: EmailPayload,
  _request?: Request,
): Promise<void> {
  const { data, error } = await getResend().emails.send({
    from: 'Acme <onboarding@resend.dev>',
    to: user.email,
    subject: 'Verify your email',
    html: `Click <a href="${url}">here</a> to verify your email.`,
  });

  if (error) console.error(error);
  console.log(data);
}

export async function sendResetPassword(
  { user, url, token }: EmailPayload,
  _request?: Request,
): Promise<void> {
  await getResend().emails.send({
    from: 'Acme <onboarding@resend.dev>',
    to: user.email,
    subject: 'Reset your password',
    html: `Click <a href="${url}">here</a> to reset your password.`,
  });
}
