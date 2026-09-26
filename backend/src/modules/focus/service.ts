import {
  fail,
  focusCurrentInput,
  focusSessionInput,
  localDateKey,
  type FocusCurrent,
  type FocusSession,
  type FocusSummary,
  type ItemDetail,
} from "@orbyn/core";
import type { z } from "zod";
import { pool, transaction, type Db, type Queryable } from "../../db/pool.js";
import type { UserRow } from "../../lib/auth.js";
import { loadPrefs } from "../planner/calendar.js";
import { itemDetail, lockItem, requireItemAccess } from "../items/service.js";
import { announceTo } from "../presence/live.js";
import { startSessionsFor } from "../planner/check-in.js";

/**
 * Focus: finished phases kept once (their id is made on the device), work
 * minutes logged to the task, summaries, and the phase running now shared
 * across devices. The routes and the agents' log_focus and set_focus_timer
 * share these.
 */

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

export async function currentFocus(
  userId: string,
  db: Queryable = pool,
): Promise<FocusCurrent | null> {
  const row = (
    await db.query<{
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

/**
 * Keep a finished (or cut short) focus phase once: its id is made on the
 * device, so a retry is the same record. Work minutes are logged to the
 * task. `fresh` says whether it was new.
 */
export async function logFocusSession(
  db: Db,
  u: UserRow,
  input: z.input<typeof focusSessionInput>,
): Promise<{ session: FocusSession; item: ItemDetail | null; fresh: boolean }> {
  const d = focusSessionInput.parse(input);
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
}

/** Focus between two times: totals, by day and by task, and the latest phases. */
export async function focusSummary(
  db: Queryable,
  userId: string,
  q: { from: string; to: string },
): Promise<FocusSummary> {
  const { timezone } = await loadPrefs(db, userId);
  const rows = (
    await db.query<SessionRow>(
      `SELECT ${SESSION_COLUMNS} FROM focus_sessions s
       LEFT JOIN items i ON i.id = s.item_id
       WHERE s.user_id = $1 AND s.started_at >= $2 AND s.started_at < $3
       ORDER BY s.started_at DESC`,
      [userId, q.from, q.to],
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
    breaks_taken: rows.filter((s) => s.kind !== "work" && s.minutes > 0).length,
    by_day: [...byDay]
      .map(([day, minutes]) => ({ day, minutes }))
      .sort((a, b) => a.day.localeCompare(b.day)),
    by_item: [...byItem]
      .map(([item_id, v]) => ({ item_id, ...v }))
      .sort((a, b) => b.minutes - a.minutes)
      .slice(0, 10),
    recent: rows.slice(0, 20),
  };
}

/** Share the running focus phase with the person's other devices. */
export async function setFocus(
  db: Queryable,
  u: UserRow,
  input: z.input<typeof focusCurrentInput>,
): Promise<FocusCurrent> {
  const d = focusCurrentInput.parse(input);
  if (d.state.item_id) {
    const item = (
      await db.query("SELECT * FROM items WHERE id = $1", [d.state.item_id])
    ).rows[0];
    if (!item) fail(404, "Item not found");
    await requireItemAccess(u, item, "items:read", db as never);
  }
  await db.query(
    `INSERT INTO focus_current (user_id, state, device, device_id, updated_at)
     VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (user_id) DO UPDATE
       SET state = EXCLUDED.state, device = EXCLUDED.device,
           device_id = EXCLUDED.device_id, updated_at = now()`,
    [u.id, d.state, d.device ?? null, d.device_id ?? null],
  );
  // Focus running on a task while one of its sessions is on: that
  // session has started (it shows in the project's History).
  if (d.state.item_id && d.state.phase === "work" && d.state.run_started_at)
    await transaction(async (tx) => {
      await tx.query("SELECT set_config('orbyn.user_id', $1, true)", [u.id]);
      await startSessionsFor(tx, u.id, d.state.item_id!);
    });
  await announceTo(db as never, { user_id: u.id }, "focus", {
    by: d.device_id,
  });
  return (await currentFocus(u.id, db))!;
}

/** Stop the focus phase on every device. */
export async function clearFocus(db: Queryable, userId: string) {
  await db.query("DELETE FROM focus_current WHERE user_id = $1", [userId]);
  await announceTo(db as never, { user_id: userId }, "focus");
}
