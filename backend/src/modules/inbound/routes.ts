import type { FastifyInstance } from "fastify";
import { itemData, parseQuickAdd, type InboxInfo } from "@orbyn/core";
import { randomBytes } from "node:crypto";
import { pool, transaction } from "../../db/pool.js";
import { authenticate } from "../../lib/auth.js";
import { env } from "../../config/env.js";
import { loadPrefs } from "../planner/calendar.js";
import { mutate } from "../items/service.js";

/** The address for a slug, or null when inbound mail isn't set up. */
const addressFor = (slug: string | null) =>
  slug && env.MAIL_INBOUND_DOMAIN ? `${slug}@${env.MAIL_INBOUND_DOMAIN}` : null;

/** A random, hard-to-guess local part. */
const newSlug = () =>
  "task-" + randomBytes(9).toString("base64url").toLowerCase();

export async function inboundRoutes(app: FastifyInstance) {
  // Your email-to-task address.
  app.get("/me/inbox", async (r): Promise<InboxInfo> => {
    const u = await authenticate(r);
    const slug = (
      await pool.query<{ inbox_slug: string | null }>(
        "SELECT inbox_slug FROM users WHERE id=$1",
        [u.id],
      )
    ).rows[0].inbox_slug;
    return {
      address: addressFor(slug),
      configured: !!env.MAIL_INBOUND_DOMAIN && !!env.MAIL_INBOUND_SECRET,
    };
  });

  // Turn it on, or roll to a fresh address if one leaks.
  app.post("/me/inbox/rotate", async (r): Promise<InboxInfo> => {
    const u = await authenticate(r);
    const slug = newSlug();
    await pool.query("UPDATE users SET inbox_slug=$2 WHERE id=$1", [
      u.id,
      slug,
    ]);
    return {
      address: addressFor(slug),
      configured: !!env.MAIL_INBOUND_DOMAIN && !!env.MAIL_INBOUND_SECRET,
    };
  });

  app.delete("/me/inbox", async (r, reply) => {
    const u = await authenticate(r);
    await pool.query("UPDATE users SET inbox_slug=NULL WHERE id=$1", [u.id]);
    return reply.code(204).send();
  });

  /**
   * Inbound mail from the mail server. Guarded by a shared secret, off unless
   * one is set. The subject becomes the task (parsed for dates and tags like
   * quick-add); the body is its notes. Only the account's own email may send,
   * so a stray address can't fill someone's planner. Always 202 so the mail
   * server never retries or bounces.
   */
  app.post("/inbound/mail", async (r, reply) => {
    const secret = env.MAIL_INBOUND_SECRET;
    if (!secret || r.headers["x-inbound-secret"] !== secret)
      return reply.code(401).send({ message: "Not allowed." });
    const body = (r.body ?? {}) as {
      to?: string;
      from?: string;
      subject?: string;
      text?: string;
    };
    const done = (note: string) => reply.code(202).send({ status: note });
    const local = String(body.to ?? "")
      .toLowerCase()
      .match(/([a-z0-9._+-]+)@/)?.[1]
      ?.split("+")[0];
    if (!local) return done("no recipient");
    const from = String(body.from ?? "")
      .toLowerCase()
      .match(/[a-z0-9._%+-]+@[a-z0-9.-]+/)?.[0];
    const subject = String(body.subject ?? "")
      .trim()
      .slice(0, 200);
    if (!subject) return done("no subject");

    const user = (
      await pool.query<{ id: string; email: string; role: string }>(
        "SELECT id, email, role FROM users WHERE inbox_slug=$1 AND NOT disabled",
        [local],
      )
    ).rows[0];
    if (!user) return done("unknown address");
    // Only the account holder may file tasks by email.
    if (!from || from !== user.email.toLowerCase())
      return done("sender not allowed");

    const tz = (await loadPrefs(pool, user.id)).timezone;
    const parsed = parseQuickAdd(subject, { timeZone: tz });
    const notes = String(body.text ?? "")
      .trim()
      .slice(0, 10000);
    await transaction((db) =>
      mutate(
        db,
        { id: user.id, role: user.role as "admin" | "member" },
        {
          operation: "create",
          data: itemData.parse({
            ...parsed.input,
            notes: notes || parsed.input.notes || "",
          }),
        },
      ),
    );
    return done("filed");
  });
}
