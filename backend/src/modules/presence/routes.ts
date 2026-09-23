import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  AWAY_MINUTES,
  fail,
  ONLINE_MINUTES,
  presenceHeartbeat,
  presenceSettingsInput,
  type DevicePresence,
  type DocViewer,
  type MemberPresence,
  type PresenceSettings,
} from "@orbyn/core";
import { pool, reader } from "../../db/pool.js";
import { authenticate } from "../../lib/auth.js";
import { idParam } from "../../lib/params.js";
import { requireTeam } from "../../lib/teams.js";
import { announceTo } from "./live.js";
import { noteActive } from "../followthrough/reentry.js";

/** Documents `$1` can see: their own, and their teams'. */
const VISIBLE_DOC = `((d.team_id IS NULL AND d.user_id = $1)
  OR d.team_id IN (SELECT team_id FROM team_members WHERE user_id = $1))`;

/** A device unseen this long is forgotten. */
const FORGET_DAYS = 90;

type DeviceRow = Omit<DevicePresence, "synced_at" | "seen_at" | "online"> & {
  synced_at: Date | null;
  seen_at: Date;
  online: boolean;
};

/** Who owns a page, for telling the right people who has it open. */
async function docAudience(docId: string | null) {
  if (!docId) return null;
  return (
    await pool.query<{ user_id: string; team_id: string | null }>(
      "SELECT user_id, team_id FROM docs WHERE id = $1",
      [docId],
    )
  ).rows[0];
}

/**
 * Presence: devices check in about once a minute while the app is open. From
 * that the person sees their own devices and whether each is in sync; a
 * shared page shows who else has it open; and teammates who choose to share
 * it show as active or away — never with a time.
 */
export async function presenceRoutes(app: FastifyInstance) {
  app.post("/presence/heartbeat", async (r) => {
    const u = await authenticate(r);
    const d = presenceHeartbeat.parse(r.body);
    if (d.doc_id) {
      const visible = (
        await pool.query(
          `SELECT 1 FROM docs d WHERE d.id = $2 AND ${VISIBLE_DOC}`,
          [u.id, d.doc_id],
        )
      ).rowCount;
      if (!visible) fail(404, "Document not found");
    }
    const before = (
      await pool.query<{
        doc_id: string | null;
        active: boolean;
        online: boolean;
        pending_changes: number;
        failed_changes: number;
      }>(
        `SELECT doc_id, active, pending_changes, failed_changes,
                seen_at > now() - make_interval(mins => $3) AS online
           FROM presence WHERE user_id = $1 AND device_id = $2`,
        [u.id, d.device_id, ONLINE_MINUTES],
      )
    ).rows[0];
    await pool.query(
      `INSERT INTO presence (user_id, device_id, platform, label, active, doc_id,
         pending_changes, failed_changes, synced_at, seen_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())
       ON CONFLICT (user_id, device_id) DO UPDATE SET
         platform = EXCLUDED.platform, label = coalesce(EXCLUDED.label, presence.label),
         active = EXCLUDED.active, doc_id = EXCLUDED.doc_id,
         pending_changes = EXCLUDED.pending_changes,
         failed_changes = EXCLUDED.failed_changes,
         synced_at = coalesce(EXCLUDED.synced_at, presence.synced_at),
         seen_at = now()`,
      [
        u.id,
        d.device_id,
        d.platform,
        d.label ?? null,
        d.active,
        d.doc_id,
        d.pending_changes,
        d.failed_changes,
        d.synced_at ?? null,
      ],
    );
    // In use now: after a long gap, keep the stretch away for a brief.
    if (d.active) await noteActive(pool, u.id);
    if (!before)
      await pool.query(
        `DELETE FROM presence WHERE user_id = $1
           AND seen_at < now() - make_interval(days => $2)`,
        [u.id, FORGET_DAYS],
      );

    // Only news worth telling: arriving, going quiet, a page opened or left,
    // or the sync state moving.
    const cameBack = !before || !before.online || before.active !== d.active;
    if (
      cameBack ||
      before.pending_changes !== d.pending_changes ||
      before.failed_changes !== d.failed_changes
    )
      await announceTo(pool, { user_id: u.id }, "presence", {
        by: d.device_id,
      });
    if (cameBack && u.share_presence) {
      const teams = (
        await pool.query<{ team_id: string }>(
          "SELECT team_id FROM team_members WHERE user_id = $1",
          [u.id],
        )
      ).rows;
      for (const t of teams)
        await announceTo(pool, { team_id: t.team_id }, "presence");
    }
    if (before?.doc_id !== d.doc_id)
      for (const docId of [before?.doc_id ?? null, d.doc_id]) {
        const doc = await docAudience(docId);
        if (doc)
          await announceTo(pool, doc, "doc_presence", {
            doc: docId!,
            by: d.device_id,
          });
      }
    return { ok: true };
  });

  // The app closed or signed out: this device is gone for now.
  app.post("/presence/leave", async (r) => {
    const u = await authenticate(r);
    const { device_id } = z
      .object({ device_id: z.string().trim().min(8).max(64) })
      .strict()
      .parse(r.body);
    const row = (
      await pool.query<{ doc_id: string | null }>(
        `WITH old AS (
           SELECT doc_id FROM presence WHERE user_id = $1 AND device_id = $2
         )
         UPDATE presence SET active = false, doc_id = NULL,
           seen_at = now() - make_interval(mins => $3)
         WHERE user_id = $1 AND device_id = $2
         RETURNING (SELECT doc_id FROM old)`,
        [u.id, device_id, ONLINE_MINUTES],
      )
    ).rows[0];
    await announceTo(pool, { user_id: u.id }, "presence", { by: device_id });
    const doc = await docAudience(row?.doc_id ?? null);
    if (doc)
      await announceTo(pool, doc, "doc_presence", {
        doc: row!.doc_id!,
        by: device_id,
      });
    return { ok: true };
  });

  app.get("/presence/devices", async (r): Promise<DevicePresence[]> => {
    const u = await authenticate(r);
    const rows = (
      await reader(r.headers).query<DeviceRow>(
        `SELECT device_id, platform, label, active, pending_changes, failed_changes,
                synced_at, seen_at,
                seen_at > now() - make_interval(mins => $2) AS online
           FROM presence WHERE user_id = $1 ORDER BY seen_at DESC`,
        [u.id, ONLINE_MINUTES],
      )
    ).rows;
    return rows.map((d) => ({
      ...d,
      active: d.online && d.active,
      synced_at: d.synced_at?.toISOString() ?? null,
      seen_at: d.seen_at.toISOString(),
    }));
  });

  // Forget a device: it shows again when it next checks in.
  app.delete("/presence/devices/:deviceId", async (r, reply) => {
    const u = await authenticate(r);
    const { deviceId } = z
      .object({ deviceId: z.string().min(8).max(64) })
      .parse(r.params);
    await pool.query(
      "DELETE FROM presence WHERE user_id = $1 AND device_id = $2",
      [u.id, deviceId],
    );
    reply.code(204);
  });

  app.get("/presence/settings", async (r): Promise<PresenceSettings> => {
    const u = await authenticate(r);
    return { share_presence: !!u.share_presence };
  });

  app.put("/presence/settings", async (r): Promise<PresenceSettings> => {
    const u = await authenticate(r);
    const d = presenceSettingsInput.parse(r.body);
    await pool.query("UPDATE users SET share_presence = $2 WHERE id = $1", [
      u.id,
      d.share_presence,
    ]);
    const teams = (
      await pool.query<{ team_id: string }>(
        "SELECT team_id FROM team_members WHERE user_id = $1",
        [u.id],
      )
    ).rows;
    for (const t of teams)
      await announceTo(pool, { team_id: t.team_id }, "presence");
    return d;
  });

  // Who on the team is around. Only people who share it; never a time.
  app.get("/teams/:id/presence", async (r): Promise<MemberPresence[]> => {
    const u = await authenticate(r);
    const teamId = idParam(r);
    await requireTeam(teamId, u, "items:read");
    const rows = (
      await reader(r.headers).query<{
        user_id: string;
        share: boolean;
        active: boolean;
        away: boolean;
      }>(
        `SELECT m.user_id, p.share_presence AS share,
                coalesce(bool_or(d.active AND d.seen_at > now() - make_interval(mins => $2)), false) AS active,
                coalesce(bool_or(d.seen_at > now() - make_interval(mins => $3)), false) AS away
           FROM team_members m JOIN users p ON p.id = m.user_id
           LEFT JOIN presence d ON d.user_id = m.user_id
          WHERE m.team_id = $1
          GROUP BY m.user_id, p.share_presence`,
        [teamId, ONLINE_MINUTES, AWAY_MINUTES],
      )
    ).rows;
    return rows.map((m) => ({
      user_id: m.user_id,
      status: !m.share
        ? "hidden"
        : m.active
          ? "active"
          : m.away
            ? "away"
            : "offline",
    }));
  });

  // Who else has a page open now. Shared pages show it to everyone on them.
  app.get("/docs/:id/presence", async (r): Promise<DocViewer[]> => {
    const u = await authenticate(r);
    const docId = idParam(r);
    const db = reader(r.headers);
    const visible = (
      await db.query(
        `SELECT 1 FROM docs d WHERE d.id = $2 AND ${VISIBLE_DOC}`,
        [u.id, docId],
      )
    ).rowCount;
    if (!visible) fail(404, "Document not found");
    return (
      await db.query<DocViewer>(
        `SELECT DISTINCT p.user_id, x.name FROM presence p
           JOIN users x ON x.id = p.user_id
          WHERE p.doc_id = $1 AND p.user_id <> $2
            AND p.seen_at > now() - make_interval(mins => $3)
          ORDER BY x.name`,
        [docId, u.id, ONLINE_MINUTES],
      )
    ).rows;
  });
}
