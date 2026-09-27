import { z } from "zod";
import {
  itemData,
  projectInput,
  type DocBlock,
  type ReviewChangeInput,
} from "@orbyn/core";
import {
  Params,
  readableDocs,
  scopeFor,
  visibleDocs,
  visibleProjects,
  visibleTemplates,
} from "../lib/visibility.js";
import { createDoc, saveDoc } from "../modules/docs/service.js";
import { mutate } from "../modules/items/service.js";
import { createProject } from "../modules/projects/service.js";
import { mergedItem } from "../modules/proposals/service.js";
import { syncSavedPages } from "../modules/study/service.js";
import { cleanTitle } from "./format.js";
import { docId, projectId, teamFilter } from "./common.js";
import { parseRef, refUrl } from "./refs.js";
import {
  CapabilityError,
  defineCapability,
  type CapabilityContext,
  type Effect,
} from "./registry.js";
import type { UndoOp } from "./undo.js";
import { applyDirect } from "./direct.js";
import { MAX_DOC_BYTES, withIds } from "./write-docs.js";
import { readMarkdown } from "./doc-markdown.js";
import { itemEntry, visibleItem } from "./write-tasks.js";
import {
  ADDS,
  EDITS,
  actorOf,
  clientRefInput,
  dbOf,
  cantWait,
  destination,
  finishWrite,
  refuseSecrets,
  type Destination,
  type DestinationOptions,
  isoTime,
  idField,
  emailField,
  writeOutput,
  type DoneEntry,
} from "./write.js";
import { REVIEW_DELETABLE } from "@orbyn/core";
import { actionChange, quoted } from "./shared.js";

/**
 * Connecting things (link), starting projects (create_project) and filing
 * a proposal for anything risky (propose_changes).
 */

const notFound = () =>
  new CapabilityError(
    "NOT_FOUND",
    "Nothing with that id is reachable from this connection.",
    "Search for it and use an id from the results.",
  );

/** A page the connection can see, locked for a change. */
export async function visibleDoc(ctx: CapabilityContext, input: string) {
  const params = new Params();
  const scope = scopeFor(ctx.spaces, params);
  const doc = (
    await ctx.db.query<{
      id: string;
      title: string;
      team_id: string | null;
      version: number;
      folder_id: string | null;
      project_id: string | null;
      content: DocBlock[];
      user_id: string;
    }>(
      `SELECT d.id, d.title, d.team_id, d.version, d.folder_id, d.project_id, d.content,
              d.user_id
         FROM docs d WHERE d.id = ${params.add(docId(input))}
          AND ${visibleDocs("d", scope)} FOR UPDATE`,
      params.values,
    )
  ).rows[0];
  if (!doc) throw notFound();
  return doc;
}

/** A page in the Trash the connection could read (H6b: bringing it back). */
export async function trashedDoc(ctx: CapabilityContext, input: string) {
  const params = new Params();
  const scope = scopeFor(ctx.spaces, params);
  const doc = (
    await ctx.db.query<{
      id: string;
      title: string;
      team_id: string | null;
      user_id: string;
      deleted_by: string | null;
    }>(
      `SELECT d.id, d.title, d.team_id, d.user_id, d.deleted_by FROM docs d
        WHERE d.id = ${params.add(docId(input))} AND d.deleted_at IS NOT NULL
          AND ${readableDocs("d", scope)} FOR UPDATE`,
      params.values,
    )
  ).rows[0];
  if (!doc) throw notFound();
  return doc;
}

/** A project the connection can see. */
export async function visibleProject(ctx: CapabilityContext, input: string) {
  const params = new Params();
  const scope = scopeFor(ctx.spaces, params);
  const row = (
    await ctx.db.query<{
      id: string;
      name: string;
      team_id: string | null;
      user_id: string;
    }>(
      `SELECT p.id, p.name, p.team_id, p.user_id FROM projects p
        WHERE p.id = ${params.add(projectId(input))} AND ${visibleProjects("p", scope)}`,
      params.values,
    )
  ).rows[0];
  if (!row) throw notFound();
  return row;
}

const docEntry = (
  d: { id: string; title: string; version: number },
  change: string,
): DoneEntry => ({
  id: `doc:${d.id}`,
  title: cleanTitle(d.title) || "Untitled",
  url: refUrl({ type: "doc", id: d.id }),
  version: d.version,
  change,
});

// --- link --------------------------------------------------------------

const LINK_KINDS = [
  "depends_on",
  "task_doc",
  "task_project",
  "doc_project",
  "doc_folder",
  "related",
] as const;

export const link = defineCapability({
  name: "link",
  title: "Link or unlink",
  description:
    "Links or unlinks: depends_on (task waits on task), task_doc (task and its page line), task_project, doc_project, doc_folder, or related (a plain link between a page or task and a page, task or project, shown in backlinks on both sides). Unlinking removes no content; Undo takes it back.",
  input: z
    .object({
      action: z.enum(["link", "unlink"]),
      kind: z.enum(LINK_KINDS),
      from: z.string().trim().min(1).max(300),
      to: z
        .string()
        .trim()
        .min(1)
        .max(300)
        .describe("The task, page, project or folder id it links to."),
      stage_id: idField.optional(),
      block: z
        .string()
        .max(64)
        .optional()
        .describe("For task_doc: the page line's id (^b…)."),
      client_ref: clientRefInput,
    })
    .strict(),
  output: writeOutput,
  annotations: ADDS,
  access: "write",
  toolset: "core",
  mode: "write",
  tier: "W2",
  async run(ctx, a) {
    const db = dbOf(ctx);
    const actor = actorOf(ctx.principal);
    const on = a.action === "link";
    const undo: UndoOp[] = [];
    const done: DoneEntry[] = [];
    const tier = "W2" as const;
    if (a.kind === "related") return relatedLink(ctx, a.from, a.to, on);
    if (a.kind === "doc_project" || a.kind === "doc_folder") {
      const doc = await visibleDoc(ctx, a.from);
      destination(ctx, doc.team_id, tier) === "review" &&
        refuseSuggest(ctx, doc.team_id);
      let target: string | null = null;
      if (on && a.kind === "doc_project")
        target = (await visibleProject(ctx, a.to)).id;
      if (on && a.kind === "doc_folder") {
        const f = parseRef(a.to);
        target = f.type === "title" ? null : f.id;
        if (!target) throw notFound();
      }
      const field = a.kind === "doc_project" ? "project_id" : "folder_id";
      const saved = await saveDoc(db, actor, doc.id, {
        version: doc.version,
        [field]: target,
      });
      undo.push({
        op: "doc.file",
        doc_id: doc.id,
        version: saved.version,
        [field]: doc[field],
      });
      done.push(docEntry(saved, on ? "Filed" : "Taken out"));
      return finishWrite(ctx, "Linking", {
        done,
        undo,
        teamId: doc.team_id,
        after: [() => syncSavedPages(doc.id)],
      });
    }
    const row = await visibleItem(ctx, a.from);
    destination(ctx, row.team_id, tier) === "review" &&
      refuseSuggest(ctx, row.team_id);
    if (a.kind === "task_doc") {
      const doc = await visibleDoc(ctx, a.to);
      if (on) {
        const block = a.block?.replace(/^\^/, "");
        if (!block || !(doc.content ?? []).some((b) => b.id === block))
          throw new CapabilityError(
            "INVALID",
            "Name the page line (block) the task belongs to.",
            "Fetch the page and use a line's ^b… anchor.",
          );
        await db.query(
          `INSERT INTO doc_task_links (doc_id, block_id, item_id) VALUES ($1, $2, $3)
           ON CONFLICT (doc_id, block_id) DO NOTHING`,
          [doc.id, block, row.id],
        );
        undo.push({
          op: "link.set",
          kind: "doc_task",
          item_id: row.id,
          other_id: doc.id,
          block_id: block,
          present: false,
        });
      } else {
        const gone = (
          await db.query<{ block_id: string }>(
            "DELETE FROM doc_task_links WHERE doc_id = $1 AND item_id = $2 RETURNING block_id",
            [doc.id, row.id],
          )
        ).rows;
        for (const g of gone)
          undo.push({
            op: "link.set",
            kind: "doc_task",
            item_id: row.id,
            other_id: doc.id,
            block_id: g.block_id,
            present: true,
          });
      }
      done.push(
        itemEntry(row, on ? "Linked to a page line" : "Unlinked from the page"),
      );
      return finishWrite(ctx, "Linking", { done, undo, teamId: row.team_id });
    }
    // Fields of the task itself: its prerequisites, or its project.
    let patch: Record<string, unknown>;
    const before: Record<string, unknown> = {};
    if (a.kind === "depends_on") {
      const other = await visibleItem(ctx, a.to);
      const now = (
        await db.query<{ id: string }>(
          "SELECT prerequisite_id AS id FROM item_dependencies WHERE item_id = $1",
          [row.id],
        )
      ).rows.map((r) => r.id);
      before.prerequisite_ids = now;
      patch = {
        prerequisite_ids: on
          ? [...new Set([...now, other.id])]
          : now.filter((id) => id !== other.id),
      };
    } else {
      before.project_id = row.project_id ?? null;
      before.stage_id = row.stage_id ?? null;
      patch = on
        ? {
            project_id: (await visibleProject(ctx, a.to)).id,
            stage_id: a.stage_id ?? null,
          }
        : { project_id: null, stage_id: null };
    }
    const item = (await mutate(db, actor, {
      operation: "update",
      item_id: row.id,
      version: row.version,
      data: mergedItem(row as never, patch),
    }))!;
    undo.push({
      op: "item.restore",
      id: item.id,
      version: item.version,
      fields: before,
    });
    done.push(itemEntry(item, on ? "Linked" : "Unlinked"));
    return finishWrite(ctx, "Linking", { done, undo, teamId: row.team_id });
  },
});

/** One end of a related link, checked visible (and locked for a change). */
async function relatedEnd(ctx: CapabilityContext, input: string) {
  const ref = parseRef(input);
  if (ref.type === "doc") {
    const d = await visibleDoc(ctx, input);
    return {
      kind: "doc" as const,
      id: d.id,
      team_id: d.team_id,
      entry: docEntry(d, "Linked"),
    };
  }
  if (ref.type === "task" || ref.type === "event") {
    const t = await visibleItem(ctx, input);
    return {
      kind: "task" as const,
      id: t.id,
      team_id: t.team_id,
      entry: itemEntry(t, "Linked"),
    };
  }
  if (ref.type === "project") {
    const p = await visibleProject(ctx, input);
    return {
      kind: "project" as const,
      id: p.id,
      team_id: p.team_id,
      entry: {
        id: `project:${p.id}`,
        title: cleanTitle(p.name) || "Untitled",
        url: refUrl({ type: "project", id: p.id }),
        version: null,
        change: "Linked",
      } satisfies DoneEntry,
    };
  }
  throw new CapabilityError(
    "INVALID",
    "A related link joins pages, tasks and projects: use doc:<id>, task:<id> or project:<id>.",
  );
}

/**
 * A manual "related" link: kept in object_links (kind 'related'), which
 * page saves never touch, so it lasts until someone unlinks it. It starts
 * from a page or task (a project can only be the other end), and needs
 * write access in the space of the end it starts from.
 */
async function relatedLink(
  ctx: CapabilityContext,
  fromInput: string,
  toInput: string,
  on: boolean,
) {
  let from = await relatedEnd(ctx, fromInput);
  let to = await relatedEnd(ctx, toInput);
  if (from.kind === "project") [from, to] = [to, from];
  if (from.kind === "project")
    throw new CapabilityError(
      "INVALID",
      "Two projects can't be linked as related; link a page or task to a project instead.",
    );
  if (from.kind === to.kind && from.id === to.id)
    throw new CapabilityError("INVALID", "A thing can't be related to itself.");
  if (destination(ctx, from.team_id, "W2") === "review")
    refuseSuggest(ctx, from.team_id);
  const db = dbOf(ctx);
  const key = [from.kind, from.id, to.kind, to.id];
  // One related link per pair, whichever way round it was made.
  const existing = (
    await db.query<{
      source_kind: string;
      source_id: string;
      target_kind: string;
      target_id: string;
    }>(
      `SELECT source_kind, source_id::text, target_kind, target_id FROM object_links
        WHERE link_kind = 'related'
          AND ((source_kind = $1 AND source_id = $2 AND target_kind = $3 AND target_id = $4::text)
            OR (target_kind = $1 AND target_id = $2::text AND source_kind = $3 AND source_id::text = $4))`,
      key,
    )
  ).rows;
  // Removing needs write access where each stored link starts: a link made
  // the other way round starts at `to`, not at `from`.
  if (!on)
    for (const e of existing) {
      const start =
        e.source_kind === from.kind && e.source_id === from.id ? from : to;
      if (destination(ctx, start.team_id, "W2") === "review")
        refuseSuggest(ctx, start.team_id);
    }
  const undo: UndoOp[] = [];
  if (on && !existing.length) {
    await db.query(
      `INSERT INTO object_links (source_kind, source_id, target_kind, target_id, link_kind)
       VALUES ($1, $2, $3, $4, 'related') ON CONFLICT DO NOTHING`,
      key,
    );
    undo.push({
      op: "related.set",
      source_kind: from.kind,
      source_id: from.id,
      target_kind: to.kind,
      target_id: to.id,
      present: false,
    });
  }
  if (!on)
    for (const e of existing) {
      await db.query(
        `DELETE FROM object_links WHERE link_kind = 'related' AND source_kind = $1
            AND source_id = $2 AND target_kind = $3 AND target_id = $4`,
        [e.source_kind, e.source_id, e.target_kind, e.target_id],
      );
      undo.push({
        op: "related.set",
        source_kind: e.source_kind as "doc" | "task",
        source_id: e.source_id,
        target_kind: e.target_kind as "doc" | "task" | "project",
        target_id: e.target_id,
        present: true,
      });
    }
  const change = on ? "Linked as related" : "Unlinked";
  return finishWrite(ctx, "Linking", {
    done: [
      { ...from.entry, change },
      { ...to.entry, change },
    ],
    undo,
    teamId: from.team_id,
  });
}

function refuseSuggest(ctx: CapabilityContext, teamId: string | null): never {
  throw cantWait(ctx, teamId);
}

// --- create_project ----------------------------------------------------

export const createProjectCapability = defineCapability({
  name: "create_project",
  title: "Start a project",
  description:
    "Starts a personal or team project with stages, first tasks and an optional main page. A team project over 25 tasks, or where it may only suggest, goes to review. The deadline never sets task deadlines.",
  input: z
    .object({
      name: z.string().trim().min(1).max(120),
      team: z
        .string()
        .trim()
        .max(100)
        .optional()
        .describe('"personal" (the default), or a team id.'),
      summary: z.string().trim().max(2000).optional(),
      deadline: isoTime
        .optional()
        .describe("The latest date for its tasks (ISO 8601)."),
      stages: z
        .array(
          z
            .object({
              name: z.string().trim().min(1).max(60),
              tasks: z
                .array(z.string().trim().min(1).max(200))
                .max(50)
                .optional(),
            })
            .strict(),
        )
        .max(20)
        .optional(),
      page: z
        .object({
          title: z.string().trim().min(1).max(200).optional(),
          markdown: z.string().max(MAX_DOC_BYTES),
        })
        .strict()
        .optional(),
      template: z
        .string()
        .trim()
        .max(300)
        .optional()
        .describe("Start from a saved template (template:<id>)."),
      client_ref: clientRefInput,
    })
    .strict(),
  output: writeOutput,
  annotations: ADDS,
  access: "suggest",
  toolset: "core",
  mode: "write",
  tier: "W1",
  async run(ctx, a) {
    refuseSecrets(
      a.name,
      a.summary,
      a.page?.markdown,
      ...(a.stages ?? []).flatMap((s) => [s.name, ...(s.tasks ?? [])]),
    );
    const team = teamFilter(a.team);
    const teamId = team && "team" in team ? team.team : null;
    if (a.template) {
      // A template schedules its tasks, so starting from one is reviewed:
      // approving it starts the project the way the app does.
      const ref = parseRef(a.template);
      if (ref.type === "title")
        throw new CapabilityError("INVALID", "template must be template:<id>.");
      const params = new Params();
      const scope = scopeFor(ctx.spaces, params);
      const t = (
        await ctx.db.query<{ id: string; name: string; tasks: unknown[] }>(
          `SELECT t.id, t.name, t.tasks FROM project_templates t
            WHERE t.id = ${params.add(ref.id)} AND ${visibleTemplates("t", scope)}`,
          params.values,
        )
      ).rows[0];
      if (!t) throw notFound();
      const start = actionChange({
        action: "template.use",
        target_id: t.id,
        title: a.name,
        team_id: teamId,
        headline: `Start the project ${quoted(a.name)} from the template ${quoted(t.name)}`,
        rows: (t.tasks as { title?: string }[]).slice(0, 15).map((x) => ({
          label: "Task",
          before: null,
          after: String(x.title ?? ""),
        })),
        input: { id: t.id, title: a.name, team_id: teamId },
      });
      if (
        destination(ctx, teamId, "W3", [], { count: t.tasks.length }) ===
        "direct"
      ) {
        const made = await applyDirect(ctx, start);
        return finishWrite(ctx, "Starting a project", {
          done: [made.done],
          after: made.after,
          teamId,
        });
      }
      return finishWrite(ctx, "Starting a project", {
        done: [],
        review: [
          actionChange({
            action: "template.use",
            target_id: t.id,
            title: a.name,
            team_id: teamId,
            headline: `Start the project ${quoted(a.name)} from the template ${quoted(t.name)}`,
            rows: (t.tasks as { title?: string }[]).slice(0, 15).map((x) => ({
              label: "Task",
              before: null,
              after: String(x.title ?? ""),
            })),
            input: { id: t.id, title: a.name, team_id: teamId },
          }),
        ],
        teamId,
      });
    }
    const count = (a.stages ?? []).reduce(
      (n, s) => n + (s.tasks?.length ?? 0),
      0,
    );
    const where = destination(ctx, teamId, teamId ? "W2" : "W1", [], {
      count: count + 1,
    });
    if (where === "review")
      return finishWrite(ctx, "Starting a project", {
        done: [],
        review: [
          {
            type: "project.create",
            title: a.name,
            team_id: teamId,
            summary: a.summary ?? "",
            deadline: a.deadline ?? null,
            stages: (a.stages ?? []).map((s) => ({
              name: s.name,
              tasks: s.tasks ?? [],
            })),
          },
          ...(a.page
            ? [
                {
                  type: "doc.create" as const,
                  title: a.page.title ?? a.name,
                  team_id: teamId,
                  kind: "doc" as const,
                  markdown: a.page.markdown,
                  folder_id: null,
                  project_id: null,
                },
              ]
            : []),
        ],
        reviewSummary: `Start the project “${cleanTitle(a.name)}”`,
        teamId,
      });
    const db = dbOf(ctx);
    const actor = actorOf(ctx.principal);
    const project = await createProject(
      db,
      actor,
      projectInput.parse({
        name: a.name,
        team_id: teamId,
        summary: a.summary ?? "",
        deadline: a.deadline ?? null,
        ...(a.stages?.length ? { stages: a.stages.map((s) => s.name) } : {}),
      }),
    );
    const undo: UndoOp[] = [{ op: "project.delete", id: project.id }];
    const done: DoneEntry[] = [
      {
        id: `project:${project.id}`,
        title: cleanTitle(project.name),
        url: refUrl({ type: "project", id: project.id }),
        version: null,
        change: "Started",
      },
    ];
    const stages = (
      await db.query<{ id: string; position: number }>(
        "SELECT id, position FROM project_stages WHERE project_id = $1 ORDER BY position",
        [project.id],
      )
    ).rows;
    for (const [i, s] of (a.stages ?? []).entries())
      for (const title of s.tasks ?? []) {
        const item = (await mutate(db, actor, {
          operation: "create",
          data: itemData.parse({
            title,
            team_id: teamId,
            project_id: project.id,
            stage_id: stages[i]?.id ?? null,
          }),
        }))!;
        undo.push({ op: "item.delete", id: item.id, version: item.version });
        done.push(itemEntry(item, "Added"));
      }
    const after: (() => Promise<void>)[] = [];
    if (a.page) {
      const content = withIds(await readMarkdown(ctx, a.page.markdown, null));
      if (Buffer.byteLength(JSON.stringify(content)) > MAX_DOC_BYTES)
        throw new CapabilityError(
          "INVALID",
          "That page would be too long for the apps to save.",
          "Keep a page under about 60 KB.",
        );
      const doc = await createDoc(db, actor, {
        title: a.page.title ?? a.name,
        kind: "doc",
        team_id: teamId,
        item_id: null,
        content,
        folder_id: null,
        project_id: project.id,
        tags: [],
      });
      undo.push({ op: "doc.trash", doc_id: doc.id, version: doc.version });
      done.push(docEntry(doc, "Written"));
      after.push(() => syncSavedPages(doc.id));
    }
    return finishWrite(ctx, "Starting a project", {
      done,
      undo,
      after,
      teamId,
    });
  },
});

// --- propose_changes ---------------------------------------------------

const DELETABLE_TABLE: Record<
  (typeof REVIEW_DELETABLE)[number],
  { table: string; name: string; label: string; personalOnly?: boolean }
> = {
  list: { table: "lists", name: "name", label: "the list" },
  tag: { table: "tags", name: "name", label: "the tag" },
  folder: { table: "folders", name: "name", label: "the folder" },
  view: { table: "saved_views", name: "name", label: "the saved view" },
  template: {
    table: "project_templates",
    name: "name",
    label: "the project template",
  },
  page_template: {
    table: "page_templates",
    name: "name",
    label: "the page template",
  },
  frame: {
    table: "frames",
    name: "name",
    label: "the frame",
    personalOnly: true,
  },
  habit: {
    table: "habits",
    name: "name",
    label: "the habit",
    personalOnly: true,
  },
  place: {
    table: "places",
    name: "label",
    label: "the place",
    personalOnly: true,
  },
  comment: { table: "doc_comments", name: "body", label: "a comment" },
  proof: { table: "item_proofs", name: "note", label: "a proof" },
  project_link: {
    table: "project_links",
    name: "title",
    label: "a pinned link",
  },
  habit_session: {
    table: "habit_blocks",
    name: "to_char(start_at, 'YYYY-MM-DD HH24:MI')",
    label: "the habit session",
    personalOnly: true,
  },
  field: { table: "custom_fields", name: "name", label: "the field" },
  milestone: {
    table: "project_milestones",
    name: "name",
    label: "the milestone",
  },
};

/** A delete of something organising (a list, a routine, a comment …) for review. */
async function deletion(
  ctx: CapabilityContext,
  what: (typeof REVIEW_DELETABLE)[number],
  target: string,
  on: string | undefined,
): Promise<
  ReviewChangeInput & { team_id: string | null; owner: string | null }
> {
  // field:<id> and milestone:<id> as fetch and get_project name them.
  const ref = parseRef(target.replace(/^(field|milestone):/i, ""));
  if (ref.type === "title")
    throw new CapabilityError("INVALID", "Name what to delete by its id.");
  const t = DELETABLE_TABLE[what];
  let team: string | null = null;
  let parent: string | null = null;
  let title = "";
  let owner: string | null = null;
  if (
    what === "comment" ||
    what === "proof" ||
    what === "project_link" ||
    what === "milestone"
  ) {
    if (!on)
      throw new CapabilityError(
        "INVALID",
        `Deleting ${t.label} needs on: what it is on.`,
      );
    const holder =
      what === "comment"
        ? await visibleDoc(ctx, on)
        : what === "proof"
          ? await visibleItem(ctx, on)
          : await visibleProject(ctx, on);
    parent = holder.id;
    team = holder.team_id;
    const col =
      what === "comment"
        ? "doc_id"
        : what === "proof"
          ? "item_id"
          : "project_id";
    const ownerCol =
      what === "project_link"
        ? "NULL::uuid"
        : what === "milestone"
          ? "created_by"
          : "user_id";
    const row = (
      await ctx.db.query<{ title: string; owner: string | null }>(
        `SELECT coalesce(${t.name}, '') AS title,
                ${ownerCol} AS owner
           FROM ${t.table} WHERE id = $1 AND ${col} = $2`,
        [ref.id, parent],
      )
    ).rows[0];
    if (!row) throw notFound();
    title = row.title;
    owner = row.owner;
  } else {
    const row = (
      await ctx.db.query<{
        title: string;
        team_id: string | null;
        user_id: string;
      }>(
        `SELECT ${t.name} AS title, ${t.personalOnly ? "NULL::uuid" : "team_id"} AS team_id, user_id
           FROM ${t.table} WHERE id = $1`,
        [ref.id],
      )
    ).rows[0];
    if (!row) throw notFound();
    team = row.team_id;
    const reach = row.team_id
      ? ctx.principal.teams.some((x) => x.id === row.team_id)
      : ctx.principal.personal && row.user_id === ctx.principal.user.id;
    if (!reach) throw notFound();
    title = row.title;
    owner = row.user_id;
  }
  return {
    ...actionChange({
      action: "delete",
      target_id: ref.id,
      title: title.slice(0, 200) || t.label,
      team_id: team,
      headline: `Delete ${t.label} ${quoted(title.slice(0, 80))}`,
      input: { kind: what, id: ref.id, parent_id: parent },
    }),
    team_id: team,
    owner,
  };
}

const PROPOSED = [
  "delete_task",
  "delete_doc",
  "delete_project",
  "remove_step",
  "restore_doc_version",
  "restore_doc",
  "move_task",
  "change_task",
  "invite",
  "remove_session",
  "unlink",
  "delete",
  "review_doc",
] as const;

/** One proposed change: `type` says which fields it needs. */
const proposed = z
  .object({
    type: z.enum(PROPOSED),
    target: z
      .string()
      .trim()
      .min(1)
      .max(300)
      .describe("The task, event, page, project or session id."),
    version: z.number().int().positive().optional(),
    to_version: z.number().int().positive().optional(),
    step_id: idField.optional(),
    team: z.string().trim().max(100).optional(),
    emails: z.array(emailField).max(50).optional(),
    unlink: z.enum(["depends_on", "doc_task", "project"]).optional(),
    to: z.string().trim().max(300).optional(),
    title: z.string().trim().min(1).max(200).optional(),
    notes: z.string().max(10_000).optional(),
    due_at: isoTime.nullable().optional(),
    assignee_id: idField.nullable().optional(),
    status: z.enum(["todo", "in_progress", "blocked", "cancelled"]).optional(),
    what: z
      .enum(REVIEW_DELETABLE)
      .optional()
      .describe(
        "delete: what target is; on: a comment's page, a proof's task.",
      ),
    on: z.string().trim().max(300).optional(),
    verdict: z.enum(["still_true", "needs_update"]).optional(),
  })
  .strict();
type Proposed = z.output<typeof proposed>;

/** A field a proposed change of this type needs, or INVALID. */
function needs<K extends keyof Proposed>(
  c: Proposed,
  key: K,
): NonNullable<Proposed[K]> {
  const v = c[key];
  if (v === undefined || v === null)
    throw new CapabilityError(
      "INVALID",
      `A ${c.type} change needs ${String(key)}.`,
    );
  return v as NonNullable<Proposed[K]>;
}

export const proposeChanges = defineCapability({
  name: "propose_changes",
  title: "Delete, move and other bigger changes",
  description:
    "Deletes (delete_task, delete_doc, delete_project, delete with what), removes checklist steps or sessions, restores a page version or a page from Trash (restore_doc), moves a task between Personal and a team, invites people to an event, gives a page verdict (review_doc) or unlinks. At full power the person's own things change at once (undo for 30 days); a teammate's work, invites and over 50 changes ask first, in the chat or the Review inbox (a review_url; fetch(\"proposal:<id>\") for the outcome; 72 hours).",
  input: z
    .object({
      summary: z
        .string()
        .trim()
        .min(1)
        .max(300)
        .describe("One line for the person: what and why."),
      changes: z.array(proposed).min(1).max(50),
      client_ref: clientRefInput,
    })
    .strict(),
  output: writeOutput,
  annotations: EDITS,
  access: "suggest",
  toolset: "core",
  mode: "propose",
  tier: "W3",
  async run(ctx, a) {
    refuseSecrets(a.summary);
    const db = dbOf(ctx);
    // Each change goes where its space and the connection's trust say:
    // at full power the person's own things change at once (with undo),
    // and a teammate's work, invites or more than 50 at once ask first.
    const changes: {
      change: ReviewChangeInput;
      where: Destination;
    }[] = [];
    let lastTeam: string | null = null;
    let where = "review" as Destination;
    const may = (
      teamId: string | null,
      owner: DestinationOptions["owner"] = null,
      effects: Effect[] = [],
    ) => {
      where = destination(ctx, teamId, "W3", effects, {
        owner,
        count: a.changes.length,
      });
      lastTeam = teamId;
    };
    const push = (change: ReviewChangeInput) => changes.push({ change, where });
    for (const c of a.changes) {
      switch (c.type) {
        case "delete_task": {
          const row = await visibleItem(ctx, c.target);
          may(row.team_id, row);
          push({
            type: "task.delete",
            item_id: row.id,
            version: needs(c, "version"),
            title: row.title,
            team_id: row.team_id,
          });
          break;
        }
        case "change_task":
        case "move_task":
        case "invite": {
          const row = await visibleItem(ctx, c.target);
          may(row.team_id, row);
          const patch: Record<string, unknown> = {};
          let emails: string[] = [];
          if (c.type === "move_task") {
            const t = teamFilter(needs(c, "team"));
            patch.team_id = t && "team" in t ? t.team : null;
            if (patch.team_id) {
              const home = where;
              may(patch.team_id as string);
              // Both ends must allow it; the stricter one decides.
              if (home === "review") where = "review";
              lastTeam = row.team_id;
            }
          } else if (c.type === "invite") {
            if (row.kind !== "event")
              throw new CapabilityError("INVALID", "Only events have invites.");
            const now = (
              await db.query<{ email: string }>(
                "SELECT email FROM item_attendees WHERE item_id = $1",
                [row.id],
              )
            ).rows.map((r) => r.email);
            emails = needs(c, "emails").filter((e) => !now.includes(e));
            patch.attendees = [...now, ...emails].map((email) => ({ email }));
            if (emails.length) may(row.team_id, row, ["email_outside"]);
          } else {
            refuseSecrets(c.title, c.notes);
            for (const k of [
              "title",
              "notes",
              "due_at",
              "assignee_id",
              "status",
            ] as const)
              if (c[k] !== undefined) patch[k] = c[k];
            if (!Object.keys(patch).length)
              throw new CapabilityError(
                "INVALID",
                "A change_task change needs a field to change.",
              );
          }
          const before: Record<string, unknown> = {};
          for (const k of Object.keys(patch)) {
            const v = (row as unknown as Record<string, unknown>)[k];
            before[k] = v instanceof Date ? v.toISOString() : (v ?? null);
          }
          push({
            type: "task.update",
            item_id: row.id,
            version: needs(c, "version"),
            title: row.title,
            team_id: row.team_id,
            patch,
            before,
            emails,
          });
          break;
        }
        case "remove_step": {
          const row = await visibleItem(ctx, c.target);
          may(row.team_id, row);
          const step = (
            await db.query<{ title: string }>(
              "SELECT title FROM item_steps WHERE id = $1 AND item_id = $2",
              [needs(c, "step_id"), row.id],
            )
          ).rows[0];
          if (!step) throw notFound();
          push({
            type: "checklist.remove",
            item_id: row.id,
            step_id: needs(c, "step_id"),
            title: row.title,
            step: step.title,
            team_id: row.team_id,
          });
          break;
        }
        case "delete_doc":
        case "restore_doc_version": {
          const doc = await visibleDoc(ctx, c.target);
          may(doc.team_id, doc);
          push(
            c.type === "delete_doc"
              ? {
                  type: "doc.delete",
                  doc_id: doc.id,
                  version: needs(c, "version"),
                  title: doc.title,
                  team_id: doc.team_id,
                }
              : {
                  type: "doc.restore_version",
                  doc_id: doc.id,
                  version: needs(c, "version"),
                  to_version: needs(c, "to_version"),
                  title: doc.title,
                  team_id: doc.team_id,
                },
          );
          break;
        }
        case "restore_doc": {
          // A page from Trash (get_history of "trash" lists them). Whoever
          // put a teammate's page there decides with the person.
          const doc = await trashedDoc(ctx, c.target);
          may(doc.team_id, {
            user_id: doc.deleted_by ?? doc.user_id,
          });
          push(
            actionChange({
              action: "page.restore",
              target_id: doc.id,
              title: doc.title,
              team_id: doc.team_id,
              headline: `Bring ${quoted(doc.title)} back from Trash`,
              input: { id: doc.id },
            }),
          );
          break;
        }
        case "delete_project": {
          const project = await visibleProject(ctx, c.target);
          may(project.team_id, project);
          push({
            type: "project.delete",
            project_id: project.id,
            title: project.name,
            team_id: project.team_id,
          });
          break;
        }
        case "remove_session": {
          may(null);
          const b = (
            await db.query<{
              id: string;
              item_id: string;
              start_at: Date;
              end_at: Date;
              title: string;
            }>(
              `SELECT b.id, b.item_id, b.start_at, b.end_at, i.title
                 FROM time_blocks b JOIN items i ON i.id = b.item_id
                WHERE b.id = $1 AND b.user_id = $2`,
              [c.target, ctx.principal.user.id],
            )
          ).rows[0];
          if (!b) throw notFound();
          push({
            type: "session.remove",
            block_id: b.id,
            item_id: b.item_id,
            title: b.title,
            from_start_at: b.start_at.toISOString(),
            from_end_at: b.end_at.toISOString(),
          });
          break;
        }
        case "delete": {
          const { owner, ...change } = await deletion(
            ctx,
            needs(c, "what"),
            c.target,
            c.on,
          );
          may(change.team_id, { user_id: owner });
          push(change);
          break;
        }
        case "review_doc": {
          const doc = await visibleDoc(ctx, c.target);
          may(doc.team_id, doc);
          const verdict = needs(c, "verdict");
          push(
            actionChange({
              action: "doc.review",
              target_id: doc.id,
              title: doc.title,
              team_id: doc.team_id,
              headline:
                verdict === "still_true"
                  ? `Confirm ${quoted(doc.title)} is still true`
                  : `Mark ${quoted(doc.title)} as needing an update (a task for its author)`,
              rows: c.notes
                ? [{ label: "Note", before: null, after: c.notes }]
                : [],
              input: {
                id: doc.id,
                review:
                  verdict === "still_true"
                    ? { verdict }
                    : { verdict, note: (c.notes ?? "").slice(0, 1000) },
              },
            }),
          );
          break;
        }
        case "unlink": {
          const row = await visibleItem(ctx, c.target);
          may(row.team_id, row);
          const to =
            needs(c, "unlink") === "doc_task"
              ? (await visibleDoc(ctx, needs(c, "to"))).id
              : c.unlink === "project"
                ? (await visibleProject(ctx, needs(c, "to"))).id
                : (await visibleItem(ctx, needs(c, "to"))).id;
          push({
            type: "link.remove",
            kind: needs(c, "unlink"),
            from_id: row.id,
            to_id: to,
            title: row.title,
            team_id: row.team_id,
          });
          break;
        }
      }
    }
    const done: DoneEntry[] = [];
    const undo: UndoOp[] = [];
    const after: (() => Promise<void>)[] = [];
    for (const c of changes.filter((x) => x.where === "direct")) {
      const made = await applyDirect(ctx, c.change);
      done.push(made.done);
      undo.push(...made.undo);
      after.push(...made.after);
    }
    return finishWrite(ctx, a.summary, {
      done,
      review: changes.filter((x) => x.where === "review").map((x) => x.change),
      reviewSummary: a.summary,
      undo,
      after,
      teamId: lastTeam,
    });
  },
});
