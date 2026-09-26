import type { FastifyInstance } from "fastify";
import {
  chatWebhookInput,
  fail,
  importInput,
  preferences,
  type ChatChannel,
  type ImportSummary,
  type Session,
} from "@orbyn/core";
import { pool, transaction } from "../../db/pool.js";
import {
  authenticate,
  bearerToken,
  digest,
  publicUser,
} from "../../lib/auth.js";
import { idParam, strictRateLimit } from "../../lib/params.js";
import { exportData, importData } from "../organize/portability.js";
import { exportArchive } from "../organize/archive.js";
import { assertChatUrl, chatFor, postChat } from "../chat/channel.js";
import { encryptSecret } from "../../lib/secrets.js";

export async function userRoutes(app: FastifyInstance) {
  app.get("/me", async (r) => publicUser(await authenticate(r)));

  app.put("/me", async (r) => {
    const u = await authenticate(r);
    const d = preferences.parse(r.body);
    return publicUser(
      (
        await pool.query(
          "UPDATE users SET email_reminders=$1 WHERE id=$2 RETURNING *",
          [d.email_reminders, u.id],
        )
      ).rows[0],
    );
  });

  // Where you're signed in. The current session is flagged so the app can
  // label it and keep you from signing yourself out by surprise.
  app.get("/me/sessions", async (r): Promise<Session[]> => {
    const u = await authenticate(r);
    const here = digest(bearerToken(r));
    const rows = (
      await pool.query<{
        id: string;
        created_at: Date;
        last_seen_at: Date;
        user_agent: string;
        current: boolean;
      }>(
        `SELECT id, created_at, last_seen_at, user_agent, token_hash = $2 AS current
           FROM sessions WHERE user_id = $1 AND expires_at > now()
           ORDER BY last_seen_at DESC`,
        [u.id, here],
      )
    ).rows;
    return rows.map((s) => ({
      id: s.id,
      created_at: s.created_at.toISOString(),
      last_seen_at: s.last_seen_at.toISOString(),
      user_agent: s.user_agent,
      current: s.current,
    }));
  });

  // Sign out one other device. Signing out the current one is /auth/logout.
  app.delete("/me/sessions/:id", async (r, reply) => {
    const u = await authenticate(r);
    const here = digest(bearerToken(r));
    const gone = await pool.query(
      "DELETE FROM sessions WHERE id = $1 AND user_id = $2 AND token_hash <> $3",
      [idParam(r), u.id, here],
    );
    if (!gone.rowCount)
      fail(404, "That session isn't signed in, or it's this one.");
    return reply.code(204).send();
  });

  // Sign out everywhere except right here.
  app.post("/me/sessions/revoke-others", async (r) => {
    const u = await authenticate(r);
    const here = digest(bearerToken(r));
    const gone = await pool.query(
      "DELETE FROM sessions WHERE user_id = $1 AND token_hash <> $2",
      [u.id, here],
    );
    return { signed_out: gone.rowCount ?? 0 };
  });

  // Leave with everything: your lists, tags, habits and personal items.
  app.get("/me/export", async (r, reply) => {
    const u = await authenticate(r);
    const data = await exportData(pool, u.id);
    reply.header(
      "content-disposition",
      `attachment; filename="orbyn-export-${new Date().toISOString().slice(0, 10)}.json"`,
    );
    return data;
  });

  /**
   * Leave with everything, pages included: a .zip of every page you own as
   * Markdown in its folders, your projects and folders, what you imported,
   * your consent history, and the same planner file as above. Built on the
   * spot, so it is held to the stricter limit.
   */
  app.get("/me/export.zip", strictRateLimit, async (r, reply) => {
    const u = await authenticate(r);
    const { name, body } = await exportArchive(pool, u.id);
    return reply
      .type("application/zip")
      .header("content-disposition", `attachment; filename="${name}"`)
      .header("cache-control", "no-store")
      .send(body);
  });

  // Bring items in from an Orbyn export or a CSV. Defaults to a dry run.
  app.post("/me/import", async (r): Promise<ImportSummary> => {
    const u = await authenticate(r);
    const d = importInput.parse(r.body);
    return transaction((db) =>
      importData(db, { id: u.id, role: u.role }, d.format, d.data, d.dry_run),
    );
  });

  // Chat delivery: a Slack or Discord incoming webhook. The URL is a secret.
  app.get("/me/chat", async (r): Promise<ChatChannel> => {
    const u = await authenticate(r);
    const kind = (
      await pool.query<{ chat_webhook_kind: "slack" | "discord" | null }>(
        "SELECT chat_webhook_kind FROM users WHERE id=$1",
        [u.id],
      )
    ).rows[0].chat_webhook_kind;
    return { kind };
  });

  app.put("/me/chat", async (r): Promise<ChatChannel> => {
    const u = await authenticate(r);
    const d = chatWebhookInput.parse(r.body);
    assertChatUrl(d.kind, d.url);
    await pool.query(
      "UPDATE users SET chat_webhook_encrypted=$2, chat_webhook_kind=$3 WHERE id=$1",
      [u.id, await encryptSecret(d.url), d.kind],
    );
    return { kind: d.kind };
  });

  app.delete("/me/chat", async (r, reply) => {
    const u = await authenticate(r);
    await pool.query(
      "UPDATE users SET chat_webhook_encrypted=NULL, chat_webhook_kind=NULL WHERE id=$1",
      [u.id],
    );
    return reply.code(204).send();
  });

  app.post("/me/chat/test", async (r, reply) => {
    const u = await authenticate(r);
    const chat = await chatFor(u.id);
    if (!chat) fail(400, "Connect a chat webhook first.");
    const ok = await postChat(
      chat.kind,
      chat.url,
      "Orbyn is connected. Your reminders and daily digest will arrive here.",
    );
    if (!ok)
      fail(502, "Couldn't reach the webhook. Check the URL and try again.");
    return reply.code(204).send();
  });
}
