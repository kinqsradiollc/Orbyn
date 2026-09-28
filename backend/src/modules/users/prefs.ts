import type { FastifyInstance } from "fastify";
import {
  accountPrefsInput,
  COMMANDS,
  DEFAULT_HOME,
  fail,
  homeLayout,
  MAX_VIEW_CHOICES,
  type AccountPrefs,
} from "@orbyn/core";
import { pool, reader, transaction } from "../../db/pool.js";
import { authenticate } from "../../lib/auth.js";
import { writeRateLimit } from "../../lib/params.js";
import { pageFileReadableBy } from "../../lib/page-file-access.js";

/**
 * Choices that follow the account (NAV-08, NAV-09, SHR-08, W1): the
 * sidebar's arrangement, changed shortcuts, view choices and how Home is
 * laid out. One row per person;
 * reading gives the defaults until something is chosen. Theme, text size
 * and what opens at start stay on each device, in the apps.
 */

type Row = {
  sidebar: AccountPrefs["sidebar"];
  shortcuts: AccountPrefs["shortcuts"];
  views: AccountPrefs["views"];
  home: unknown;
  updated_at: Date | null;
};

/** Home as stored, read through its schema; the defaults when unset or unreadable. */
const homeOf = (raw: unknown): AccountPrefs["home"] => {
  if (!raw) return DEFAULT_HOME;
  const read = homeLayout.safeParse(raw);
  return read.success ? read.data : DEFAULT_HOME;
};

const shape = (row: Row | undefined): AccountPrefs => ({
  sidebar: {
    order: row?.sidebar?.order ?? [],
    hidden: row?.sidebar?.hidden ?? [],
  },
  shortcuts: row?.shortcuts ?? {},
  views: row?.views ?? {},
  home: homeOf(row?.home),
  updated_at: row?.updated_at ? row.updated_at.toISOString() : null,
});

const COMMAND_IDS = new Set(COMMANDS.map((c) => c.id));

export async function prefRoutes(app: FastifyInstance) {
  app.get("/me/prefs", async (r): Promise<AccountPrefs> => {
    const u = await authenticate(r);
    const row = (
      await reader(r.headers).query<Row>(
        "SELECT sidebar, shortcuts, views, home, updated_at FROM account_prefs WHERE user_id = $1",
        [u.id],
      )
    ).rows[0];
    return shape(row);
  });

  app.put("/me/prefs", writeRateLimit, async (r): Promise<AccountPrefs> => {
    const u = await authenticate(r);
    const input = accountPrefsInput.parse(r.body ?? {});
    // Shortcuts are only for commands that exist; a key can do one thing.
    if (input.shortcuts) {
      for (const id of Object.keys(input.shortcuts))
        if (!COMMAND_IDS.has(id)) fail(400, `There's no command "${id}".`);
      const seen = new Map<string, string>();
      for (const [id, keys] of Object.entries(input.shortcuts)) {
        if (!keys.length) continue;
        const k = keys.map((x) => x.toLowerCase()).join("+");
        const other = seen.get(k);
        if (other)
          fail(400, `${keys.join("+")} is given to both ${other} and ${id}.`);
        seen.set(k, id);
      }
    }
    // A hub's cover is a picture its owner can see; the quote's page too.
    if (input.home) {
      const covers = [
        ...new Set(
          input.home.hubs.flatMap((h) =>
            h.cover_file_id ? [h.cover_file_id] : [],
          ),
        ),
      ];
      if (covers.length) {
        const seen = (
          await pool.query(
            `SELECT f.id FROM page_files f
              WHERE f.id = ANY ($2::uuid[]) AND f.kind = 'image'
                AND f.status = 'ready' AND ${pageFileReadableBy("$1")}`,
            [u.id, covers],
          )
        ).rowCount;
        if (seen !== covers.length)
          fail(404, "That cover picture wasn't found.");
      }
    }
    const saved = await transaction(async (db) => {
      await db.query(
        "INSERT INTO account_prefs (user_id) VALUES ($1) ON CONFLICT DO NOTHING",
        [u.id],
      );
      const current = (
        await db.query<Row>(
          "SELECT sidebar, shortcuts, views, home, updated_at FROM account_prefs WHERE user_id = $1 FOR UPDATE",
          [u.id],
        )
      ).rows[0];
      const views = { ...(current.views ?? {}) };
      for (const [place, choice] of Object.entries(input.views ?? {})) {
        if (choice === null) delete views[place];
        else views[place] = choice;
      }
      if (Object.keys(views).length > MAX_VIEW_CHOICES)
        fail(400, "Too many saved view choices. Clear some first.");
      return (
        await db.query<Row>(
          `UPDATE account_prefs
              SET sidebar = coalesce($2::jsonb, sidebar),
                  shortcuts = coalesce($3::jsonb, shortcuts),
                  views = $4::jsonb,
                  home = coalesce($5::jsonb, home),
                  updated_at = now()
            WHERE user_id = $1
            RETURNING sidebar, shortcuts, views, home, updated_at`,
          [
            u.id,
            input.sidebar ? JSON.stringify(input.sidebar) : null,
            input.shortcuts ? JSON.stringify(input.shortcuts) : null,
            JSON.stringify(views),
            input.home ? JSON.stringify(input.home) : null,
          ],
        )
      ).rows[0];
    });
    return shape(saved);
  });

  /** Everything back as it came. */
  app.delete("/me/prefs", async (r, reply) => {
    const u = await authenticate(r);
    await pool.query("DELETE FROM account_prefs WHERE user_id = $1", [u.id]);
    reply.code(204);
  });
}
