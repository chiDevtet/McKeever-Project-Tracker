import nodemailer from "nodemailer";
import { prisma } from "@/server/db";
import { env } from "@/server/env";

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
  /** Category for the development outbox (invitation, password-reset, ...). */
  kind: string;
}

/**
 * Mail delivery. "outbox" stores messages in the database for the
 * development-only /dev/outbox page; "smtp" delivers through the configured
 * server. Message bodies (which can contain one-time links) are never logged.
 */
export async function sendMail(message: MailMessage): Promise<void> {
  const cfg = env();
  if (cfg.MAIL_TRANSPORT === "outbox") {
    await prisma.mailOutbox.create({ data: { toAddress: message.to, subject: message.subject, text: message.text, html: message.html ?? null, kind: message.kind } });
    return;
  }
  const transport = nodemailer.createTransport({
    host: cfg.SMTP_HOST,
    port: cfg.SMTP_PORT,
    secure: cfg.SMTP_SECURE,
    auth: cfg.SMTP_USER ? { user: cfg.SMTP_USER, pass: cfg.SMTP_PASSWORD } : undefined,
  });
  await transport.sendMail({ from: cfg.MAIL_FROM, to: message.to, subject: message.subject, text: message.text, html: message.html });
}

/** Fire-and-forget delivery that records failures without leaking the body. */
export function sendMailInBackground(message: MailMessage): void {
  void sendMail(message).catch((err: unknown) => {
    console.error(`[mail] delivery failed kind=${message.kind}: ${err instanceof Error ? err.message : String(err)}`);
  });
}
