import type { FastifyInstance } from "fastify";
import {
  fail,
  focusCurrentInput,
  focusSessionInput,
  focusSummaryQuery,
  localDateKey,
  type FocusCurrent,
  type FocusSession,
  type FocusSummary,
  type ItemDetail,
} from "@orbyn/core";
import { pool, reader, transaction } from "../../db/pool.js";
import { authenticate } from "../../lib/auth.js";
import { loadPrefs } from "../planner/calendar.js";
import { itemDetail } from "../items/service.js";
import { lockItem, requireItemAccess } from "../items/service.js";
import { announceTo } from "../presence/live.js";

const SESSION_COLUMNS = `s.id, s.item_id, i.title AS item_title, s.kind,
  s.started_at, s.ended_at, s.planned_minutes, s.minutes, s.completed`;

type SessionRow = Omit<FocusSession, "started_at" | "ended_at"> & {
  started_at: Date;
  ended_at: Date;
};

const toSession = (r: SessionRow): FocusSession => ({
  ...r,
  started_at: r.started_at.toISOString(),
  ended_at: r.ended_at.toISOString(),
});

/**
 * Focus sessions. Each finished or cut-short phase is kept once (its id is
 * made on the device, so a retry is the same record), work minutes are logged
 * to the task, and the phase running now is shared with your other devices.
 */
export async function focusRoutes(app: FastifyInstance) {
  app.post("/focus/sessions", async (r, reply) => {
    const u = await authenticate(r);
    const d = focusSessionInput.parse(r.body);
    const result = await transaction(async (db) => {
      if (d.item_id) {
        const item = await lockItem(db, d.item_id);
        await requireItemAccess(u, item, "items:write", db);
      }
      const inserted = await db.query(
        `INSERT INTO focus_sessions
           (id, user_id, item_id, kind, started_at, ended_at, planned_minutes,
            minutes, completed)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (id) DO NOTHING`,
        [
          d.id,
          u.id,
          d.item_id,
          d.kind,
          d.started_at,
          d.ended_at,
          d.planned_minutes,
          d.minutes,
          d.completed,
        ],
      );
      // A repeat of a session already kept changes nothing, and logs nothing twice.
      const fresh = inserted.rowCount === 1;
      if (!fresh) {
        const owner = (
          await db.query<{ user_id: string }>(
            "SELECT user_id FROM focus_sessions WHERE id = $1",
            [d.id],
          )
        ).rows[0];
        if (owner?.user_id !== u.id) fail(409, "That session id is taken.");
      }
      if (fresh && d.kind === "work" && d.item_id && d.minutes > 0)
        await db.query(
          "UPDATE items SET spent_minutes = spent_minutes + $1, updated_at = now() WHERE id = $2",
          [d.minutes, d.item_id],
        );
      const session = (
        await db.query<SessionRow>(
          `SELECT ${SESSION_COLUMNS} FROM focus_sessions s
             LEFT JOIN items i ON i.id = s.item_id WHERE s.id = $1`,
          [d.id],
        )
      ).rows[0];
      const item: ItemDetail | null = d.item_id
        ? await itemDetail(d.item_id, (text, values) => db.query(text, values))
        : null;
      return { session: toSession(session), item, fresh };
    });
    reply.code(result.fresh ? 201 : 200);
    return { session: result.session, item: result.item };
  });

  app.get("/focus/summary", async (r): Promise<FocusSummary> => {
    const u = await authenticate(r);
    const q = focusSummaryQuery.parse(r.query);
    const db = reader(r.headers);
    const { timezone } = await loadPrefs(db, u.id);
    const rows = (
      await db.query<SessionRow>(
        `SELECT ${SESSION_COLUMNS} FROM focus_sessions s
           LEFT JOIN items i ON i.id = s.item_id
           WHERE s.user_id = $1 AND s.started_at >= $2 AND s.started_at < $3
           ORDER BY s.started_at DESC`,
        [u.id, q.from, q.to],
      )
    ).rows.map(toSession);
    const work = rows.filter((s) => s.kind === "work");
    const byDay = new Map<string, number>();
    const byItem = new Map<string, { title: string; minutes: number }>();
    for (const s of work) {
      const day = localDateKey(new Date(s.started_at), timezone);
      byDay.set(day, (byDay.get(day) ?? 0) + s.minutes);
      if (s.item_id) {
        const entry = byItem.get(s.item_id) ?? {
          title: s.item_title ?? "",
          minutes: 0,
        };
        entry.minutes += s.minutes;
        byItem.set(s.item_id, entry);
      }
    }
    return {
      from: q.from,
      to: q.to,
      work_minutes: work.reduce((n, s) => n + s.minutes, 0),
      completed: work.filter((s) => s.completed).length,
      cut_short: work.filter((s) => !s.completed).length,
      breaks_taken: rows.filter((s) => s.kind !== "work" && s.minutes > 0)
        .length,
      by_day: [...byDay]
        .map(([day, minutes]) => ({ day, minutes }))
        .sort((a, b) => a.day.localeCompare(b.day)),
      by_item: [...byItem]
        .map(([item_id, v]) => ({ item_id, ...v }))
        .sort((a, b) => b.minutes - a.minutes)
        .slice(0, 10),
      recent: rows.slice(0, 20),
    };
  });

  // What's running now, so the phone shows the session the laptop started.
  app.get("/focus/current", async (r): Promise<FocusCurrent | null> => {
    const u = await authenticate(r);
    return currentFocus(u.id);
  });

  app.put("/focus/current", async (r): Promise<FocusCurrent> => {
    const u = await authenticate(r);
    const d = focusCurrentInput.parse(r.body);
    if (d.state.item_id) {
      const item = (
        await pool.query("SELECT * FROM items WHERE id = $1", [d.state.item_id])
      ).rows[0];
      if (!item) fail(404, "Item not found");
      await requireItemAccess(u, item, "items:read");
    }
    await pool.query(
      `INSERT INTO focus_current (user_id, state, device, device_id, updated_at)
       VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (user_id) DO UPDATE
         SET state = EXCLUDED.state, device = EXCLUDED.device,
             device_id = EXCLUDED.device_id, updated_at = now()`,
      [u.id, d.state, d.device ?? null, d.device_id ?? null],
    );
    await announceTo(pool, { user_id: u.id }, "focus", { by: d.device_id });
    return (await currentFocus(u.id))!;
  });

  app.delete("/focus/current", async (r, reply) => {
    const u = await authenticate(r);
    await pool.query("DELETE FROM focus_current WHERE user_id = $1", [u.id]);
    await announceTo(pool, { user_id: u.id }, "focus");
    reply.code(204);
  });
}

async function currentFocus(userId: string): Promise<FocusCurrent | null> {
  const row = (
    await pool.query<{
      state: FocusCurrent["state"];
      device: string | null;
      device_id: string | null;
      updated_at: Date;
    }>(
      "SELECT state, device, device_id, updated_at FROM focus_current WHERE user_id = $1",
      [userId],
    )
  ).rows[0];
  if (!row) return null;
  // A running phase that ended over a day ago was left behind, not running.
  const ends = row.state.ends_at ? Date.parse(row.state.ends_at) : null;
  if (ends && Date.now() - ends > 86_400_000) return null;
  return {
    state: row.state,
    device: row.device,
    device_id: row.device_id,
    updated_at: row.updated_at.toISOString(),
  };
}
