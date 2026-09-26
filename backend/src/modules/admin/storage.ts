import type { FastifyInstance } from "fastify";
import {
  IMPORT_LIMITS,
  fail,
  type AdminStorage,
  type AdminStoredFile,
} from "@orbyn/core";
import { env } from "../../config/env.js";
import { pool } from "../../db/pool.js";
import { audit } from "../../lib/audit.js";
import { authorize } from "../../lib/auth.js";
import { announceTo } from "../presence/live.js";
import { importCapabilities } from "../imports/routes.js";
import { serviceKey } from "../imports/tokens.js";

/**
 * Admin → Storage: what the server holds and what it's doing with it — the
 * database's size, every file in the file store with its owner and when it
 * goes, the import queue and who is reading it, and the last month of
 * imports. Admins see information about files and can delete them; they
 * never open or download one (the Privacy Policy says only the converter
 * reads uploads).
 */

type StoreStats = {
  files: { id: string; bytes: number; stored_at: string }[];
  disk: { total: number; free: number } | null;
};

async function storeStats(): Promise<StoreStats | null> {
  try {
    const res = await fetch(`${env.FILES_URL}/internal/stats`, {
      headers: { "x-orbyn-service": serviceKey() },
      signal: AbortSignal.timeout(5_000),
    });
    return res.ok ? ((await res.json()) as StoreStats) : null;
  } catch {
    return null;
  }
}

async function storageView(): Promise<AdminStorage> {
  const keep = IMPORT_LIMITS.keepFileHours;
  const [db, stats, caps, heartbeat, queue, reasons, stored, history, pace] =
    await Promise.all([
      pool.query<{ bytes: string }>(
        "SELECT pg_database_size(current_database()) AS bytes",
      ),
      storeStats(),
      importCapabilities(),
      pool.query<{ last_seen_at: string; ok: boolean }>(
        `SELECT last_seen_at, last_seen_at > now() - interval '90 seconds' AS ok
           FROM service_heartbeats WHERE service = 'converter'`,
      ),
      pool.query<{ status: string; n: string }>(
        `SELECT status, count(*) AS n FROM imports
          WHERE status IN ('waiting','queued','reading','ocr') GROUP BY status`,
      ),
      pool.query<{ error: string; count: string }>(
        `SELECT error, count(*) AS count FROM imports
          WHERE status = 'failed' AND finished_at > now() - interval '1 day'
          GROUP BY error ORDER BY count(*) DESC LIMIT 5`,
      ),
      pool.query<Omit<AdminStoredFile, "bytes"> & { bytes: string }>(
        `SELECT i.id AS import_id, i.object_id, i.user_id AS owner_id,
                u.name AS owner_name, u.email AS owner_email, i.file_name,
                i.file_type, i.bytes, i.status, i.created_at AS uploaded_at,
                i.created_at + make_interval(hours => $1) AS deletes_at
           FROM imports i JOIN users u ON u.id = i.user_id
          WHERE i.object_id IS NOT NULL
          ORDER BY i.created_at`,
        [keep],
      ),
      pool.query<{
        id: string;
        owner_name: string;
        file_name: string;
        file_type: AdminStorage["history"][number]["file_type"];
        pages: number | null;
        status: AdminStorage["history"][number]["status"];
        error: string | null;
        created_at: string;
        seconds: string | null;
        engines: string[] | null;
      }>(
        `SELECT i.id, u.name AS owner_name, i.file_name, i.file_type, i.pages,
                i.status, i.error, i.created_at,
                extract(epoch FROM i.finished_at - i.created_at) AS seconds,
                coalesce(nullif(i.engines, '{}'),
                  (SELECT array_agg(DISTINCT p.engine) FROM import_pages p
                    WHERE p.import_id = i.id AND p.engine IS NOT NULL)) AS engines
           FROM imports i JOIN users u ON u.id = i.user_id
          WHERE i.created_at > now() - interval '30 days'
          ORDER BY i.created_at DESC LIMIT 100`,
      ),
      pool.query<{ waiting: string; avg: string | null }>(
        `SELECT (SELECT count(*) FROM import_pages
                  WHERE needs_ocr AND done_at IS NULL) AS waiting,
                (SELECT avg(ocr_ms) FROM (SELECT ocr_ms FROM import_pages
                  WHERE ocr_ms IS NOT NULL ORDER BY done_at DESC LIMIT 50) r) AS avg`,
      ),
    ]);
  const originals = (
    await pool.query<{ count: number; bytes: string | null; people: number }>(
      `SELECT count(*)::int AS count, sum(bytes) AS bytes,
              count(DISTINCT user_id)::int AS people
         FROM kept_files WHERE doc_id IS NOT NULL`,
    )
  ).rows[0];
  const onDisk = new Map((stats?.files ?? []).map((f) => [f.id, f]));
  const count = (s: string) =>
    Number(queue.rows.find((q) => q.status === s)?.n ?? 0);
  const files = stats?.files ?? [];
  return {
    database: { bytes: Number(db.rows[0].bytes) },
    files: {
      reachable: !!stats,
      count: files.length,
      bytes: files.reduce((n, f) => n + f.bytes, 0),
      oldest_at: files.length ? files.map((f) => f.stored_at).sort()[0] : null,
      disk_total: stats?.disk?.total ?? null,
      disk_free: stats?.disk?.free ?? null,
    },
    originals: {
      count: originals.count,
      bytes: Number(originals.bytes ?? 0),
      people: originals.people,
    },
    reading: {
      scans: caps.scans,
      formulas: caps.formulas,
      workers: 0,
      converter_seen_at: heartbeat.rows[0]?.last_seen_at ?? null,
      converter_ok: !!heartbeat.rows[0]?.ok,
    },
    queue: {
      waiting: count("waiting"),
      queued: count("queued"),
      reading: count("reading"),
      ocr: count("ocr"),
      pages_waiting: Number(pace.rows[0].waiting),
      seconds_per_page: pace.rows[0].avg
        ? Math.round(Number(pace.rows[0].avg) / 100) / 10
        : null,
      failed_today: reasons.rows.reduce((n, r) => n + Number(r.count), 0),
      reasons: reasons.rows.map((r) => ({
        error: r.error ?? "Unknown",
        count: Number(r.count),
      })),
    },
    // The file store's own size wins (it's what's on disk); files the store
    // no longer has are left out.
    stored: stored.rows
      .filter((f) => !stats || onDisk.has(f.object_id ?? ""))
      .map((f) => ({
        ...f,
        bytes: onDisk.get(f.object_id ?? "")?.bytes ?? Number(f.bytes),
      })),
    history: history.rows.map((h) => ({
      ...h,
      engines: h.engines ?? [],
      seconds: h.seconds === null ? null : Math.round(Number(h.seconds)),
    })),
  };
}

export async function adminStorageRoutes(app: FastifyInstance) {
  app.get("/admin/storage", async (r) => {
    await authorize(r, "system:manage");
    const view = await storageView();
    const workers = (
      await pool.query<{ workers: number }>(
        "SELECT workers FROM converter_state WHERE id = 1",
      )
    ).rows[0];
    view.reading.workers = workers?.workers ?? 0;
    return view;
  });

  /** Delete a stored file now: its import is cancelled, and it's audited. */
  app.delete("/admin/storage/files/:importId", async (r, reply) => {
    const actor = await authorize(r, "system:manage");
    const id = (r.params as { importId: string }).importId;
    const row = (
      await pool.query<{
        object_id: string | null;
        user_id: string;
        file_name: string;
        bytes: string;
      }>(
        "SELECT object_id, user_id, file_name, bytes FROM imports WHERE id = $1",
        [id],
      )
    ).rows[0];
    if (!row) fail(404, "Import not found");
    await pool.query(
      `UPDATE imports SET
         status = CASE WHEN status IN ('waiting','queued','reading','ocr')
                       THEN 'cancelled' ELSE status END,
         error = CASE WHEN status IN ('waiting','queued','reading','ocr')
                      THEN 'An admin removed this file.' ELSE error END,
         finished_at = coalesce(finished_at, now())
       WHERE id = $1`,
      [id],
    );
    await pool.query(
      "DELETE FROM import_pages WHERE import_id = $1 AND done_at IS NULL",
      [id],
    );
    if (row!.object_id)
      await fetch(`${env.FILES_URL}/internal/files/${row!.object_id}`, {
        method: "DELETE",
        headers: { "x-orbyn-service": serviceKey() },
        signal: AbortSignal.timeout(10_000),
      }).catch(() => {
        // The sweep removes it: the import has ended.
      });
    await audit({
      actorId: actor.id,
      action: "storage.file_deleted",
      targetType: "system",
      targetId: id,
      details: {
        owner: row!.user_id,
        file_name: row!.file_name,
        bytes: Number(row!.bytes),
      },
    });
    await announceTo(pool, { user_id: row!.user_id }, "changed").catch(
      () => {},
    );
    return reply.code(204).send();
  });

  /** Run the file store's sweep now. */
  app.post("/admin/storage/sweep", async (r) => {
    const actor = await authorize(r, "system:manage");
    const res = await fetch(`${env.FILES_URL}/internal/sweep`, {
      method: "POST",
      headers: { "x-orbyn-service": serviceKey() },
      signal: AbortSignal.timeout(60_000),
    }).catch(() => null);
    if (!res?.ok) fail(502, "The file store didn't answer. Is it running?");
    const { removed } = (await res!.json()) as { removed: number };
    await audit({
      actorId: actor.id,
      action: "storage.swept",
      targetType: "system",
      details: { removed },
    });
    return { removed };
  });
}
