import { createHash } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { PoolClient } from "pg";
import { fail, HttpError, pageImportInput } from "@orbyn/core";
import { authenticate, type UserRow } from "./auth.js";
import { requireTeam } from "./teams.js";
import { pool } from "../db/pool.js";

/**
 * Receipts belong to a live credential and one exact request for 24 hours.
 * Only explicitly supported application mutations may keep a response body.
 * Replays recheck current authority; legacy or uncertain receipts conflict
 * without reexecuting the mutation. Credential/identity endpoints reject keyed
 * requests before issuing anything: they need their own retry contract.
 */
const WRITES = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const KEY = /^[A-Za-z0-9_-]{8,100}$/;
const KEEP = "24 hours";
const SAVED = Symbol("idempotency-key");
const versionConflicts = new WeakSet<FastifyRequest>();
const CONFLICT =
  "This change cannot be safely replayed. Refresh and review its result before making another change.";

type Policy =
  | "item"
  | "doc"
  | "project"
  | "project-link"
  | "team"
  | "habit"
  | "booking"
  | "view"
  | "capture"
  | "import"
  | "page-import";
// Keep the storage fence in migration 295 aligned with this explicit list.
const POLICIES = new Map<string, Policy>([
  ["POST /items", "item"],
  ["PUT /items/:id", "item"],
  ["DELETE /items/:id", "item"],
  ["POST /items/:id/updates", "item"],
  ["POST /docs", "doc"],
  ["PUT /docs/:id", "doc"],
  ["PUT /docs/:id/content", "doc"],
  ["POST /projects", "project"],
  ["POST /projects/:id/links", "project-link"],
  ["POST /teams", "team"],
  ["POST /views", "view"],
  ["POST /capture", "capture"],
  ["POST /planner/habits", "habit"],
  ["PUT /planner/habits/:id", "habit"],
  ["DELETE /planner/habits/:id", "habit"],
  ["POST /bookings/:id/approve", "booking"],
  ["POST /bookings/:id/decline", "booking"],
  ["POST /bookings/:id/cancel", "booking"],
  ["POST /bookings/:id/reschedule", "booking"],
  ["PUT /bookings/:id/note", "booking"],
  ["PUT /bookings/:id/no-show", "booking"],
  ["POST /me/import", "import"],
  ["POST /imports/pages", "page-import"],
]);

type Saved = { owner: string; key: string; hash: string; policy: Policy };
type Tagged = FastifyRequest & { [SAVED]?: Saved };
type ObjectValue = Record<string, unknown>;
const object = (value: unknown): ObjectValue => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    fail(409, CONFLICT);
  return value as ObjectValue;
};
const uuid = (value: unknown): string => {
  if (
    typeof value !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value,
    )
  )
    fail(409, CONFLICT);
  return value;
};
const hashOf = (value: string) =>
  createHash("sha256").update(value).digest("hex");

/** Recheck both the receipt's original space and the object's current space. */
async function scope(user: UserRow, row: ObjectValue) {
  if (row.team_id)
    await requireTeam(
      uuid(row.team_id),
      user,
      row.permission === "items:read" ? "items:read" : "items:write",
    );
  else if (row.user_id !== user.id) fail(404, "Resource not found");
}
async function resource(
  table: "items" | "docs" | "projects" | "habits",
  id: unknown,
  user: UserRow,
) {
  const row = (
    await pool.query<ObjectValue>(
      `SELECT user_id${table === "habits" ? "" : ", team_id"}${table === "docs" ? ", deleted_at" : ""} FROM ${table} WHERE id=$1`,
      [uuid(id)],
    )
  ).rows[0];
  if (!row || row.deleted_at) fail(409, CONFLICT);
  await scope(user, row);
  return row;
}

async function authorizeReplay(
  request: FastifyRequest,
  user: UserRow,
  policy: Policy,
  body: string | null,
  original: unknown,
) {
  if (policy === "import") return; // Counts and diagnostics for this personal import.
  if (policy === "page-import") {
    const input = pageImportInput.parse(request.body ?? {});
    if (input.team_id) await requireTeam(input.team_id, user, "items:write");
    return;
  }
  // Deletions and responses without a supported result shape are tombstones.
  // In particular, a deleted object cannot supply current authorization.
  if (!body) fail(409, CONFLICT);
  let result: ObjectValue;
  try {
    result = object(JSON.parse(body));
  } catch {
    fail(409, CONFLICT);
  }
  const params = request.params as { id?: string };
  if (original) await scope(user, object(original));
  // Narrow structured saves omit owner/team from their result. Only immutable
  // server-derived receipt metadata can prove the original authorization.
  if (policy === "doc" && params.id && !original) fail(409, CONFLICT);
  if (policy === "team") {
    await requireTeam(uuid(result.id), user, "team:view");
  } else if (policy === "project-link") {
    const projectId = uuid(params.id);
    if (result.project_id !== projectId) fail(409, CONFLICT);
    await resource("projects", projectId, user);
    const link = (
      await pool.query<{ project_id: string }>(
        "SELECT project_id FROM project_links WHERE id=$1",
        [uuid(result.id)],
      )
    ).rows[0];
    if (!link || link.project_id !== projectId) fail(409, CONFLICT);
  } else if (policy === "booking") {
    if (!original) fail(409, CONFLICT);
    const booking = (
      await pool.query<{ page_id: string | null; invite_id: string | null }>(
        "SELECT page_id, invite_id FROM bookings WHERE id=$1",
        [uuid(params.id)],
      )
    ).rows[0];
    if (
      !booking ||
      booking.page_id !== result.page_id ||
      (booking.invite_id ?? null) !== (result.invite_id ?? null)
    )
      fail(409, CONFLICT);
    const { requireBookingPage } = await import("../modules/booking/manage.js");
    await requireBookingPage(pool, booking, user);
  } else if (policy === "view") {
    const { loadView } = await import("../modules/views/service.js");
    const current = await loadView(pool, user.id, uuid(result.id));
    if (!current.can_edit) fail(403, "You can no longer change this view.");
    if (result.team_id)
      await requireTeam(uuid(result.team_id), user, "items:write");
  } else if (policy === "capture") {
    if (!original) fail(409, CONFLICT);
    const input = object(request.body);
    const to = object(input.to);
    if (to.kind === "project") await resource("projects", to.project_id, user);
    if (to.kind === "new_page" && to.folder_id) {
      const folder = (
        await pool.query<ObjectValue>(
          "SELECT user_id, team_id FROM folders WHERE id=$1",
          [uuid(to.folder_id)],
        )
      ).rows[0];
      if (!folder) fail(409, CONFLICT);
      await scope(user, folder);
    }
    if (result.item) {
      const item = object(result.item);
      await scope(user, item);
      await resource("items", item.id, user);
    } else if (result.doc) {
      if (!original) fail(409, CONFLICT);
      await resource("docs", object(result.doc).id, user);
    } else fail(409, CONFLICT);
  } else {
    const table = {
      item: "items",
      doc: "docs",
      project: "projects",
      habit: "habits",
    }[policy] as "items" | "docs" | "projects" | "habits";
    const original = result.item ? object(result.item) : result;
    if (policy !== "habit" && (original.user_id || original.team_id))
      await scope(user, original);
    await resource(
      table,
      params.id ?? result.id ?? object(result.item).id,
      user,
    );
    // A repeating-item edit may create a different occurrence with its own scope.
    if (policy === "item" && params.id && result.id && result.id !== params.id)
      await resource("items", result.id, user);
  }
  // Cached page/task words may include labels of linked resources that have
  // since become private. Keep exact receipts only while those labels are safe.
  const { readableLinks } = await import("../modules/links/privacy.js");
  if (
    JSON.stringify(await readableLinks(pool, user.id, result)) !==
    JSON.stringify(result)
  )
    fail(409, CONFLICT);
}

export function idempotency(app: FastifyInstance) {
  app.addHook("preHandler", async (request, reply) => {
    if (!WRITES.has(request.method)) return;
    const key = request.headers["idempotency-key"];
    if (typeof key !== "string") return;
    if (!KEY.test(key))
      return reply.header("Idempotency-Outcome", "mismatch").code(422).send({
        message: "Idempotency-Key: 8 to 100 letters, digits, - or _.",
      });
    // Authentication includes disabled/verified checks and the API-key route
    // restrictions. It must precede both receipt access and policy refusal.
    reply.header("Idempotency-Outcome", "unsafe");
    const user = await authenticate(request);
    const policy = POLICIES.get(
      `${request.method} ${request.routeOptions.url}`,
    );
    if (!policy)
      return reply.header("Idempotency-Outcome", "unsupported").code(409).send({
        message:
          "This route does not support Idempotency-Key. Review its result before trying again without a key.",
      });
    if (policy === "page-import") {
      const input = pageImportInput.parse(request.body ?? {});
      if (input.team_id) await requireTeam(input.team_id, user, "items:write");
    }
    const owner = hashOf(request.headers.authorization!);
    const basePath = request.url.split("?")[0];
    const isImport = policy === "import" || policy === "page-import";
    const path = isImport
      ? `${basePath}#${hashOf(JSON.stringify(request.body ?? null))}`
      : basePath;
    const hash = hashOf(
      JSON.stringify({
        url: request.url,
        body: request.body ?? null,
        accept: request.headers.accept ?? null,
        docFormats: request.headers["x-orbyn-doc-formats"] ?? null,
        ticksFrom: request.headers["x-orbyn-ticks-from"] ?? null,
      }),
    );
    const claimed = await pool.query(
      `INSERT INTO idempotency_keys (owner, key, method, path, request_hash, original_scope)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb) ON CONFLICT DO NOTHING`,
      [owner, key, request.method, path, hash, null],
    );
    if (claimed.rowCount === 1) {
      (request as Tagged)[SAVED] = { owner, key, hash, policy };
      reply.removeHeader("Idempotency-Outcome");
      return;
    }
    const seen = (
      await pool.query<{
        method: string;
        path: string;
        status: number | null;
        body: string | null;
        request_hash: string | null;
        original_scope: unknown;
        fresh: boolean;
      }>(
        `SELECT method, path, status, body, request_hash, original_scope,
              created_at > now() - interval '${KEEP}' AS fresh
         FROM idempotency_keys WHERE owner = $1 AND key = $2`,
        [owner, key],
      )
    ).rows[0];
    if (!seen || !seen.request_hash)
      return reply.code(409).send({ message: CONFLICT });
    if (
      seen.method !== request.method ||
      seen.path !== path ||
      seen.request_hash !== hash
    )
      return reply.header("Idempotency-Outcome", "mismatch").code(422).send({
        message: "That Idempotency-Key was already used for another request.",
      });
    if (!seen.fresh) return reply.code(409).send({ message: CONFLICT });
    if (seen.status === null)
      return reply
        .header("Idempotency-Outcome", "in-flight")
        .code(409)
        .send({ message: "That change is still being made. Try again soon." });
    if (seen.status < 200 || seen.status >= 300)
      return reply.code(409).send({ message: CONFLICT });
    // An exact, completed DELETE/204 receipt contains no protected response
    // data. Reporting that historical success lets offline deletion drain even
    // though the deleted object no longer exists; never rerun the handler.
    if (!(request.method === "DELETE" && seen.status === 204 && !seen.body))
      await authorizeReplay(
        request,
        user,
        policy,
        seen.body,
        seen.original_scope,
      );
    reply.removeHeader("Idempotency-Outcome");
    reply.header("Idempotent-Replay", "true");
    reply.code(seen.status);
    if (seen.body) reply.type("application/json");
    return reply.send(seen.body ?? undefined);
  });

  app.addHook("onSend", async (request, reply, payload) => {
    const saved = (request as Tagged)[SAVED];
    if (!saved) return payload;
    if (reply.statusCode >= 400) reply.header("Idempotency-Outcome", "unsafe");
    if (reply.statusCode === 409 && versionConflicts.has(request)) {
      const removed = await pool.query(
        "DELETE FROM idempotency_keys WHERE owner=$1 AND key=$2 AND status IS NULL AND request_hash=$3",
        [saved.owner, saved.key, saved.hash],
      );
      if (removed.rowCount === 1)
        reply.header("Idempotency-Outcome", "version-conflict");
      return payload;
    }
    // Imports commit the receipt atomically with their content. Only their
    // uncommitted failure is known safe to retry; other uncertain writes hold.
    if (
      reply.statusCode >= 500 &&
      (saved.policy === "import" || saved.policy === "page-import")
    )
      await pool.query(
        "DELETE FROM idempotency_keys WHERE owner = $1 AND key = $2 AND status IS NULL AND request_hash=$3",
        [saved.owner, saved.key, saved.hash],
      );
    else
      await pool.query(
        `UPDATE idempotency_keys SET status = $3, body = $4
         WHERE owner = $1 AND key = $2 AND status IS NULL AND request_hash=$5`,
        [
          saved.owner,
          saved.key,
          reply.statusCode,
          reply.statusCode >= 200 &&
          reply.statusCode < 300 &&
          typeof payload === "string"
            ? payload
            : null,
          saved.hash,
        ],
      );
    return payload;
  });
}

/** Commit an import's result in the same transaction as its new content. */
export async function rememberImportResult(
  request: FastifyRequest,
  db: PoolClient,
  result: unknown,
) {
  const saved = (request as Tagged)[SAVED];
  if (!saved) return;
  if (saved.policy !== "import" && saved.policy !== "page-import")
    fail(409, CONFLICT);
  const recorded = await db.query(
    `UPDATE idempotency_keys SET status = 200, body = $3
       WHERE owner = $1 AND key = $2 AND status IS NULL AND request_hash=$4`,
    [saved.owner, saved.key, JSON.stringify(result), saved.hash],
  );
  if (recorded.rowCount !== 1)
    throw new Error("Couldn't record this import. Try again.");
}

/** Call only after the owning mutation transaction has rejected and rolled back. */
export function markIdempotencyVersionConflict(
  request: FastifyRequest,
  error: unknown,
  kind: "item" | "doc",
) {
  const expected =
    kind === "item"
      ? "This item changed. Refresh and try again."
      : "This document changed somewhere else. Refresh and try again.";
  if (
    error instanceof HttpError &&
    error.statusCode === 409 &&
    error.message === expected
  )
    versionConflicts.add(request);
}

/** The caller derives scope under its mutation's resource locks, in this transaction. */
export async function rememberIdempotencyScope(
  request: FastifyRequest,
  db: PoolClient,
  authority: {
    user_id: string;
    team_id: string | null;
    permission?: "items:write" | "items:read";
  },
) {
  const saved = (request as Tagged)[SAVED];
  if (!saved) return;
  const recorded = await db.query(
    `UPDATE idempotency_keys SET original_scope=$3::jsonb
       WHERE owner=$1 AND key=$2 AND status IS NULL AND request_hash=$4 AND original_scope IS NULL`,
    [saved.owner, saved.key, JSON.stringify(authority), saved.hash],
  );
  if (recorded.rowCount !== 1) fail(409, CONFLICT);
}

/** Lock exactly the document the save will mutate; scope rolls back with that save. */
export async function rememberDocumentIdempotencyScope(
  request: FastifyRequest,
  db: PoolClient,
  id: string,
) {
  if (!(request as Tagged)[SAVED]) return;
  const row = (
    await db.query<{ user_id: string; team_id: string | null }>(
      "SELECT user_id,team_id FROM docs WHERE id=$1 FOR UPDATE",
      [id],
    )
  ).rows[0];
  if (!row) fail(404, "Document not found");
  await rememberIdempotencyScope(request, db, row);
}
