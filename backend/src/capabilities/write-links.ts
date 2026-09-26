import { z } from "zod";
import {
  itemData,
  projectInput,
  type DocBlock,
  type ReviewChangeInput,
} from "@orbyn/core";
import {
  Params,
  scopeFor,
  visibleDocs,
  visibleProjects,
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
} from "./registry.js";
import type { UndoOp } from "./undo.js";
import { MAX_DOC_BYTES, withIds } from "./write-docs.js";
import { itemEntry, visibleItem } from "./write-tasks.js";
import {
  ADDS,
  MAX_BATCH,
  actorOf,
  clientRefInput,
  dbOf,
  destination,
  finishWrite,
  refuseSecrets,
  toReview,
  pendingText,
  isoTime,
  idField,
  emailField,
  writeOutput,
  type DoneEntry,
} from "./write.js";
import { parseDoc } from "@orbyn/core";

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
async function visibleDoc(ctx: CapabilityContext, input: string) {
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
    }>(
      `SELECT d.id, d.title, d.team_id, d.version, d.folder_id, d.project_id, d.content
         FROM docs d WHERE d.id = ${params.add(docId(input))}
          AND ${visibleDocs("d", scope)} FOR UPDATE`,
      params.values,
    )
  ).rows[0];
  if (!doc) throw notFound();
  return doc;
}

/** A project the connection can see. */
async function visibleProject(ctx: CapabilityContext, input: string) {
  const params = new Params();
  const scope = scopeFor(ctx.spaces, params);
  const row = (
    await ctx.db.query<{ id: string; name: string; team_id: string | null }>(
      `SELECT p.id, p.name, p.team_id FROM projects p
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
] as const;

export const link = defineCapability({
  name: "link",
  title: "Link or unlink",
  description:
    "Links or unlinks: depends_on (task waits on task), task_doc (task and its page line), task_project, doc_project, doc_folder. Unlinking removes no content; Undo takes it back.",
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
    if (a.kind === "doc_project" || a.kind === "doc_folder") {
      const doc = await visibleDoc(ctx, a.from);
      destination(ctx, doc.team_id, tier) === "review" && refuseSuggest();
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
    destination(ctx, row.team_id, tier) === "review" && refuseSuggest();
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

function refuseSuggest(): never {
  throw new CapabilityError(
    "FORBIDDEN",
    "This connection can only suggest changes there.",
    "Use propose_changes, or ask the person to make the change in Orbyn.",
  );
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
    const count = (a.stages ?? []).reduce(
      (n, s) => n + (s.tasks?.length ?? 0),
      0,
    );
    const where = destination(ctx, teamId, teamId ? "W2" : "W1");
    if (where === "review" || (teamId && count > MAX_BATCH))
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
      const content = withIds(parseDoc(a.page.markdown));
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

const PROPOSED = [
  "delete_task",
  "delete_doc",
  "delete_project",
  "remove_step",
  "restore_doc_version",
  "move_task",
  "change_task",
  "invite",
  "remove_session",
  "unlink",
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
  title: "Propose changes for review",
  description:
    'Files one proposal the person approves or declines in Orbyn\'s Review inbox, and changes nothing else. For what agents never do directly: deleting tasks, pages or projects, removing checklist steps or sessions, putting back an older version of a page, moving a task between Personal and a team, inviting people to an event, changes that notify teammates, and anything you are unsure about. Returns a review_url for the person; read the outcome later with fetch("proposal:<id>"). A proposal waits 72 hours.',
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
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
  access: "suggest",
  toolset: "core",
  mode: "propose",
  tier: "W3",
  async run(ctx, a) {
    refuseSecrets(a.summary);
    const db = dbOf(ctx);
    const changes: ReviewChangeInput[] = [];
    let lastTeam: string | null = null;
    const may = (teamId: string | null) => {
      destination(ctx, teamId, "W3");
      lastTeam = teamId;
    };
    for (const c of a.changes) {
      switch (c.type) {
        case "delete_task": {
          const row = await visibleItem(ctx, c.target);
          may(row.team_id);
          changes.push({
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
          may(row.team_id);
          const patch: Record<string, unknown> = {};
          let emails: string[] = [];
          if (c.type === "move_task") {
            const t = teamFilter(needs(c, "team"));
            patch.team_id = t && "team" in t ? t.team : null;
            if (patch.team_id) may(patch.team_id as string);
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
          changes.push({
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
          may(row.team_id);
          const step = (
            await db.query<{ title: string }>(
              "SELECT title FROM item_steps WHERE id = $1 AND item_id = $2",
              [needs(c, "step_id"), row.id],
            )
          ).rows[0];
          if (!step) throw notFound();
          changes.push({
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
          may(doc.team_id);
          changes.push(
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
        case "delete_project": {
          const project = await visibleProject(ctx, c.target);
          may(project.team_id);
          changes.push({
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
          changes.push({
            type: "session.remove",
            block_id: b.id,
            item_id: b.item_id,
            title: b.title,
            from_start_at: b.start_at.toISOString(),
            from_end_at: b.end_at.toISOString(),
          });
          break;
        }
        case "unlink": {
          const row = await visibleItem(ctx, c.target);
          may(row.team_id);
          const to =
            needs(c, "unlink") === "doc_task"
              ? (await visibleDoc(ctx, needs(c, "to"))).id
              : c.unlink === "project"
                ? (await visibleProject(ctx, needs(c, "to"))).id
                : (await visibleItem(ctx, needs(c, "to"))).id;
          changes.push({
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
    const pending = await toReview(ctx, a.summary, changes);
    const { targets, ...out } = pending;
    return {
      structured: {
        status: "pending_review" as const,
        done: [],
        pending: out,
        skipped: [],
      },
      markdown: pendingText("This proposal", out),
      targets,
      write: {
        outcome: "proposed" as const,
        proposal_id: pending.proposal_id,
        team_id: lastTeam,
      },
    };
  },
});
