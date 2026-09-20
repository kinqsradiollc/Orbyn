import { randomUUID } from "node:crypto";
import { appLink } from "../booking/service.js";
import { emailEnabled, sendEmail } from "../../worker/channels/email.js";

type Recipient = { email: string; name: string };

/** Best-effort: a mail outage must never break signing up or resetting. */
async function send(to: string, title: string, lines: string[]) {
  if (!(await emailEnabled())) return;
  await sendEmail({
    id: randomUUID(),
    destination: to,
    title,
    body: lines.filter(Boolean).join("\n\n"),
  }).catch(() => {});
}

/** The "confirm your email" message sent when someone signs up. */
export async function sendVerificationEmail(u: Recipient, token: string) {
  const link = appLink(`/verify-email?token=${token}`);
  await send(u.email, "Confirm your Orbyn email address", [
    `Hi ${u.name},`,
    "Welcome to Orbyn. Please confirm this is your email address so you can start using your account:",
    link,
    "The link is good for 24 hours. If you didn't create an Orbyn account, you can ignore this email.",
  ]);
}

/** The "set a new password" message sent when someone asks to reset. */
export async function sendPasswordResetEmail(u: Recipient, token: string) {
  const link = appLink(`/reset-password?token=${token}`);
  await send(u.email, "Reset your Orbyn password", [
    `Hi ${u.name},`,
    "We got a request to reset your Orbyn password. Choose a new one here:",
    link,
    "The link is good for 1 hour. If you didn't ask to reset your password, you can ignore this email — your password won't change.",
  ]);
}
