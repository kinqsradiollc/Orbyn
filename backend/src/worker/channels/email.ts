import nodemailer from "nodemailer";
import { settings, smtpPassword } from "../../lib/settings.js";

type Transport = ReturnType<typeof nodemailer.createTransport>;

let transport: Transport | null = null;
let signature = "";

/**
 * The mail transport for the current SMTP settings. Settings changed in the
 * app (Admin -> System) are picked up within seconds: a new transport is
 * made whenever they differ from the last one.
 */
async function mailer() {
  const s = await settings();
  const pass = await smtpPassword(s);
  const next = JSON.stringify([
    s.smtp.host,
    s.smtp.port,
    s.smtp.secure,
    s.smtp.user,
    pass,
  ]);
  if (!transport || next !== signature) {
    transport?.close();
    transport = nodemailer.createTransport({
      host: s.smtp.host,
      port: s.smtp.port,
      secure: s.smtp.secure,
      auth: s.smtp.user ? { user: s.smtp.user, pass } : undefined,
      connectionTimeout: 10000,
      socketTimeout: 15000,
    });
    signature = next;
  }
  return { transport, from: s.smtp.from, host: s.smtp.host };
}

/** Whether email reminders are on (an SMTP host is set). */
export async function emailEnabled() {
  return !!(await settings()).smtp.host;
}

export type EmailNotification = {
  id: string;
  destination: string;
  title: string;
  body: string;
  /** An iCalendar invitation or cancellation, sent as a text/calendar part. */
  ical?: string | null;
};

export async function sendEmail(n: EmailNotification) {
  const { transport, from, host } = await mailer();
  if (!host) throw new Error("SMTP unavailable");
  const method = n.ical?.match(/^METHOD:(\w+)/m)?.[1];
  await transport.sendMail({
    from,
    to: n.destination,
    subject: n.title,
    text: n.body,
    messageId: `<${n.id}@orbyn.local>`,
    ...(n.ical
      ? {
          icalEvent: {
            method: method ?? "REQUEST",
            filename: "invite.ics",
            content: n.ical,
          },
        }
      : {}),
  });
}

/** A one-off email that proves the SMTP settings work. */
export async function sendTestEmail(to: string) {
  const { transport, from, host } = await mailer();
  if (!host) throw new Error("No SMTP host is set.");
  await transport.sendMail({
    from,
    to,
    subject: "Orbyn test email",
    text: "Email from Orbyn is working. Reminders will be sent with these settings.",
  });
}

export const closeEmail = () => transport?.close();
