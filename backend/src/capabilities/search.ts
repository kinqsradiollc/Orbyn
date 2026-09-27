import { z } from "zod";
import type { DocBlock } from "@orbyn/core";
import {
  Params,
  scopeFor,
  visibleDocs,
  visibleItems,
  visibleProjects,
  visibleRecords,
  visibleTemplates,
  visibleViews,
  visibleFolders,
  visiblePageTemplates,
  visibleOwned,
  type Scope,
} from "../lib/visibility.js";

/** Lists and tags follow the owner-or-team rule of everything else. */
const visibleOwnedOf = (alias: string, scope: Scope) =>
  visibleOwned(alias, "user_id", scope);
import {
  READ,
  cursorInput,
  docId,
  projectId,
  projectInput,
  teamFilter,
  teamInput,
} from "./common.js";
import {
  clean,
  cleanTitle,
  fence,
  isOutside,
  lineTitle,
  maskEmails,
  provenanceOf,
  titleFor,
  type Provenance,
} from "./format.js";
import { refs, type RefType } from "./refs.js";
import { searchRank } from "../modules/search/rank.js";
import { docEditorsSql, itemSourceSql } from "./sources.js";
import { defineCapability, type CapabilityContext } from "./registry.js";
import { linkPrivacy } from "../modules/links/privacy.js";

/**
 * Finding things: `search` (the quick switcher and full-text search in one)
 * and `find_passages` (the lines of pages that answer a question, with
 * citations). Both rank by words, letters of the title and recency only:
 * no embeddings and no AI provider on the MCP path, ever.
 *
 * search follows OpenAI's search contract (only `query` is needed; results
 * carry id, title and an absolute url; the text content is the JSON of the
 * structured content), so ChatGPT deep research can use it as is.
 */

/** Matched words are marked **like this** (not [[ ]], which pages may use). */
const MARKS =
  "StartSel=**, StopSel=**, MaxWords=26, MinWords=10, MaxFragments=1";

/**
 * Word match, lifted for recent changes, plus a little for a title that
 * looks right: the app's own ranking (the search service's), so an agent
 * and the search box put things in the same order.
 */
const rank = searchRank;

const SEARCH_TYPES = [
  "task",
  "event",
  "doc",
  "project",
  "record",
  "view",
  "template",
  "folder",
  "list",
  "tag",
] as const;

const hit = z.object({
  id: z.string(),
  title: z.string(),
  url: z.string(),
  type: z.enum(SEARCH_TYPES),
  snippet: z.string().nullable(),
  block_id: z.string().nullable(),
  provenance: z.string(),
  team_id: z.string().nullable(),
  updated_at: z.string(),
});
type Hit = z.output<typeof hit> & { rank: number };

const searchInput = z
  .object({
    query: z.string().trim().min(1).max(500).describe("Words to look for."),
    types: z
      .array(z.enum(SEARCH_TYPES))
      .min(1)
      .max(5)
      .optional()
      .describe("Only these kinds of things."),
    match: z
      .enum(["words", "title"])
      .default("words")
      .describe(
        '"title" finds things by name as the quick switcher does; "words" searches everything written.',
      ),
    project: projectInput,
    team: teamInput,
    status: z
      .enum(["open", "closed", "any"])
      .default("any")
      .describe("Tasks and projects that are open, finished, or either."),
    updated_after: z.iso
      .datetime({ offset: true })
      .optional()
      .describe("Only things changed since this instant."),
    limit: z.number().int().min(1).max(50).default(10),
    cursor: cursorInput,
  })
  .strict();

type SearchRow = {
  id: string;
  kind: string;
  title: string;
  team_id: string | null;
  user_id: string;
  author_name: string | null;
  updated_at: Date;
  snippet: string | null;
  block_id: string | null;
  imported: boolean;
  /** An item's outside source (a booking guest, an email). */
  source?: string | null;
  /** Other people who changed a team page. */
  editors?: string[] | null;
  rank: string;
};

async function runSearch(
  ctx: CapabilityContext,
  a: z.output<typeof searchInput>,
): Promise<{ hits: Hit[]; more: boolean; offset: number }> {
  const offset = await ctx.cursor.open(a.cursor);
  const want = Math.min(offset + a.limit + 1, 250);
  const types = new Set(a.types ?? SEARCH_TYPES);
  const project = projectId(a.project);
  const team = teamFilter(a.team);
  const title = a.match === "title";

  /** The shared filters, on alias `x`, with the params the query uses. */
  const common = (x: string, params: Params, updated = `${x}.updated_at`) => {
    const where: string[] = [];
    if (team && "personal" in team) where.push(`${x}.team_id IS NULL`);
    if (team && "team" in team)
      where.push(`${x}.team_id = ${params.add(team.team)}`);
    if (a.updated_after)
      where.push(`${updated} >= ${params.add(a.updated_after)}`);
    return where;
  };
  const textMatch = (vector: string, name: string, q: string) =>
    title
      ? `(${name} ILIKE '%' || ${q} || '%' OR similarity(${name}, ${q}) > 0.3)`
      : `(${vector} @@ q.tsq OR similarity(${name}, ${q}) > 0.25)`;

  const rows: (SearchRow & { type: (typeof SEARCH_TYPES)[number] })[] = [];

  if (types.has("task") || types.has("event")) {
    const params = new Params();
    const scope = scopeFor(ctx.spaces, params);
    const q = params.add(a.query);
    const where = [
      visibleItems("i", scope),
      textMatch("i.search", "i.title", q),
      ...common("i", params),
    ];
    if (!types.has("event")) where.push("i.kind <> 'event'");
    if (!types.has("task")) where.push("i.kind = 'event'");
    if (project) where.push(`i.project_id = ${params.add(project)}`);
    if (a.status === "open")
      where.push("i.status NOT IN ('done', 'cancelled')");
    if (a.status === "closed") where.push("i.status IN ('done', 'cancelled')");
    const found = await ctx.db.query<SearchRow>(
      `WITH q AS (SELECT websearch_to_tsquery('english', ${q}) AS tsq)
       SELECT i.id, i.kind, i.title, i.team_id, i.user_id, u.name AS author_name,
              i.updated_at, false AS imported, NULL AS block_id,
              ${itemSourceSql("i")} AS source,
              CASE WHEN i.notes <> '' THEN ts_headline('english', i.notes, q.tsq, '${MARKS}') END AS snippet,
              ${rank("i.search", "i.title", "i.updated_at", q)} AS rank
         FROM items i JOIN users u ON u.id = i.user_id CROSS JOIN q
        WHERE ${where.join(" AND ")}
        ORDER BY rank DESC, i.updated_at DESC
        LIMIT ${want}`,
      params.values,
    );
    rows.push(
      ...found.rows.map((r) => ({
        ...r,
        type: (r.kind === "event" ? "event" : "task") as "event" | "task",
      })),
    );
  }

  if (types.has("doc")) {
    const params = new Params();
    const scope = scopeFor(ctx.spaces, params);
    const q = params.add(a.query);
    const where = [
      visibleDocs("d", scope),
      "d.kind NOT IN ('memory', 'agent')",
      textMatch("d.search", "d.title", q),
      ...common("d", params),
    ];
    if (project) where.push(`d.project_id = ${params.add(project)}`);
    const found = await ctx.db.query<SearchRow>(
      `WITH q AS (SELECT websearch_to_tsquery('english', ${q}) AS tsq)
       SELECT d.id, d.kind, d.title, d.team_id, d.user_id, u.name AS author_name,
              d.updated_at, d.imported_from IS NOT NULL AS imported,
              ${docEditorsSql("d", scope.user)} AS editors,
              ts_headline('english', doc_words(d.content, NULL), q.tsq, '${MARKS}') AS snippet,
              (SELECT b->>'id' FROM jsonb_array_elements(d.content) b
                WHERE b->>'text' IS NOT NULL AND b->>'id' IS NOT NULL
                  AND to_tsvector('english', b->>'text') @@ q.tsq
                LIMIT 1) AS block_id,
              ${rank("d.search", "d.title", "d.updated_at", q)} AS rank
         FROM docs d JOIN users u ON u.id = d.user_id CROSS JOIN q
        WHERE ${where.join(" AND ")}
        ORDER BY rank DESC, d.updated_at DESC
        LIMIT ${want}`,
      params.values,
    );
    rows.push(...found.rows.map((r) => ({ ...r, type: "doc" as const })));
  }

  if (types.has("project") && !project) {
    const params = new Params();
    const scope = scopeFor(ctx.spaces, params);
    const q = params.add(a.query);
    const vector = "to_tsvector('english', p.name || ' ' || p.summary)";
    const where = [
      visibleProjects("p", scope),
      textMatch(vector, "p.name", q),
      ...common("p", params),
    ];
    if (a.status === "open") where.push("p.status <> 'archived'");
    if (a.status === "closed") where.push("p.status = 'archived'");
    const found = await ctx.db.query<SearchRow>(
      `WITH q AS (SELECT websearch_to_tsquery('english', ${q}) AS tsq)
       SELECT p.id, 'project' AS kind, p.name AS title, p.team_id, p.user_id,
              u.name AS author_name, p.updated_at, false AS imported, NULL AS block_id,
              CASE WHEN p.summary <> '' THEN ts_headline('english', p.summary, q.tsq, '${MARKS}') END AS snippet,
              ${rank(vector, "p.name", "p.updated_at", q)} AS rank
         FROM projects p JOIN users u ON u.id = p.user_id CROSS JOIN q
        WHERE ${where.join(" AND ")}
        ORDER BY rank DESC, p.updated_at DESC
        LIMIT ${want}`,
      params.values,
    );
    rows.push(...found.rows.map((r) => ({ ...r, type: "project" as const })));
  }

  if (types.has("record")) {
    const params = new Params();
    const scope = scopeFor(ctx.spaces, params);
    const q = params.add(a.query);
    const vector = "to_tsvector('english', w.title || ' ' || w.details)";
    const where = [
      visibleRecords("w", scope),
      textMatch(vector, "w.title", q),
      ...common("w", params),
    ];
    if (project) where.push(`w.project_id = ${params.add(project)}`);
    const found = await ctx.db.query<SearchRow>(
      `WITH q AS (SELECT websearch_to_tsquery('english', ${q}) AS tsq)
       SELECT w.id, w.kind, w.title, w.team_id, w.created_by AS user_id,
              u.name AS author_name, w.updated_at, false AS imported, NULL AS block_id,
              CASE WHEN w.details <> '' THEN ts_headline('english', w.details, q.tsq, '${MARKS}') END AS snippet,
              ${rank(vector, "w.title", "w.updated_at", q)} AS rank
         FROM work_records w JOIN users u ON u.id = w.created_by CROSS JOIN q
        WHERE ${where.join(" AND ")}
        ORDER BY rank DESC, w.updated_at DESC
        LIMIT ${want}`,
      params.values,
    );
    rows.push(...found.rows.map((r) => ({ ...r, type: "record" as const })));
  }

  // Saved views, templates (project and page), folders, lists and tags, by
  // name (no project filter applies).
  for (const [type, table, alias, vis, name] of [
    ["view", "saved_views", "v", visibleViews, "v.name"],
    ["template", "project_templates", "t", visibleTemplates, "t.name"],
    ["template", "page_templates", "t", visiblePageTemplates, "t.name"],
    ["folder", "folders", "f", visibleFolders, "f.name"],
    ["list", "lists", "l", visibleOwnedOf, "l.name"],
    ["tag", "tags", "g", visibleOwnedOf, "g.name"],
  ] as const) {
    if (!types.has(type) || project || a.status === "closed") continue;
    const params = new Params();
    const scope = scopeFor(ctx.spaces, params);
    const q = params.add(a.query);
    const stamp = ["folders", "lists", "tags"].includes(table)
      ? `${alias}.created_at`
      : `${alias}.updated_at`;
    const where = [
      vis(alias, scope),
      `(${name} ILIKE '%' || ${q} || '%' OR similarity(${name}, ${q}) > 0.3)`,
      ...common(alias, params, stamp),
    ];
    const found = await ctx.db.query<SearchRow>(
      `SELECT ${alias}.id, '${type}' AS kind, ${name} AS title, ${alias}.team_id,
              ${alias}.user_id, u.name AS author_name, ${stamp} AS updated_at,
              false AS imported, NULL AS block_id, NULL AS snippet,
              (similarity(${name}, ${q}) * 0.6 + 0.4 / (1 + extract(epoch FROM now() - ${stamp}) / 2592000))::text AS rank
         FROM ${table} ${alias} JOIN users u ON u.id = ${alias}.user_id
        WHERE ${where.join(" AND ")}
        ORDER BY rank DESC LIMIT ${want}`,
      params.values,
    );
    rows.push(...found.rows.map((r) => ({ ...r, type })));
  }

  const hideOutside = ctx.principal.flags.hide_outside_content;
  const sorted = rows
    .map((r): Hit => {
      const r0 = refs({
        type: r.type as RefType,
        id: r.id,
        ...(r.block_id ? { block: r.block_id } : {}),
      });
      const provenance = provenanceOf(ctx.principal.user.id, {
        user_id: r.user_id,
        author_name: r.author_name,
        imported: r.imported,
        source: r.source,
        editors: r.editors,
      });
      const snippet =
        r.snippet && !(hideOutside && isOutside(provenance))
          ? clean(r.snippet, 400)
          : null;
      return {
        id: r0.id,
        title: titleFor(r.title, provenance, hideOutside, r.type) || "Untitled",
        url: r0.url,
        type: r.type,
        // Left out when it came from outside and the connection hides that.
        snippet:
          snippet && provenance === "booking_guest"
            ? maskEmails(snippet)
            : snippet,
        block_id: r.block_id,
        provenance,
        team_id: r.team_id,
        updated_at: new Date(r.updated_at).toISOString(),
        rank: Number(r.rank),
      };
    })
    .sort(
      (x, y) => y.rank - x.rank || y.updated_at.localeCompare(x.updated_at),
    );
  return {
    hits: sorted.slice(offset, offset + a.limit),
    more: sorted.length > offset + a.limit,
    offset,
  };
}

export const search = defineCapability({
  name: "search",
  title: "Search Orbyn",
  description:
    'Find tasks, events, pages, projects, work records, saved views, templates, folders, lists and tags by words, by name (match: "title", like the quick switcher), or both, ranked by match and recency. Only query is needed; filter by types, project, team ("personal" or a team id), status and updated_after. Each result: a typed id for fetch, title, url, a snippet with matches in **bold**, the page line (block_id) and provenance. Pages with next_cursor.',
  input: searchInput,
  output: z.object({
    results: z.array(hit),
    next_cursor: z.string().nullable(),
  }),
  annotations: READ,
  access: "read",
  toolset: "core",
  mode: "read",
  tier: "R",
  jsonText: true,
  limitGroup: "search",
  async run(ctx, a) {
    const { hits, more, offset } = await runSearch(ctx, a);
    const results = hits.map(({ rank: _rank, ...h }) => h);
    const next = more ? await ctx.cursor.seal(offset + a.limit) : null;
    return {
      structured: { results, next_cursor: next },
      markdown: "",
      targets: results.map((r) => r.id),
    };
  },
});

// ------------------------------------------------------------ find_passages

const passage = z.object({
  quote: z.string(),
  heading_path: z.array(z.string()),
  block_id: z.string().nullable(),
  citation_url: z.string(),
  provenance: z.string(),
  source: z.object({
    id: z.string(),
    type: z.enum(["doc", "task", "event", "record"]),
    title: z.string(),
    url: z.string(),
  }),
});

/** The headings above block `pos` (0-based), outermost first. */
function headingPath(content: DocBlock[], pos: number): string[] {
  const path: { level: number; text: string }[] = [];
  for (let i = 0; i < pos && i < content.length; i++) {
    const b = content[i];
    if (b.type !== "heading") continue;
    while (path.length && path[path.length - 1].level >= b.level) path.pop();
    path.push({ level: b.level, text: cleanTitle(b.text) });
  }
  return path.map((h) => h.text);
}

const QUOTE_MAX = 600;

export const findPassages = defineCapability({
  name: "find_passages",
  title: "Find passages with citations",
  description:
    "The lines of pages (and task notes and decisions) that best match a question, for answering with citations. Each passage has a quote of at most 600 characters, the headings above it, its source, a citation url that opens the page at that line, and who wrote it. Scope it with project, doc, folder or team. Ranked without AI; you write the answer.",
  input: z
    .object({
      query: z
        .string()
        .trim()
        .min(1)
        .max(500)
        .describe("The question or words to find."),
      project: projectInput,
      doc: z
        .string()
        .trim()
        .max(300)
        .optional()
        .describe("Only this page: doc:<id>."),
      folder: z.uuid().optional().describe("Only pages in this folder."),
      team: teamInput,
      limit: z.number().int().min(1).max(25).default(8),
    })
    .strict(),
  output: z.object({ passages: z.array(passage) }),
  annotations: READ,
  access: "read",
  toolset: "core",
  mode: "read",
  tier: "R",
  limitGroup: "search",
  async run(ctx, a) {
    const project = projectId(a.project);
    const doc = docId(a.doc);
    const team = teamFilter(a.team);
    const params = new Params();
    const scope = scopeFor(ctx.spaces, params);
    const q = params.add(a.query);
    const where = [
      visibleDocs("d", scope),
      "d.kind NOT IN ('memory', 'agent')",
      `(d.search @@ q.tsq OR similarity(d.title, ${q}) > 0.3)`,
    ];
    if (project) where.push(`d.project_id = ${params.add(project)}`);
    if (doc) where.push(`d.id = ${params.add(doc)}`);
    if (a.folder) where.push(`d.folder_id = ${params.add(a.folder)}`);
    if (team && "personal" in team) where.push("d.team_id IS NULL");
    if (team && "team" in team)
      where.push(`d.team_id = ${params.add(team.team)}`);
    const limit = params.add(a.limit * 3);
    const found = await ctx.db.query<{
      doc_id: string;
      pos: number;
      block_id: string | null;
      text: string;
      rank: string;
    }>(
      `WITH q AS (SELECT websearch_to_tsquery('english', ${q}) AS tsq),
       cand AS (
         SELECT d.id, d.updated_at, d.content FROM docs d, q
          WHERE ${where.join(" AND ")}
          ORDER BY ts_rank_cd(d.search, q.tsq) DESC, d.updated_at DESC
          LIMIT 40)
       SELECT c.id AS doc_id, (b.pos - 1)::int AS pos, b.block->>'id' AS block_id,
              b.block->>'text' AS text,
              ts_rank_cd(to_tsvector('english', b.block->>'text'), q.tsq)
                * (1 + 0.3 * exp(-(extract(epoch FROM now() - c.updated_at) / 2592000)))
                + greatest(similarity(b.block->>'text', ${q}) - 0.3, 0) AS rank
         FROM cand c CROSS JOIN q
         CROSS JOIN LATERAL jsonb_array_elements(c.content) WITH ORDINALITY AS b(block, pos)
        WHERE coalesce(b.block->>'text', '') <> ''
          AND (to_tsvector('english', b.block->>'text') @@ q.tsq
               OR similarity(b.block->>'text', ${q}) > 0.35)
        ORDER BY rank DESC LIMIT ${limit}`,
      params.values,
    );
    const docIds = [...new Set(found.rows.map((r) => r.doc_id))];
    const docs = new Map(
      (docIds.length
        ? (
            await ctx.db.query<{
              id: string;
              title: string;
              user_id: string;
              author_name: string | null;
              imported: boolean;
              editors: string[] | null;
              content: DocBlock[];
            }>(
              `SELECT d.id, d.title, d.user_id, u.name AS author_name,
                      d.imported_from IS NOT NULL AS imported, d.content,
                      ${docEditorsSql("d", "$2")} AS editors
                 FROM docs d JOIN users u ON u.id = d.user_id
                WHERE d.id = ANY ($1::uuid[])`,
              [docIds, ctx.principal.user.id],
            )
          ).rows
        : []
      ).map((d) => [d.id, d]),
    );
    type Found = z.output<typeof passage> & { rank: number };
    const out: Found[] = [];
    // Quotes and headings show only the links this caller may open (D3aF).
    const links = await linkPrivacy(
      ctx.db,
      ctx.spaces,
      found.rows.map((r) => r.text),
      [...docs.values()].map((d) => d.content),
    );
    for (const r of found.rows) {
      const d = docs.get(r.doc_id);
      if (!d) continue;
      const ref = { type: "doc" as const, id: d.id };
      const cited = r.block_id ? { ...ref, block: r.block_id } : ref;
      out.push({
        quote: clean(links.value(r.text), QUOTE_MAX),
        heading_path: headingPath(links.value(d.content), r.pos),
        block_id: r.block_id,
        citation_url: refs(cited).url,
        provenance: provenanceOf(ctx.principal.user.id, d),
        source: {
          id: refs(ref).id,
          type: "doc",
          title: cleanTitle(d.title) || "Untitled",
          url: refs(ref).url,
        },
        rank: Number(r.rank),
      });
    }

    // Task notes and decisions answer questions too, with less weight.
    if (!doc && !a.folder) {
      const p2 = new Params();
      const s2 = scopeFor(ctx.spaces, p2);
      const q2 = p2.add(a.query);
      const extra: string[] = [];
      if (project) extra.push(`x.project_id = ${p2.add(project)}`);
      if (team && "personal" in team) extra.push("x.team_id IS NULL");
      if (team && "team" in team)
        extra.push(`x.team_id = ${p2.add(team.team)}`);
      const and = extra.map((e) => ` AND ${e}`).join("");
      const more = await ctx.db.query<{
        type: "task" | "event" | "record";
        id: string;
        title: string;
        project_id: string | null;
        user_id: string;
        author_name: string | null;
        source: string | null;
        quote: string;
        rank: string;
      }>(
        `WITH q AS (SELECT websearch_to_tsquery('english', ${q2}) AS tsq)
         SELECT CASE WHEN x.kind = 'event' THEN 'event' ELSE 'task' END AS type,
                x.id, x.title, x.project_id, x.user_id,
                u.name AS author_name, ${itemSourceSql("x")} AS source,
                ts_headline('english', x.notes, q.tsq, 'MaxWords=60, MinWords=20, MaxFragments=1, StartSel="", StopSel=""') AS quote,
                0.6 * ts_rank_cd(to_tsvector('english', x.notes), q.tsq) AS rank
           FROM items x JOIN users u ON u.id = x.user_id CROSS JOIN q
          WHERE ${visibleItems("x", s2)} AND x.notes <> ''
            AND to_tsvector('english', x.notes) @@ q.tsq${and}
         UNION ALL
         SELECT 'record' AS type, x.id, x.title, x.project_id, x.created_by AS user_id,
                u.name AS author_name, NULL AS source,
                ts_headline('english', x.title || '. ' || x.details || ' ' || x.outcome, q.tsq, 'MaxWords=60, MinWords=20, MaxFragments=1, StartSel="", StopSel=""') AS quote,
                0.6 * ts_rank_cd(to_tsvector('english', x.title || ' ' || x.details || ' ' || x.outcome), q.tsq) AS rank
           FROM work_records x JOIN users u ON u.id = x.created_by CROSS JOIN q
          WHERE ${visibleRecords("x", s2)}
            AND to_tsvector('english', x.title || ' ' || x.details || ' ' || x.outcome) @@ q.tsq${and}
          ORDER BY rank DESC LIMIT 10`,
        p2.values,
      );
      for (const r of more.rows) {
        const ref = { type: r.type, id: r.id } as const;
        const at = refs(ref, r.project_id);
        const provenance = provenanceOf(ctx.principal.user.id, r);
        const quote = clean(r.quote, QUOTE_MAX);
        out.push({
          quote: provenance === "booking_guest" ? maskEmails(quote) : quote,
          heading_path: [],
          block_id: null,
          citation_url: at.url,
          provenance,
          source: {
            id: at.id,
            type: r.type,
            title:
              titleFor(
                r.title,
                provenance,
                ctx.principal.flags.hide_outside_content,
                r.type,
              ) || "Untitled",
            url: at.url,
          },
          rank: Number(r.rank),
        });
      }
    }

    // A connection that hides outside content gets no quotes from it.
    const passages = out
      .filter(
        (p) =>
          !(
            ctx.principal.flags.hide_outside_content && isOutside(p.provenance)
          ),
      )
      .sort((x, y) => y.rank - x.rank)
      .slice(0, a.limit)
      .map(({ rank: _rank, ...p }) => p);
    const markdown = passages.length
      ? passages
          .map((p, n) => {
            const where = [
              lineTitle(p.source.title, null, p.provenance, p.source.type),
              ...p.heading_path,
            ].join(" › ");
            const body =
              p.provenance === "you"
                ? `> ${p.quote.replace(/\n/g, "\n> ")}`
                : fence(p.quote, p.provenance as Provenance);
            return `${n + 1}. ${where} — ${p.citation_url}\n${body}`;
          })
          .join("\n\n")
      : "No passages match. Try other words, or search for the page first.";
    return {
      structured: { passages },
      markdown,
      targets: [...new Set(passages.map((p) => p.source.id))],
    };
  },
});
