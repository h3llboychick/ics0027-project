import type { EmailProvider } from "./base";

export const consoleEmailProvider: EmailProvider = {
  async sendEmail(message): Promise<void> {
    console.log([
      "--- Email (console provider) ---",
      `From: ${message.from}`,
      `To: ${message.to}`,
      `Subject: ${message.subject}`,
      "",
      message.text,
      "--- End email ---",
    ].join("\n"));
  },
};
