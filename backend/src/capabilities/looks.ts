import { z } from "zod";
import { LOOK_ICON_NAMES, lookIconInput } from "@orbyn/core";
import { Params, scopeFor, visibleDocs } from "../lib/visibility.js";
import { CapabilityError, type CapabilityContext } from "./registry.js";

/**
 * Covers and icons for agents (W6): update_project's cover and icon, and
 * organize's "look" for a page. A cover is a picture already in Orbyn — one
 * on a page this connection reaches (add_file puts one there) — named as
 * the page names it (orbyn://file/<id>), file:<id> or its bare id.
 */

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

export const coverArg = z
  .string()
  .trim()
  .max(300)
  .nullable()
  .optional()
  .describe(
    "orbyn://file/<id>: a picture on a page you reach; null: no cover.",
  );

export const iconArg = z
  .string()
  .trim()
  .max(40)
  .nullable()
  .optional()
  .describe("An emoji or icon:<name> (e.g. icon:target); null: no icon.");

/** The id of a picture this connection may use as a cover. */
export async function seeCoverPicture(
  ctx: CapabilityContext,
  ref: string,
): Promise<string> {
  const id = UUID.exec(ref)?.[0]?.toLowerCase();
  if (!id)
    throw new CapabilityError(
      "INVALID",
      "Name the cover picture as orbyn://file/<id>.",
      "fetch a page with the picture: its picture lines hold orbyn://file/<id>.",
    );
  const params = new Params();
  const scope = scopeFor(ctx.spaces, params);
  const file = params.add(id);
  const row = (
    await ctx.db.query(
      `SELECT 1 FROM page_files f
        WHERE f.id = ${file} AND f.kind = 'image' AND f.status = 'ready'
          AND (EXISTS (SELECT 1 FROM docs d
                        WHERE d.id = f.doc_id AND ${visibleDocs("d", scope)})
            OR EXISTS (SELECT 1 FROM page_file_refs r JOIN docs d ON d.id = r.doc_id
                        WHERE r.file_id = f.id AND ${visibleDocs("d", scope)}))`,
      params.values,
    )
  ).rowCount;
  if (!row)
    throw new CapabilityError(
      "NOT_FOUND",
      "No picture with that id is on a page this connection reaches.",
      "add_file puts a picture on a page; use the orbyn://file/<id> it gives.",
    );
  return id;
}

/** An icon as stored, or a refusal that says which ones there are. */
export function iconValue(icon: string | null): string | null {
  if (icon === null) return null;
  const read = lookIconInput.safeParse(icon);
  if (!read.success)
    throw new CapabilityError(
      "INVALID",
      "An icon is one emoji, or icon:<name> with one of the app's icons.",
      `Names: ${LOOK_ICON_NAMES.join(", ")}.`,
    );
  return read.data;
}
