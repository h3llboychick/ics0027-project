export type EmailAttachment = {
  filename: string;
  // Base64-encoded file contents, ready for delivery.
  content: string;
  contentType: string;
  contentId?: string;
};

export type EmailMessage = {
  from: string;
  to: string;
  subject: string;
  html: string;
  text: string;
  attachments?: EmailAttachment[];
};

export interface EmailProvider {
  sendEmail(message: EmailMessage): Promise<void>;
}
