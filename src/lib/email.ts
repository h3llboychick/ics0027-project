import { Resend } from 'resend';
import type { User } from 'better-auth';

const resend = new Resend(process.env.RESEND_API_KEY);

export type EmailPayload = {
  user: User;
  url: string;
  token: string;
};

export async function sendVerificationEmail(
  { user, url, token }: EmailPayload,
  _request?: Request,
): Promise<void> {
  const { data, error } = await resend.emails.send({
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
  await resend.emails.send({
    from: 'Acme <onboarding@example.com>',
    to: user.email,
    subject: 'Reset your password',
    html: `Click <a href="${url}">here</a> to reset your password.`,
  });
}