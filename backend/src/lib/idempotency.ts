import { createHash } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { pool } from "../db/pool.js";

/**
 * Idempotency-Key: a change sent with one is done once. The first answer is
 * kept for a day; the same key again gets that answer back without doing
 * anything, and a repeat that arrives while the first is still running is
 * told to wait (409). Keys belong to the credentials they came with, so one
 * person's key never answers for another's.
 */
const WRITES = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const KEY = /^[A-Za-z0-9_-]{8,100}$/;
const KEEP = "24 hours";
const SAVED = Symbol("idempotency-key");

type Tagged = FastifyRequest & {
  [SAVED]?: { owner: string; key: string };
};

const ownerOf = (r: FastifyRequest) => {
  const auth = r.headers.authorization;
  return auth ? createHash("sha256").update(auth).digest("hex") : null;
};

export function idempotency(app: FastifyInstance) {
  app.addHook("preHandler", async (request, reply) => {
    if (!WRITES.has(request.method)) return;
    // Identity challenges expire in minutes and every proof/disconnect must
    // recheck its live session. A cached reply must not bypass those checks.
    if (
      /^\/ai\/connections\/chatgpt(?:\/|$)/.test(request.routeOptions.url ?? "")
    )
      return;
    const key = request.headers["idempotency-key"];
    if (typeof key !== "string") return;
    if (!KEY.test(key))
      return reply.code(422).send({
        message: "Idempotency-Key: 8 to 100 letters, digits, - or _.",
      });
    const owner = ownerOf(request);
    // Without credentials there is no one to remember the answer for.
    if (!owner) return;
    const path = request.url.split("?")[0];
    // Now and then, forget keys older than a day.
    if (Math.random() < 0.02)
      void pool
        .query(
          `DELETE FROM idempotency_keys WHERE created_at < now() - interval '${KEEP}'`,
        )
        .catch(() => {});
    const claimed = await pool.query(
      `INSERT INTO idempotency_keys (owner, key, method, path)
       VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
      [owner, key, request.method, path],
    );
    if (claimed.rowCount === 1) {
      (request as Tagged)[SAVED] = { owner, key };
      return;
    }
    const seen = (
      await pool.query<{
        method: string;
        path: string;
        status: number | null;
        body: string | null;
        fresh: boolean;
      }>(
        `SELECT method, path, status, body,
                created_at > now() - interval '${KEEP}' AS fresh
           FROM idempotency_keys WHERE owner = $1 AND key = $2`,
        [owner, key],
      )
    ).rows[0];
    if (!seen) return;
    if (!seen.fresh) {
      // An old key used again is a new request.
      await pool.query(
        `UPDATE idempotency_keys SET method = $3, path = $4, status = NULL,
           body = NULL, created_at = now() WHERE owner = $1 AND key = $2`,
        [owner, key, request.method, path],
      );
      (request as Tagged)[SAVED] = { owner, key };
      return;
    }
    if (seen.method !== request.method || seen.path !== path)
      return reply.code(422).send({
        message: "That Idempotency-Key was already used for another request.",
      });
    if (seen.status === null)
      return reply
        .code(409)
        .send({ message: "That change is still being made. Try again soon." });
    reply.header("Idempotent-Replay", "true");
    reply.code(seen.status);
    if (seen.body) reply.type("application/json");
    return reply.send(seen.body ?? undefined);
  });

  app.addHook("onSend", async (request, reply, payload) => {
    const saved = (request as Tagged)[SAVED];
    if (!saved) return payload;
    // A server error isn't an answer: let the same key try again.
    if (reply.statusCode >= 500)
      await pool.query(
        "DELETE FROM idempotency_keys WHERE owner = $1 AND key = $2",
        [saved.owner, saved.key],
      );
    else
      await pool.query(
        `UPDATE idempotency_keys SET status = $3, body = $4
           WHERE owner = $1 AND key = $2`,
        [
          saved.owner,
          saved.key,
          reply.statusCode,
          typeof payload === "string" ? payload : null,
        ],
      );
    return payload;
  });
}
