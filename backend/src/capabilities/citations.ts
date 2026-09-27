import { z } from "zod";
import { localDateKey, type DocBlock } from "@orbyn/core";
import {
  asSource,
  siteOf,
  type SourceRow,
} from "../modules/sources/service.js";
import {
  Params,
  scopeFor,
  visibleDocs,
  visibleOwned,
} from "../lib/visibility.js";
import { docId, teamFilter } from "./common.js";
import { cleanTitle } from "./format.js";
import { linksFor } from "./refs.js";
import {
  CapabilityError,
  defineCapability,
  type CapabilityContext,
} from "./registry.js";
import {
  cantWait,
  clientRefInput,
  destination,
  refuseSecrets,
} from "./write.js";
import type { UndoOp } from "./undo.js";

/**
 * Sources an agent read (H2): save_source keeps the address, title, the
 * words it quotes, the day it was read and who wrote it, once per space
 * (Personal or a team), linked to the pages and lines that use it. The
 * page's Info lists them under Sources, and fetch reads them back. Orbyn
 * never opens the address: it is checked as an https address and kept as
 * text, nothing more.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * An https address as it is kept (without its #fragment), or INVALID.
 * Only checked, never fetched.
 */
export function sourceUrl(raw: string): string {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    throw new CapabilityError(
      "INVALID",
      "url must be a full https address.",
      "Like https://example.org/article.",
    );
  }
  if (u.protocol !== "https:" || !u.hostname || u.username || u.password)
    throw new CapabilityError(
      "INVALID",
      "url must be an https address without a user name or password.",
    );
  u.hash = "";
  const url = u.toString();
  if (url.length > 2000)
    throw new CapabilityError("INVALID", "That address is too long to keep.");
  return url;
}

/** One source this connection can read, with the pages it can read that use it. */
export async function visibleSource(ctx: CapabilityContext, id: string) {
  const p = new Params();
  const scope = scopeFor(ctx.spaces, p);
  const row = (
    await ctx.db.query<SourceRow & { pages: { id: string; title: string }[] }>(
      `SELECT s.id, s.team_id, s.url, s.title, s.site, s.author, s.quote,
              to_char(s.accessed_on, 'YYYY-MM-DD') AS accessed_on,
              coalesce((SELECT array_agg(DISTINCT u.block_id) FROM source_uses u
                         WHERE u.source_id = s.id), '{}') AS lines,
              coalesce((SELECT json_agg(json_build_object('id', d.id, 'title', d.title))
                          FROM docs d
                         WHERE d.id IN (SELECT doc_id FROM source_uses WHERE source_id = s.id)
                           AND ${visibleDocs("d", scope)}), '[]'::json) AS pages
         FROM sources s
        WHERE s.id = ${p.add(id)} AND ${visibleOwned("s", "user_id", scope)}`,
      p.values,
    )
  ).rows[0];
  return row
    ? { ...asSource(row), team_id: row.team_id, pages: row.pages }
    : null;
}

const day = z
  .string()
  .max(10)
  .refine(
    (v) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)),
    "Use YYYY-MM-DD.",
  );

export const saveSource = defineCapability({
  name: "save_source",
  title: "Save a source",
  description:
    "Keeps a source you read (its https address, title, a quote, the day read, author, site) in Personal or a team, once per address there, linked to a page and its lines: the page's Info lists it under Sources. Orbyn never opens the address. Mark lines with [src: …] too (orbyn://spec/markdown).",
  input: z
    .object({
      url: z.string().trim().min(8).max(2000),
      title: z.string().trim().min(1).max(300),
      quote: z.string().trim().max(2000).optional(),
      accessed: day.optional().describe("YYYY-MM-DD; default today."),
      author: z.string().trim().max(200).optional(),
      site: z.string().trim().max(200).optional(),
      doc: z
        .string()
        .trim()
        .max(300)
        .optional()
        .describe("The page that uses it (its space is the source's)."),
      lines: z
        .array(z.string().max(64))
        .max(50)
        .optional()
        .describe("Anchors of the lines on doc that use it."),
      team: z.string().trim().max(100).optional(),
      client_ref: clientRefInput,
    })
    .strict(),
  output: z.object({
    source: z.string(),
    saved: z.string().describe("new, updated or unchanged"),
    marker: z.string(),
    url: z.string().nullable(),
    app_url: z.string().nullable(),
  }),
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  access: "suggest",
  toolset: "study",
  mode: "write",
  tier: "W1",
  async run(ctx, a) {
    refuseSecrets(a.url, a.title, a.quote, a.author, a.site);
    const url = sourceUrl(a.url);
    const me = ctx.principal.user.id;
    // The page decides the space; otherwise team (Personal by default).
    let page: {
      id: string;
      team_id: string | null;
      content: DocBlock[];
    } | null = null;
    if (a.doc) {
      const id = docId(a.doc)!;
      const p = new Params();
      const scope = scopeFor(ctx.spaces, p);
      page =
        (
          await ctx.db.query<{
            id: string;
            team_id: string | null;
            content: DocBlock[];
          }>(
            `SELECT d.id, d.team_id, d.content FROM docs d
              WHERE d.id = ${p.add(id)} AND ${visibleDocs("d", scope)}`,
            p.values,
          )
        ).rows[0] ?? null;
      if (!page)
        throw new CapabilityError(
          "NOT_FOUND",
          "Nothing with that id is reachable from this connection.",
          "Search for the page and use its id.",
        );
    } else if (a.lines?.length)
      throw new CapabilityError(
        "INVALID",
        "lines needs doc: the page they're on.",
      );
    const team = teamFilter(a.team);
    const teamId = page
      ? page.team_id
      : team && "team" in team
        ? team.team
        : null;
    if (
      page &&
      a.team &&
      (team && "team" in team ? team.team : null) !== teamId
    )
      throw new CapabilityError(
        "INVALID",
        "A source is kept in its page's space; leave team out.",
      );
    if (destination(ctx, teamId, "W1") === "review")
      throw cantWait(ctx, teamId);
    const lines = [
      ...new Set((a.lines ?? []).map((l) => l.replace(/^\^/, ""))),
    ];
    if (page) {
      const ids = new Set(
        (Array.isArray(page.content) ? page.content : []).map((b) => b.id),
      );
      const gone = lines.filter((l) => !ids.has(l));
      if (gone.length)
        throw new CapabilityError(
          "INVALID",
          `There is no line ${gone
            .slice(0, 5)
            .map((l) => `^${l}`)
            .join(", ")} on that page.`,
          "Fetch the page and use its lines' ^b… anchors.",
        );
    }
    const fields = {
      title: a.title,
      site: a.site ?? siteOf(url),
      author: a.author ?? null,
      quote: a.quote ?? null,
      accessed_on: a.accessed ?? localDateKey(ctx.now, ctx.timezone),
    };
    // One per address per space, even with two calls at once.
    await ctx.db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      `source:${teamId ?? `me:${me}`}:${url}`,
    ]);
    const existing = (
      await ctx.db.query<{
        id: string;
        title: string;
        site: string;
        author: string | null;
        quote: string | null;
        accessed_on: string;
      }>(
        `SELECT id, title, site, author, quote,
                to_char(accessed_on, 'YYYY-MM-DD') AS accessed_on
           FROM sources
          WHERE url = $1 AND ${teamId ? "team_id = $2" : "team_id IS NULL AND user_id = $2"}
          FOR UPDATE`,
        [url, teamId ?? me],
      )
    ).rows[0];
    let id: string;
    let saved: "new" | "updated" | "unchanged";
    const undo: UndoOp[] = [];
    if (existing) {
      id = existing.id;
      const same =
        existing.title === fields.title &&
        existing.site === fields.site &&
        existing.author === (a.author ?? existing.author) &&
        existing.quote === (a.quote ?? existing.quote) &&
        existing.accessed_on === fields.accessed_on;
      saved = same ? "unchanged" : "updated";
      if (!same) {
        await ctx.db.query(
          `UPDATE sources SET title = $2, site = $3,
                  author = coalesce($4, author), quote = coalesce($5, quote),
                  accessed_on = $6, updated_at = now()
            WHERE id = $1`,
          [
            id,
            fields.title,
            fields.site,
            a.author ?? null,
            a.quote ?? null,
            fields.accessed_on,
          ],
        );
        undo.push({
          op: "source.restore",
          id,
          fields: {
            title: existing.title,
            site: existing.site,
            author: existing.author,
            quote: existing.quote,
            accessed_on: existing.accessed_on,
          },
        });
      }
    } else {
      id = (
        await ctx.db.query<{ id: string }>(
          `INSERT INTO sources (user_id, team_id, grant_id, url, title, site,
             author, quote, accessed_on)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
          [
            me,
            teamId,
            ctx.principal.grant_id,
            url,
            fields.title,
            fields.site,
            fields.author,
            fields.quote,
            fields.accessed_on,
          ],
        )
      ).rows[0].id;
      saved = "new";
      undo.push({ op: "source.delete", id });
    }
    if (page) {
      const added = (
        await ctx.db.query<{ block_id: string }>(
          `INSERT INTO source_uses (source_id, doc_id, block_id)
           SELECT $1, $2, b FROM unnest($3::text[]) AS b
           ON CONFLICT DO NOTHING RETURNING block_id`,
          [id, page.id, lines.length ? lines : [""]],
        )
      ).rows.map((r) => r.block_id);
      if (added.length && saved !== "new")
        undo.push({ op: "source.unlink", id, doc_id: page.id, lines: added });
    }
    const marker = `[src: ${cleanTitle(a.title)
      .replace(/[[\]\n]/g, " ")
      .slice(0, 120)}]`;
    const where = page ? ` for doc:${page.id}` : "";
    // The page it was saved for opens with its Sources in Info.
    const open = page ? linksFor({ type: "doc", id: page.id }) : null;
    return {
      structured: {
        source: `source:${id}`,
        saved,
        marker,
        url: open?.url ?? null,
        app_url: open?.app_url ?? null,
      },
      markdown: `Source ${saved === "new" ? "saved" : saved === "updated" ? "updated" : "already saved"}${where}: ${cleanTitle(a.title)} (source:${id}). Orbyn didn't open the address. Mark the lines that use it with ${marker}.${open ? `\nOpen the page on the web: ${open.url} · in the Orbyn app: ${open.app_url}` : ""}`,
      targets: [`source:${id}`, ...(page ? [`doc:${page.id}`] : [])],
      write: {
        outcome: "ok",
        undo,
        team_id: teamId,
      },
    };
  },
});

/** The typed id's uuid, when it's a source. */
export const sourceId = (value: string): string | null => {
  const m = /^(?:source:)?(.+)$/i.exec(value.trim());
  return m && UUID.test(m[1]) ? m[1].toLowerCase() : null;
};
