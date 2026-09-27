import {
  Params,
  readableDocs,
  scopeFor,
  visibleDocs,
  visibleItems,
  visibleProjects,
} from "../lib/visibility.js";
import { find } from "../modules/search/find.js";
import { both, cleanTitle } from "./format.js";
import { policy } from "./policy.js";
import { appUrl, refs } from "./refs.js";
import { CapabilityError, type CapabilityContext } from "./registry.js";

/**
 * get_history's lists (H6b): what the person opened and changed lately
 * (their recents, as the quick switcher shows them), the pages in Trash
 * (propose_changes restore_doc brings one back; emptying it stays the
 * person's), and a team's recent changes (who made, edited, finished or
 * deleted which pages and tasks). Only what this connection can reach:
 * its spaces, never a project kept out of AI.
 */

type Entry = {
  at: string;
  what: string;
  by: string | null;
  via_agent: string | null;
  ref: string | null;
};

const answer = (
  id: string,
  title: string,
  url: string,
  entries: Entry[],
  tz: string,
  head: string,
) => ({
  structured: {
    of: { id, title, url },
    entries,
    comments: [],
    suggestions: [],
    content: null,
  },
  markdown: [
    `${head}:`,
    ...(entries.length
      ? entries.map(
          (e) =>
            `- ${both(e.at, tz)?.local ?? e.at} ${e.what}${e.by ? ` by ${e.by}` : ""}${e.ref ? ` (${e.ref})` : ""}`,
        )
      : ["(nothing)"]),
  ].join("\n"),
});

/** Whether `of` names one of these lists. */
export const isHistoryList = (of: string) =>
  /^(recent|trash|changes|team:[0-9a-f-]{36})$/i.test(of.trim());

export async function historyList(
  ctx: CapabilityContext,
  of: string,
  limit: number,
) {
  const key = of.trim().toLowerCase();
  const tz = ctx.timezone;
  const me = ctx.principal.user.id;
  const who = (id: string | null, name: string | null) =>
    id === me ? "you" : name ? cleanTitle(name) : null;
  if (key === "recent") {
    const hits = await find(ctx.db, me, { q: "", limit: 30 });
    // Only what this connection reaches (its spaces, no kept-out projects).
    const p = new Params();
    const scope = scopeFor(ctx.spaces, p);
    const ids = p.add(hits.map((h) => h.id));
    const seen = new Set(
      (
        await ctx.db.query<{ id: string }>(
          `SELECT d.id FROM docs d WHERE d.id = ANY (${ids}::uuid[]) AND ${visibleDocs("d", scope)}
           UNION SELECT i.id FROM items i WHERE i.id = ANY (${ids}::uuid[]) AND ${visibleItems("i", scope)}
           UNION SELECT pr.id FROM projects pr WHERE pr.id = ANY (${ids}::uuid[]) AND ${visibleProjects("pr", scope)}`,
          p.values,
        )
      ).rows.map((r) => r.id),
    );
    const entries = hits
      .filter((h) => seen.has(h.id))
      .slice(0, limit)
      .map((h) => ({
        at: h.updated_at,
        what: `${h.recent ? "Opened" : "Changed"}: ${cleanTitle(h.title)}${h.hint ? ` · ${cleanTitle(h.hint)}` : ""}`,
        by: null,
        via_agent: null,
        ref: refs({ type: h.type, id: h.id }).id,
      }));
    return answer(
      "recent",
      "Recent",
      `${appUrl()}/app`,
      entries,
      tz,
      "Opened and changed lately",
    );
  }
  if (key === "trash") {
    const p = new Params();
    const scope = scopeFor(ctx.spaces, p);
    const rows = (
      await ctx.db.query<{
        id: string;
        title: string;
        deleted_at: Date;
        deleted_by: string | null;
        by_name: string | null;
      }>(
        `SELECT d.id, d.title, d.deleted_at, d.deleted_by, u.name AS by_name
           FROM docs d LEFT JOIN users u ON u.id = d.deleted_by
          WHERE d.deleted_at IS NOT NULL AND ${readableDocs("d", scope)}
          ORDER BY d.deleted_at DESC LIMIT ${p.add(limit)}`,
        p.values,
      )
    ).rows;
    return answer(
      "trash",
      "Trash",
      `${appUrl()}/app/docs`,
      rows.map((r) => ({
        at: r.deleted_at.toISOString(),
        what: `In Trash: ${cleanTitle(r.title) || "Untitled"}`,
        by: who(r.deleted_by, r.by_name),
        via_agent: null,
        ref: `doc:${r.id}`,
      })),
      tz,
      "Pages in Trash (propose_changes restore_doc brings one back)",
    );
  }
  // A team's recent changes, or every reachable team's.
  const reachable = ctx.principal.teams.filter(
    (t) => policy.levelIn(ctx.principal, t.id) !== null,
  );
  const one = key.startsWith("team:") ? key.slice(5) : null;
  const teams = one ? reachable.filter((t) => t.id === one) : reachable;
  if (one && !teams.length)
    throw new CapabilityError(
      "NOT_FOUND",
      "No team with that id is reachable from this connection.",
      "get_context lists the connection's teams.",
    );
  const rows = (
    await ctx.db.query<{
      team_name: string;
      user_id: string | null;
      user_name: string | null;
      kind: string;
      object_id: string;
      title: string;
      action: string;
      edits: number;
      at: Date;
    }>(
      `SELECT t.name AS team_name, c.user_id, who.name AS user_name, c.kind,
              c.object_id, c.title, c.action, c.edits::int AS edits, c.at
         FROM team_changes c
         JOIN teams t ON t.id = c.team_id
         LEFT JOIN users who ON who.id = c.user_id
        WHERE c.team_id = ANY ($1::uuid[])
          AND NOT EXISTS (
                SELECT 1 FROM docs d JOIN projects ko ON ko.id = d.project_id
                 WHERE c.kind = 'page' AND d.id = c.object_id AND ko.assistant_off)
          AND NOT EXISTS (
                SELECT 1 FROM items i JOIN projects ko ON ko.id = i.project_id
                 WHERE c.kind <> 'page' AND i.id = c.object_id AND ko.assistant_off)
        ORDER BY c.at DESC, c.id DESC LIMIT $2`,
      [teams.map((t) => t.id), limit],
    )
  ).rows;
  const title = one ? teams[0].name : "Your teams";
  return answer(
    one ? `team:${one}` : "changes",
    title,
    `${appUrl()}/app/changes`,
    rows.map((r) => ({
      at: r.at.toISOString(),
      what: `${r.action} ${r.kind === "page" ? "page" : r.kind} ${cleanTitle(r.title) || "Untitled"}${r.edits > 1 ? ` (${r.edits} edits)` : ""}${one ? "" : ` · ${cleanTitle(r.team_name)}`}`,
      by: who(r.user_id, r.user_name),
      via_agent: null,
      ref: `${r.kind === "page" ? "doc" : r.kind}:${r.object_id}`,
    })),
    tz,
    `Recent changes in ${cleanTitle(title)}`,
  );
}
