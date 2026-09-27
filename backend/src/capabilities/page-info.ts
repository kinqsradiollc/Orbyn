import type { FieldTarget, FieldValue } from "@orbyn/core";
import { linksHere } from "../modules/links/service.js";
import { fieldValuesFor, visibleFields } from "../modules/views/fields.js";
import { cleanTitle } from "./format.js";
import type { CapabilityContext } from "./registry.js";

/**
 * A page's (or project's) Info, as lines of text for fetch (H6b): its
 * other names, tags, how many places link to it, its kept versions, the
 * headings the person folded, and your own fields with their ids and
 * values (organize set_field fills them in). Text only, so tools/list
 * stays the size it was.
 */

const shown = (v: FieldValue | undefined) =>
  v === undefined || v === null ? "—" : cleanTitle(String(v)).slice(0, 120);

/** "Fields: Status (field:…, select: a|b) = a; …", or null. */
export async function fieldsLine(
  ctx: CapabilityContext,
  target: FieldTarget,
  id: string,
  teamId: string | null,
  ownerId: string,
): Promise<string | null> {
  const fields = (
    await visibleFields(ctx.db, ctx.principal.user.id, target)
  ).filter(
    (f) => f.team_id === teamId && (teamId !== null || f.user_id === ownerId),
  );
  if (!fields.length) return null;
  const values = (await fieldValuesFor(ctx.db, target, [id])).get(id) ?? {};
  return `Fields: ${fields
    .slice(0, 40)
    .map(
      (f) =>
        `${cleanTitle(f.name)} (field:${f.id}, ${f.type}${f.options.length ? `: ${f.options.map(cleanTitle).join("|")}` : ""}) = ${shown(values[f.id])}`,
    )
    .join("; ")}`;
}

/** The Info lines fetch adds under a page's title. */
export async function pageInfoLines(
  ctx: CapabilityContext,
  d: { id: string; team_id: string | null; user_id: string },
): Promise<string[]> {
  const row = (
    await ctx.db.query<{
      aliases: string[] | null;
      tags: string[] | null;
      versions: number;
      folds: string[] | null;
    }>(
      `SELECT d.aliases,
              (SELECT array_agg(t.name ORDER BY lower(t.name)) FROM doc_tags dt
                 JOIN tags t ON t.id = dt.tag_id WHERE dt.doc_id = d.id) AS tags,
              (SELECT count(*)::int FROM doc_versions v WHERE v.doc_id = d.id) AS versions,
              (SELECT block_ids FROM doc_folds f WHERE f.doc_id = d.id AND f.user_id = $2) AS folds
         FROM docs d WHERE d.id = $1`,
      [d.id, ctx.principal.user.id],
    )
  ).rows[0];
  const linked = await linksHere(ctx.db, ctx.principal.user.id, {
    kind: "doc",
    id: d.id,
  }).catch(() => ({ count: 0 }));
  const fields = await fieldsLine(ctx, "page", d.id, d.team_id, d.user_id);
  return [
    row?.aliases?.length
      ? `Also called: ${row.aliases.map(cleanTitle).join(", ")}`
      : "",
    row?.tags?.length ? `Tags: ${row.tags.map(cleanTitle).join(", ")}` : "",
    `Info: ${linked.count} place${linked.count === 1 ? "" : "s"} link here (get_links) · ${row?.versions ?? 0} kept version${row?.versions === 1 ? "" : "s"} (get_history)${row?.folds?.length ? ` · folded: ${row.folds.map((b) => `^${b}`).join(" ")}` : ""}`,
    fields ?? "",
  ].filter(Boolean);
}
