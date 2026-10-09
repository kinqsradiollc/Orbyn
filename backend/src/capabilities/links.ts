import { z } from "zod";
import {
  Params,
  scopeFor,
  visibleDocs,
  visibleItems,
  visibleProjects,
  type Scope,
} from "../lib/visibility.js";
import { READ, cursorInput } from "./common.js";
import {
  cleanTitle,
  labelled,
  lineTitle,
  provenanceOf,
  titleFor,
  type Provenance,
} from "./format.js";
import { parseRef, refs, appUrl, type RefType } from "./refs.js";
import {
  CapabilityError,
  defineCapability,
  type CapabilityContext,
} from "./registry.js";
import { docEditorsSql, itemSourceSql } from "./sources.js";

/**
 * Backlinks and outgoing links (get_links), from the object_links index the
 * app's "Linked here" reads: links made with the link picker, people named
 * in comments, tasks made from checklist lines, dependencies, pages filed
 * in a project, meeting notes and manual "related" links. Each comes with
 * the line it sits on. A link whose other end this connection can't see is
 * dropped without being counted, so nothing about it leaks.
 */

export const LINK_KINDS = [
  "link",
  "mention",
  "task_line",
  "dependency",
  "project",
  "meeting",
  "related",
] as const;

type Kind = "doc" | "task" | "project" | "person" | "date";

const end = z.object({
  id: z.string(),
  type: z.enum(["doc", "task", "event", "project", "person", "date"]),
  title: z.string(),
  url: z.string().nullable(),
});

const linkRow = z.object({
  direction: z.enum(["in", "out"]).describe("in is a backlink."),
  kind: z.enum(LINK_KINDS),
  other: end,
  line: z.string().nullable().describe("The line the link sits on."),
  block: z.string().nullable().describe("That line's anchor."),
});

/** A link's subject: what get_links (and resources) are asked about. */
export type Subject = { kind: Kind; id: string };

const PERSON = /^person:([0-9a-f-]{36})$/i;
const DATE = /^date:(\d{4}-\d{2}-\d{2})$/;

/** Whatever was asked about, understood. */
export function subjectOf(input: string): Subject {
  const text = input.trim();
  const person = PERSON.exec(text);
  if (person) return { kind: "person", id: person[1].toLowerCase() };
  const date = DATE.exec(text);
  if (date) return { kind: "date", id: date[1] };
  const ref = parseRef(text);
  if (ref.type === "doc") return { kind: "doc", id: ref.id };
  if (ref.type === "task" || ref.type === "event")
    return { kind: "task", id: ref.id };
  if (ref.type === "project") return { kind: "project", id: ref.id };
  throw new CapabilityError(
    "INVALID",
    "Ask about a page, task, event, project, person or date: doc:<id>, task:<id>, project:<id>, person:<id> or date:YYYY-MM-DD.",
    "Use an id from search or fetch.",
  );
}

/** SQL: whether the thing `kindSql`/`idSql` names is visible in `scope`. */
function visibleEnd(
  kindSql: string,
  idSql: string,
  scope: Scope,
  teams: string,
): string {
  return `(CASE ${kindSql}
    WHEN 'doc' THEN EXISTS (SELECT 1 FROM docs d WHERE d.id::text = ${idSql} AND ${visibleDocs("d", scope)})
    WHEN 'task' THEN EXISTS (SELECT 1 FROM items i WHERE i.id::text = ${idSql} AND ${visibleItems("i", scope)})
    WHEN 'project' THEN EXISTS (SELECT 1 FROM projects p WHERE p.id::text = ${idSql} AND ${visibleProjects("p", scope)})
    WHEN 'person' THEN ${idSql} = ${scope.user}::text OR EXISTS (
      SELECT 1 FROM team_members m WHERE m.user_id::text = ${idSql}
         AND m.team_id = ANY (${teams}::uuid[]))
    WHEN 'date' THEN true
    ELSE false END)`;
}

type Raw = {
  direction: "in" | "out";
  kind: (typeof LINK_KINDS)[number];
  other_kind: Kind;
  other_id: string;
  block: string;
  context: string;
  /** Whose line it is: the link's source (a page or task). */
  source_kind: "doc" | "task";
  source_id: string;
};

/** Titles, kinds and provenance for the ends of some links. */
async function describeEnds(
  ctx: CapabilityContext,
  ends: { kind: Kind; id: string }[],
) {
  const ids = (k: Kind) => [
    ...new Set(ends.filter((e) => e.kind === k).map((e) => e.id)),
  ];
  const p = new Params();
  const viewer = p.add(ctx.principal.user.id);
  const docIds = p.add(ids("doc"));
  const taskIds = p.add(ids("task"));
  const projectIds = p.add(ids("project"));
  const personIds = p.add(ids("person"));
  const rows = (
    await ctx.db.query<{
      kind: Kind;
      id: string;
      title: string;
      item_kind: string | null;
      user_id: string | null;
      author_name: string | null;
      imported: boolean;
      source: string | null;
      editors: string[] | null;
      project_id: string | null;
    }>(
      `SELECT 'doc' AS kind, d.id::text, d.title, NULL AS item_kind, d.user_id, u.name AS author_name,
              d.imported_from IS NOT NULL AS imported, NULL AS source,
              ${docEditorsSql("d", viewer)} AS editors, d.project_id
         FROM docs d JOIN users u ON u.id = d.user_id WHERE d.id = ANY (${docIds}::uuid[])
       UNION ALL
       SELECT 'task', i.id::text, i.title, i.kind, i.user_id, u.name, false,
              ${itemSourceSql("i")}, NULL, i.project_id
         FROM items i JOIN users u ON u.id = i.user_id WHERE i.id = ANY (${taskIds}::uuid[])
       UNION ALL
       SELECT 'project', p.id::text, p.name, NULL, p.user_id, NULL, false, NULL, NULL, p.id
         FROM projects p WHERE p.id = ANY (${projectIds}::uuid[])
       UNION ALL
       SELECT 'person', u.id::text, u.name, NULL, u.id, u.name, false, NULL, NULL, NULL
         FROM users u WHERE u.id = ANY (${personIds}::uuid[])`,
      p.values,
    )
  ).rows;
  const hide = ctx.principal.flags.hide_outside_content;
  const out = new Map<
    string,
    { end: z.output<typeof end>; provenance: Provenance }
  >();
  for (const r of rows) {
    const provenance =
      r.kind === "person" || r.kind === "project"
        ? ("you" as Provenance)
        : provenanceOf(ctx.principal.user.id, r);
    const type: z.output<typeof end>["type"] =
      r.kind === "task" ? (r.item_kind === "event" ? "event" : "task") : r.kind;
    const ref =
      r.kind === "person"
        ? null
        : refs({ type: type as RefType, id: r.id }, r.project_id);
    out.set(`${r.kind}:${r.id}`, {
      end: {
        id: ref ? ref.id : `person:${r.id}`,
        type,
        title:
          (r.kind === "task"
            ? titleFor(r.title, provenance, hide, r.item_kind ?? undefined)
            : cleanTitle(r.title)) || "Untitled",
        url: ref?.url ?? null,
      },
      provenance,
    });
  }
  for (const e of ends)
    if (e.kind === "date")
      out.set(`date:${e.id}`, {
        end: {
          id: `date:${e.id}`,
          type: "date",
          title: e.id,
          url: `${appUrl()}/app/today`,
        },
        provenance: "you",
      });
  return out;
}

export const getLinks = defineCapability({
  name: "get_links",
  title: "Backlinks and links",
  description:
    "Backlinks (in) and outgoing links (out) for a page, task, event, project, person or date: picker links, comment mentions, checklist tasks, dependencies, pages filed in a project, meeting notes and related links, each with its line. For a project, include unresolved and orphans. Ends this connection can't see are left out.",
  input: z
    .object({
      of: z
        .string()
        .trim()
        .min(1)
        .max(300)
        .describe(
          "doc:, task:, project:, person:<id>, date:YYYY-MM-DD, or a link.",
        ),
      direction: z.enum(["both", "in", "out"]).default("both"),
      kinds: z.array(z.enum(LINK_KINDS)).max(LINK_KINDS.length).optional(),
      include: z
        .array(z.enum(["unresolved", "orphans"]))
        .max(2)
        .optional(),
      limit: z.number().int().min(1).max(100).default(50),
      cursor: cursorInput,
    })
    .strict(),
  output: z.object({
    of: end,
    links: z.array(linkRow),
    unresolved: z
      .array(
        z.object({
          from: z.string(),
          block: z.string().nullable(),
          target: z.string(),
        }),
      )
      .describe("Links from the project's pages to things that are gone."),
    orphans: z
      .array(z.object({ id: z.string(), title: z.string() }))
      .describe("The project's pages with no links."),
    next_cursor: z.string().nullable(),
  }),
  annotations: READ,
  access: "read",
  toolset: "core",
  mode: "read",
  tier: "R",
  async run(ctx, a) {
    const offset = await ctx.cursor.open(a.cursor);
    const subject = subjectOf(a.of);
    const p = new Params();
    const scope = scopeFor(ctx.spaces, p);
    const teams = p.add(ctx.spaces.teamIds ?? []);
    // The subject itself must be visible (NOT_FOUND otherwise, either way).
    const k = p.add(subject.kind);
    const id = p.add(subject.id);
    const seen = (
      await ctx.db.query<{ ok: boolean }>(
        `SELECT ${visibleEnd(k, id, scope, teams)} AS ok`,
        p.values,
      )
    ).rows[0]?.ok;
    if (!seen)
      throw new CapabilityError(
        "NOT_FOUND",
        "Nothing with that id is reachable from this connection.",
        "Use an id from search or fetch.",
      );
    const kinds = a.kinds?.length ? p.add(a.kinds) : null;
    const kindFilter = kinds ? `AND l.link_kind = ANY (${kinds}::text[])` : "";
    const parts: string[] = [];
    if (a.direction !== "out")
      parts.push(`SELECT 'in' AS direction, l.link_kind AS kind,
          l.source_kind AS other_kind, l.source_id::text AS other_id,
          l.source_block AS block, l.context, l.source_kind, l.source_id::text AS source_id,
          l.created_at
        FROM object_links l
       WHERE l.target_kind = ${k} AND l.target_id = ${id} ${kindFilter}
         AND ${visibleEnd("l.source_kind", "l.source_id::text", scope, teams)}`);
    if (
      a.direction !== "in" &&
      (subject.kind === "doc" || subject.kind === "task")
    )
      parts.push(`SELECT 'out' AS direction, l.link_kind AS kind,
          l.target_kind AS other_kind, l.target_id AS other_id,
          l.source_block AS block, l.context, l.source_kind,
          l.source_id::text AS source_id, l.created_at
        FROM object_links l
       WHERE l.source_kind = ${k} AND l.source_id::text = ${id} ${kindFilter}
         AND ${visibleEnd("l.target_kind", "l.target_id", scope, teams)}`);
    const raw = parts.length
      ? (
          await ctx.db.query<Raw>(
            `SELECT * FROM (${parts.join(" UNION ALL ")}) x
              ORDER BY x.created_at DESC, x.other_kind, x.other_id, x.block
              LIMIT ${a.limit + 1} OFFSET ${offset}`,
            p.values,
          )
        ).rows
      : [];
    const page = raw.slice(0, a.limit);

    // Unresolved and orphans, for a project's own pages.
    const wantUnresolved =
      subject.kind === "project" && a.include?.includes("unresolved");
    const wantOrphans =
      subject.kind === "project" && a.include?.includes("orphans");
    const q = new Params();
    const qs = scopeFor(ctx.spaces, q);
    const pid = q.add(subject.id);
    const unresolvedRaw = wantUnresolved
      ? (
          await ctx.db.query<{
            doc_id: string;
            block: string;
            target_kind: string;
            target_id: string;
          }>(
            `SELECT l.source_id::text AS doc_id, l.source_block AS block,
                    l.target_kind, l.target_id
               FROM object_links l JOIN docs d ON d.id = l.source_id
              WHERE l.source_kind = 'doc' AND d.project_id = ${pid}
                AND ${visibleDocs("d", qs)}
                AND l.link_kind IN ('link', 'related')
                AND CASE l.target_kind
                  WHEN 'doc' THEN NOT EXISTS (SELECT 1 FROM docs t WHERE t.id::text = l.target_id AND t.deleted_at IS NULL)
                  WHEN 'task' THEN NOT EXISTS (SELECT 1 FROM items t WHERE t.id::text = l.target_id)
                  WHEN 'project' THEN NOT EXISTS (SELECT 1 FROM projects t WHERE t.id::text = l.target_id)
                  ELSE false END
              ORDER BY l.created_at DESC LIMIT 50`,
            q.values,
          )
        ).rows
      : [];
    const o = new Params();
    const os = scopeFor(ctx.spaces, o);
    const opid = o.add(subject.id);
    const oteams = o.add(ctx.spaces.teamIds ?? []);
    const orphanIds = wantOrphans
      ? (
          await ctx.db.query<{ id: string }>(
            `SELECT d.id::text FROM docs d
              WHERE d.project_id = ${opid} AND ${visibleDocs("d", os)}
                -- Only links whose other end this connection sees count.
                AND NOT EXISTS (SELECT 1 FROM object_links l
                  WHERE l.source_kind = 'doc' AND l.source_id = d.id
                    AND l.link_kind <> 'project'
                    AND ${visibleEnd("l.target_kind", "l.target_id", os, oteams)})
                AND NOT EXISTS (SELECT 1 FROM object_links l
                  WHERE l.target_kind = 'doc' AND l.target_id = d.id::text
                    AND ${visibleEnd("l.source_kind", "l.source_id::text", os, oteams)})
              ORDER BY d.updated_at DESC LIMIT 50`,
            o.values,
          )
        ).rows.map((r) => r.id)
      : [];

    const ends = await describeEnds(ctx, [
      subject,
      ...page.map((r) => ({ kind: r.other_kind, id: r.other_id })),
      ...page.map((r) => ({
        kind: r.source_kind as Kind,
        id: r.source_id,
      })),
      ...unresolvedRaw.map((r) => ({ kind: "doc" as Kind, id: r.doc_id })),
      ...orphanIds.map((id) => ({ kind: "doc" as Kind, id })),
    ]);
    const hide = ctx.principal.flags.hide_outside_content;
    const me = ends.get(`${subject.kind}:${subject.id}`);
    if (!me)
      throw new CapabilityError(
        "NOT_FOUND",
        "Nothing with that id is reachable from this connection.",
      );
    const links = page.flatMap((r) => {
      const other = ends.get(`${r.other_kind}:${r.other_id}`);
      if (!other) return [];
      const source = ends.get(`${r.source_kind}:${r.source_id}`);
      const context = (r.context ?? "").trim();
      const block =
        r.source_kind === "doc" && r.block && !r.block.startsWith("#")
          ? r.block
          : null;
      return [
        {
          direction: r.direction,
          kind: r.kind,
          other: other.end,
          line: context
            ? labelled(context, source?.provenance ?? "you", hide).slice(
                0,
                1200,
              )
            : null,
          block,
        },
      ];
    });
    const unresolved = unresolvedRaw.flatMap((r) => {
      const from = ends.get(`doc:${r.doc_id}`);
      return from
        ? [
            {
              from: from.end.id,
              block: r.block.startsWith("#") ? null : r.block,
              target: `${r.target_kind}:${r.target_id}`,
            },
          ]
        : [];
    });
    const orphans = orphanIds.flatMap((id) => {
      const d = ends.get(`doc:${id}`);
      return d ? [{ id: d.end.id, title: d.end.title }] : [];
    });
    const next =
      raw.length > a.limit ? await ctx.cursor.seal(offset + a.limit) : null;
    const line = (e: z.output<typeof end>) =>
      e.url ? lineTitle(e.title, e.url, "you", e.type) : e.title;
    const markdown = [
      `Links for ${line(me.end)}: ${links.filter((l) => l.direction === "in").length} in, ${links.filter((l) => l.direction === "out").length} out${next ? " (more with next_cursor)" : ""}.`,
      ...links.map(
        (l) =>
          `- ${l.direction === "in" ? "←" : "→"} ${l.kind}: ${line(l.other)} · ${l.other.id}${l.block ? ` (line ${l.block})` : ""}${l.line ? `\n  ${l.line.replace(/\n/g, "\n  ")}` : ""}`,
      ),
      ...(unresolved.length
        ? [
            "Unresolved links:",
            ...unresolved.map((u) => `- ${u.from} → ${u.target} (gone)`),
          ]
        : []),
      ...(orphans.length
        ? [
            "Pages with no links:",
            ...orphans.map((d) => `- ${d.title} · ${d.id}`),
          ]
        : []),
    ].join("\n");
    return {
      structured: { of: me.end, links, unresolved, orphans, next_cursor: next },
      markdown,
      targets: [me.end.id, ...links.map((l) => l.other.id)].slice(0, 20),
      links: links
        .filter((l) => l.other.url && l.other.type !== "date")
        .slice(0, 20)
        .map((l) => ({
          uri: `orbyn://${l.other.type === "event" ? "task" : l.other.type}/${l.other.id.replace(/^\w+:/, "").slice(0, 36)}`,
          name: l.other.title,
        })),
    };
  },
});
