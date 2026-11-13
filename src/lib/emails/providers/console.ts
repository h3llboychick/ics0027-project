import type { EmailProvider } from "./base";
import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { securityLog } from '@/lib/security/log';

export const consoleEmailProvider: EmailProvider = {
  async sendEmail(message): Promise<void> {
    const directory = process.env.EMAIL_OUTBOX_DIRECTORY ?? '.mail-outbox';
    await mkdir(directory, { recursive: true, mode: 0o700 });
    // Local mail is intentionally private delivery data, separate from logs.
    await writeFile(path.join(directory, `${randomUUID()}.txt`), [
      `From: ${message.from}`,
      `To: ${message.to}`,
      `Subject: ${message.subject}`,
      "",
      message.text,
    ].join("\n"), { mode: 0o600, flag: 'wx' });
    securityLog('email.local_delivery', { outcome: 'success' });
  },
};
