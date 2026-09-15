import nodemailer from "nodemailer";
import { env } from "../../config/env.js";

export const emailEnabled = !!env.SMTP_HOST;

const transport = nodemailer.createTransport({
  host: env.SMTP_HOST,
  port: env.SMTP_PORT,
  secure: env.SMTP_SECURE === "true",
  auth: env.SMTP_USER
    ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD }
    : undefined,
  connectionTimeout: 10000,
  socketTimeout: 15000,
});

export type EmailNotification = {
  id: string;
  destination: string;
  title: string;
  body: string;
};

export async function sendEmail(n: EmailNotification) {
  if (!emailEnabled) throw new Error("SMTP unavailable");
  await transport.sendMail({
    from: env.SMTP_FROM,
    to: n.destination,
    subject: n.title,
    text: n.body,
    messageId: `<${n.id}@orbyn.local>`,
  });
}

export const closeEmail = () => transport.close();
