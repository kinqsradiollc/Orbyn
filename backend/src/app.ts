import Fastify, { type FastifyRequest } from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import { randomBytes, createHash } from "node:crypto";
import argon2 from "argon2";
import { z, ZodError } from "zod";
import { pool, transaction } from "./db.js";
import { config } from "./config.js";
import {
  credentials,
  itemData,
  actionSchema,
  deviceData,
  fail,
} from "./schemas.js";
import { mutate } from "./planner.js";
import { askProvider } from "./ai.js";
const digest = (s: string) => createHash("sha256").update(s).digest("hex");
const idParam = (r: FastifyRequest, key = "id") =>
  z.uuid().parse((r.params as Record<string, string>)[key]);
const publicUser = (u: Record<string, unknown>) => ({
  id: u.id,
  email: u.email,
  name: u.name,
  email_reminders: u.email_reminders,
});
async function user(r: FastifyRequest) {
  const token = r.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
  if (!token) fail(401, "Please sign in");
  const u = (
    await pool.query(
      "SELECT u.* FROM users u JOIN sessions s ON s.user_id=u.id WHERE s.token_hash=$1 AND s.expires_at>now()",
      [digest(token)],
    )
  ).rows[0];
  if (!u) fail(401, "Session expired. Please sign in again.");
  return u;
}
async function issue(u: Record<string, unknown>) {
  const token = randomBytes(48).toString("base64url");
  await pool.query("INSERT INTO sessions(token_hash,user_id) VALUES($1,$2)", [
    digest(token),
    u.id,
  ]);
  return { token, user: publicUser(u) };
}
export async function buildApp() {
  const app = Fastify({
    logger: { redact: ["req.headers.authorization", "req.body.password"] },
    bodyLimit: 65536,
  });
  await app.register(cors, {
    origin: config.CORS_ORIGINS.split(","),
    methods: ["GET", "POST", "PUT", "DELETE"],
  });
  await app.register(rateLimit, { max: 180, timeWindow: "1 minute" });
  app.setErrorHandler((err, request, reply) => {
    if (err instanceof ZodError)
      return reply
        .code(422)
        .send({ message: err.issues.map((i) => i.message).join("; ") });
    const e = err as Error & { statusCode?: number; code?: string };
    if (e.code === "23505")
      return reply.code(409).send({ message: "This record already exists." });
    const code = e.statusCode || 500;
    if (code >= 500) request.log.error({ err: e }, "Request failed");
    reply
      .code(code)
      .send({ message: code === 500 ? "Unexpected server error" : e.message });
  });
  app.get("/health", async () => {
    await pool.query("SELECT 1");
    return { status: "ok" };
  });
  app.post(
    "/auth/register",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (r, reply) => {
      const d = credentials.parse(r.body);
      const hash = await argon2.hash(d.password);
      const u = (
        await pool.query(
          "INSERT INTO users(email,name,password_hash) VALUES($1,$2,$3) RETURNING *",
          [d.email, d.name, hash],
        )
      ).rows[0];
      reply.code(201);
      return issue(u);
    },
  );
  const dummy = await argon2.hash(randomBytes(32));
  app.post(
    "/auth/login",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (r) => {
      const d = credentials.parse(r.body);
      const u = (
        await pool.query("SELECT * FROM users WHERE email=$1", [d.email])
      ).rows[0];
      const valid = await argon2.verify(u?.password_hash || dummy, d.password);
      if (!u || !valid) fail(401, "Email or password is incorrect");
      return issue(u);
    },
  );
  app.post("/auth/logout", async (r, reply) => {
    await user(r);
    await pool.query("DELETE FROM sessions WHERE token_hash=$1", [
      digest(r.headers.authorization!.slice(7)),
    ]);
    return reply.code(204).send();
  });
  app.get("/me", async (r) => publicUser(await user(r)));
  app.put("/me", async (r) => {
    const u = await user(r);
    const d = z.object({ email_reminders: z.boolean() }).parse(r.body);
    return publicUser(
      (
        await pool.query(
          "UPDATE users SET email_reminders=$1 WHERE id=$2 RETURNING *",
          [d.email_reminders, u.id],
        )
      ).rows[0],
    );
  });
  app.get("/items", async (r) => {
    const u = await user(r);
    const q = z
      .object({
        offset: z.coerce.number().int().min(0).default(0),
        limit: z.coerce.number().int().min(1).max(500).default(200),
      })
      .parse(r.query);
    return (
      await pool.query(
        "SELECT * FROM items WHERE user_id=$1 ORDER BY created_at DESC,id LIMIT $2 OFFSET $3",
        [u.id, q.limit, q.offset],
      )
    ).rows;
  });
  app.post("/items", async (r, reply) => {
    const u = await user(r);
    const data = itemData.parse(r.body);
    const item = await transaction((db) =>
      mutate(db, u.id, { operation: "create", data }),
    );
    reply.code(201);
    return item;
  });
  app.put("/items/:id", async (r) => {
    const u = await user(r);
    const { version, ...raw } = z
      .object({ version: z.number().int().positive() })
      .passthrough()
      .parse(r.body);
    const data = itemData.parse(raw);
    return transaction((db) =>
      mutate(db, u.id, {
        operation: "update",
        data,
        item_id: idParam(r),
        version,
      }),
    );
  });
  app.delete("/items/:id", async (r, reply) => {
    const u = await user(r);
    const q = z
      .object({ version: z.coerce.number().int().positive() })
      .parse(r.query);
    await transaction((db) =>
      mutate(db, u.id, {
        operation: "delete",
        item_id: idParam(r),
        version: q.version,
      }),
    );
    return reply.code(204).send();
  });
  app.post("/devices", async (r, reply) => {
    const u = await user(r);
    const d = deviceData.parse(r.body);
    const result = await pool.query(
      "INSERT INTO devices(token,user_id) VALUES($1,$2) ON CONFLICT(token) DO UPDATE SET user_id=EXCLUDED.user_id WHERE devices.user_id=EXCLUDED.user_id RETURNING token",
      [d.token, u.id],
    );
    if (!result.rowCount)
      fail(409, "Sign out of the previous account on this device first");
    return reply.code(204).send();
  });
  app.delete("/devices", async (r, reply) => {
    const u = await user(r);
    const d = deviceData.parse(r.body);
    await pool.query("DELETE FROM devices WHERE token=$1 AND user_id=$2", [
      d.token,
      u.id,
    ]);
    return reply.code(204).send();
  });
  app.get("/notifications", async (r) => {
    const u = await user(r);
    return (
      await pool.query(
        "SELECT id,title,body,read,created_at FROM notifications WHERE user_id=$1 AND channel='inapp' ORDER BY created_at DESC LIMIT 100",
        [u.id],
      )
    ).rows;
  });
  app.post("/notifications/:id/read", async (r, reply) => {
    const u = await user(r);
    const result = await pool.query(
      "UPDATE notifications SET read=true WHERE id=$1 AND user_id=$2",
      [idParam(r), u.id],
    );
    if (!result.rowCount) fail(404, "Notification not found");
    return reply.code(204).send();
  });
  app.post(
    "/ai/chat",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (r) => {
      const u = await user(r);
      const d = z
        .object({
          message: z.string().trim().min(1).max(4000),
          timezone: z.string().max(80).default("UTC"),
        })
        .parse(r.body);
      const items = (
        await pool.query(
          "SELECT * FROM items WHERE user_id=$1 ORDER BY updated_at DESC LIMIT 100",
          [u.id],
        )
      ).rows;
      const response = await askProvider(d.message, d.timezone, items);
      const p = (
        await pool.query(
          "INSERT INTO proposals(user_id,actions) VALUES($1,$2) RETURNING id",
          [u.id, JSON.stringify(response.actions)],
        )
      ).rows[0];
      return { id: p.id, ...response };
    },
  );
  app.post("/ai/proposals/:id/apply", async (r) => {
    const u = await user(r);
    return transaction(async (db) => {
      const p = (
        await db.query(
          "SELECT * FROM proposals WHERE id=$1 AND user_id=$2 FOR UPDATE",
          [idParam(r), u.id],
        )
      ).rows[0];
      if (!p) fail(404, "Proposal not found");
      if (p.applied) return { applied: true };
      if (p.expires_at <= new Date())
        fail(409, "Proposal expired. Ask the assistant again.");
      for (const raw of p.actions)
        await mutate(db, u.id, actionSchema.parse(raw));
      await db.query("UPDATE proposals SET applied=true WHERE id=$1", [p.id]);
      return { applied: true };
    });
  });
  return app;
}
