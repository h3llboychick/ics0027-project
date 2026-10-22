import { Resend } from "resend";
import type { EmailProvider } from "./base";

let resend: Resend | undefined;

function getResend(): Resend {
  if (resend) return resend;

  const apiKey = process.env.RESEND_API_KEY?.trim();

  if (!apiKey) {
    throw new Error("RESEND_API_KEY is required to send email");
  }

  return (resend = new Resend(apiKey));
}

export const resendEmailProvider: EmailProvider = {
  async sendEmail(message): Promise<void> {
    const { error } = await getResend().emails.send(message);

    if (error) {
      throw new Error("Resend failed to send email", { cause: error });
    }
  },
};
