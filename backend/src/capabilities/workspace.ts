import { z } from "zod";
import {
  milestoneInput,
  milestoneUpdate,
  FAVOURITE_KINDS,
  FIELD_TARGETS,
  FIELD_TYPES,
  TEAM_ROLES,
  parseDoc,
  serializeDoc,
  templateFromPage,
  type DocBlock,
} from "@orbyn/core";
import { pool } from "../db/pool.js";
import {
  Params,
  scopeFor,
  visibleOwned,
  visiblePageTemplates,
  visibleTemplates,
} from "../lib/visibility.js";
import {
  addProjectLink,
  requireProject,
  updateProject,
} from "../modules/projects/service.js";
import {
  addMilestone,
  changeMilestone,
  placeTasks,
} from "../modules/projects/milestones.js";
import { setAssistantOff } from "../modules/projects/assistant.js";
import {
  projectCheckpoints,
  projectSnapshot,
} from "../modules/projects/time-machine.js";
import {
  createFolder,
  createList,
  createTag,
  setFavourite,
  updateFolder,
  updateList,
  updateTag,
} from "../modules/organize/service.js";
import {
  addComment,
  addPageTagNames,
  decideSuggestion,
  docVersion,
  docVersions,
  listComments,
  listSuggestions,
  resolveComment,
  setPageTags,
} from "../modules/docs/comments.js";
import {
  makeLineTasks,
  requireDoc,
  pageTags,
} from "../modules/docs/service.js";
import {
  createTemplate,
  templateFromProject,
  updateTemplate,
} from "../modules/templates/service.js";
import {
  createPageTemplate,
  pageTemplateFromPage,
  updatePageTemplate,
} from "../modules/templates/pages.js";
import { announceTo } from "../modules/presence/live.js";
import { listProofs } from "../modules/followthrough/proof.js";
import { announceDocChange } from "../modules/docs/live.js";
import { READ, projectId, teamFilter } from "./common.js";
import {
  both,
  clean,
  cleanTitle,
  labelled,
  type Provenance,
} from "./format.js";
import { parseRef, refs } from "./refs.js";
import {
  CapabilityError,
  defineCapability,
  type CapabilityContext,
} from "./registry.js";
import {
  actionChange,
  entryOf,
  notReachable,
  quoted,
  seeDoc,
  seeItem,
  seeProject,
} from "./shared.js";
import type { UndoOp } from "./undo.js";
import { afterSave } from "./write-docs.js";
import {
  ADDS,
  EDITS,
  MAX_BATCH,
  actorOf,
  clientRefInput,
  dbOf,
  cantWait,
  destination,
  emailField,
  finishWrite,
  idField,
  isoTime,
  refuseSecrets,
  writeOutput,
  type DoneEntry,
} from "./write.js";
import { applyDirect } from "./direct.js";
import { historyList, isHistoryList } from "./history-lists.js";
import {
  ORGANIZE_MORE,
  organizeMore,
  type MoreChange,
  type MoreState,
} from "./organize-more.js";
import type { ReviewChangeInput } from "@orbyn/core";

/**
 * The workspace toolset: deeper project, page and organising work. Project
 * changes that keep every stage they aren't told about, history (a
 * project's timeline and snapshots, a page's versions, comments and
 * suggestions, a task's progress), templates, lists, tags, folders and
 * stars, comments (mentions only where the connection may notify
 * teammates), taking or leaving suggestions (team pages go to review) and
 * turning a page's checklist into tasks.
 */

// --- update_project -----------------------------------------------------

export const updateProjectCapability = defineCapability({
  name: "update_project",
  title: "Change a project",
  description:
    "Changes a project's name, summary, status (active, done, archived), deadline or main page; adds, renames or reorders stages (stages it isn't told about are kept); pins or unpins web links on its Home; adds, changes, fills or removes milestones; keeps it out of AI (assistant off: it leaves this connection's sight) or asks the person to let it back in (on). Removing stages, milestones or unpinning is a delete (undo 30 days; asked first where needed).",
  input: z
    .object({
      project: z.string().trim().min(1).max(300),
      name: z.string().trim().min(1).max(120).optional(),
      summary: z.string().trim().max(2000).optional(),
      status: z.enum(["active", "done", "archived"]).optional(),
      deadline: isoTime.nullable().optional(),
      main_page: z
        .string()
        .trim()
        .max(300)
        .nullable()
        .optional()
        .describe("doc:<id>, or null for none."),
      stages: z
        .array(
          z
            .object({
              id: idField.optional(),
              name: z.string().trim().min(1).max(60),
            })
            .strict(),
        )
        .max(20)
        .optional()
        .describe("Rename (with id), add (without) or reorder (all ids)."),
      remove_stages: z.array(idField).max(20).optional(),
      pin: z
        .array(
          z
            .object({
              url: z.string().trim().max(2000),
              title: z.string().trim().max(120).default(""),
            })
            .strict(),
        )
        .max(10)
        .optional(),
      unpin: z.array(idField).max(20).optional(),
      milestones: z
        .array(
          z
            .object({
              id: idField.optional(),
              name: z.string().trim().min(1).max(120).optional(),
              due_on: z.string().max(10).optional(),
              done: z.boolean().optional(),
              tasks: z.array(z.string().trim().max(300)).max(50).optional(),
              remove: z.boolean().optional(),
            })
            .strict(),
        )
        .max(20)
        .optional()
        .describe(
          "No id: add (name, due_on YYYY-MM-DD). id: change or remove. tasks: the project's tasks to put in it.",
        ),
      assistant: z.enum(["off", "on"]).optional(),
      client_ref: clientRefInput,
    })
    .strict(),
  output: writeOutput,
  annotations: EDITS,
  access: "write",
  toolset: "workspace",
  mode: "write",
  tier: "W2",
  async run(ctx, a) {
    refuseSecrets(a.name, a.summary);
    for (const m of a.milestones ?? []) refuseSecrets(m.name);
    if (a.assistant === "on") {
      const { project: _p, assistant: _a, client_ref: _c, ...rest } = a;
      if (Object.values(rest).some((v) => v !== undefined))
        throw new CapabilityError(
          "INVALID",
          'assistant: "on" goes on its own.',
          "Ask for it alone; once the person lets the project back in, change the rest.",
        );
      return letBackIn(ctx, a.project);
    }
    const db = dbOf(ctx);
    const actor = actorOf(ctx.principal);
    const seen = await seeProject(ctx, a.project);
    const where = destination(ctx, seen.team_id, "W2", [], { owner: seen });
    const project = await requireProject(db, seen.id, actor, "items:write");
    const current = (
      await db.query<{
        name: string;
        summary: string;
        status: string;
        deadline: Date | null;
        doc_id: string | null;
      }>(
        "SELECT name, summary, status, deadline, doc_id FROM projects WHERE id = $1",
        [project.id],
      )
    ).rows[0];
    const stages = (
      await db.query<{ id: string; name: string }>(
        "SELECT id, name FROM project_stages WHERE project_id = $1 ORDER BY position",
        [project.id],
      )
    ).rows;
    const known = new Set(stages.map((s) => s.id));
    for (const s of [
      ...(a.stages ?? []),
      ...(a.remove_stages ?? []).map((id) => ({ id })),
    ])
      if (s.id && !known.has(s.id))
        throw new CapabilityError(
          "INVALID",
          "That stage isn't in this project.",
          "get_project lists the project's stages with their ids.",
        );
    let docTarget: string | null | undefined;
    if (a.main_page !== undefined)
      docTarget =
        a.main_page === null ? null : (await seeDoc(ctx, a.main_page)).id;

    // The stages after the change: every current one kept (renamed where
    // asked), in the order asked when every id is named, new ones after.
    let nextStages: { id?: string; name: string }[] | undefined;
    if (a.stages) {
      const renamed = new Map(
        a.stages.filter((s) => s.id).map((s) => [s.id!, s.name]),
      );
      const allNamed = stages.every((s) => renamed.has(s.id));
      const kept = allNamed
        ? a.stages.filter((s) => s.id).map((s) => ({ id: s.id!, name: s.name }))
        : stages.map((s) => ({ id: s.id, name: renamed.get(s.id) ?? s.name }));
      nextStages = [...kept, ...a.stages.filter((s) => !s.id)];
    }
    const patch: Record<string, unknown> = {};
    if (a.name !== undefined) patch.name = a.name;
    if (a.summary !== undefined) patch.summary = a.summary;
    if (a.status !== undefined) patch.status = a.status;
    if (a.deadline !== undefined) patch.deadline = a.deadline;
    if (docTarget !== undefined) patch.doc_id = docTarget;
    if (nextStages) patch.stages = nextStages;

    const done: DoneEntry[] = [];
    const review: ReviewChangeInput[] = [];
    const undo: UndoOp[] = [];
    const title = current.name;
    if (where === "review") {
      if (Object.keys(patch).length || a.pin?.length)
        throw cantWait(ctx, seen.team_id);
    } else {
      if (Object.keys(patch).length) {
        const saved = await updateProject(
          db,
          actor,
          project.id,
          patch as never,
        );
        const after = (
          await db.query<{ updated_at: Date }>(
            "SELECT updated_at FROM projects WHERE id = $1",
            [project.id],
          )
        ).rows[0];
        undo.push({
          op: "project.restore",
          id: project.id,
          updated_at: after.updated_at.toISOString(),
          fields: {
            name: current.name,
            summary: current.summary,
            status: current.status,
            deadline: current.deadline?.toISOString() ?? null,
            doc_id: current.doc_id,
          },
          stages: nextStages ? stages : null,
        });
        done.push(entryOf("project", project.id, saved.name, null, "Changed"));
      }
      for (const pin of a.pin ?? []) {
        refuseSecrets(pin.url, pin.title);
        await addProjectLink(db, actor, project.id, pin);
      }
      if (a.pin?.length && !done.length)
        done.push(entryOf("project", project.id, title, null, "Pinned links"));
    }
    // Milestones (H6b): added, changed and filled in like the rest;
    // removing one is a delete, made below with removing stages.
    for (const m of a.milestones ?? []) {
      const row = m.id
        ? (
            await db.query<{ name: string }>(
              "SELECT name FROM project_milestones WHERE id = $1 AND project_id = $2",
              [m.id, project.id],
            )
          ).rows[0]
        : null;
      if (m.id && !row)
        throw new CapabilityError(
          "INVALID",
          "That milestone isn't in this project.",
          "get_project lists the project's milestones with their ids.",
        );
      if (m.remove) {
        if (!row)
          throw new CapabilityError(
            "INVALID",
            "Removing needs the milestone's id.",
          );
        review.push(
          actionChange({
            action: "delete",
            target_id: m.id!,
            title,
            team_id: seen.team_id,
            headline: `Remove the milestone ${quoted(row.name)} from ${quoted(title)} (its tasks stay)`,
            rows: [{ label: "Milestone", before: row.name, after: null }],
            input: { kind: "milestone", id: m.id!, parent_id: project.id },
          }),
        );
        continue;
      }
      if (where === "review") throw cantWait(ctx, seen.team_id);
      const tasks = [];
      for (const t of m.tasks ?? []) tasks.push((await seeItem(ctx, t)).id);
      const moves = (
        await db.query<{ id: string; from: string | null }>(
          `SELECT id, milestone_id AS "from" FROM items WHERE id = ANY ($1::uuid[])`,
          [tasks],
        )
      ).rows;
      let id = m.id;
      if (!id) {
        const d = milestoneInput.safeParse({
          name: m.name,
          due_on: m.due_on,
          item_ids: tasks,
        });
        if (!d.success)
          throw new CapabilityError(
            "INVALID",
            "A new milestone needs a name and due_on (YYYY-MM-DD).",
          );
        id = await addMilestone(db, actor, project.id, d.data);
        undo.push({ op: "milestone.delete", id, project_id: project.id });
        done.push(
          entryOf(
            "project",
            project.id,
            title,
            null,
            `Added the milestone ${quoted(d.data.name)}`,
          ),
        );
      } else {
        const d = milestoneUpdate.safeParse({
          name: m.name,
          due_on: m.due_on,
          done: m.done,
        });
        if (!d.success)
          throw new CapabilityError("INVALID", "due_on is a day: YYYY-MM-DD.");
        if (Object.values(d.data).some((v) => v !== undefined)) {
          const was = await changeMilestone(db, actor, project.id, id, d.data);
          undo.push({
            op: "milestone.restore",
            id,
            project_id: project.id,
            fields: was,
          });
        }
        if (tasks.length)
          await placeTasks(db, actor, project.id, seen.team_id, tasks, id);
        done.push(
          entryOf(
            "project",
            project.id,
            title,
            null,
            `Changed the milestone ${quoted(m.name ?? row!.name)}`,
          ),
        );
      }
      if (moves.length) undo.push({ op: "milestone.tasks", moves });
    }
    // Keeping it out of AI (H6b): the agent may; it can't let it back in.
    if (a.assistant === "off") {
      if (where === "review")
        review.push(
          actionChange({
            action: "project.assistant",
            target_id: project.id,
            title,
            team_id: seen.team_id,
            headline: `Keep ${quoted(title)} out of AI and agents`,
            input: { id: project.id, off: true },
          }),
        );
      else {
        await setAssistantOff(db, actor, project.id, true);
        done.push(
          entryOf(
            "project",
            project.id,
            title,
            null,
            "Kept out of AI: this connection can't see it now, and only the person can let it back in (not undoable here)",
          ),
        );
      }
    }
    // Removing stages (and unpinning) waits for the person.
    if (a.remove_stages?.length) {
      const drop = new Set(a.remove_stages);
      const base =
        nextStages ?? stages.map((s) => ({ id: s.id, name: s.name }));
      const updated = (
        await db.query<{ updated_at: Date }>(
          "SELECT updated_at FROM projects WHERE id = $1",
          [project.id],
        )
      ).rows[0];
      review.push(
        actionChange({
          action: "project.update",
          target_id: project.id,
          title,
          team_id: seen.team_id,
          headline: `Remove ${drop.size} stage${drop.size === 1 ? "" : "s"} from ${quoted(title)} (their tasks stay, with no stage)`,
          rows: stages
            .filter((s) => drop.has(s.id))
            .map((s) => ({ label: "Stage", before: s.name, after: null })),
          input: {
            id: project.id,
            patch: { stages: base.filter((s) => !s.id || !drop.has(s.id)) },
          },
          version: Math.floor(updated.updated_at.getTime() / 1000),
        }),
      );
    }
    for (const linkId of a.unpin ?? []) {
      const link = (
        await db.query<{ url: string; title: string }>(
          "SELECT url, title FROM project_links WHERE id = $1 AND project_id = $2",
          [linkId, project.id],
        )
      ).rows[0];
      if (!link) throw notReachable();
      review.push(
        actionChange({
          action: "delete",
          target_id: linkId,
          title,
          team_id: seen.team_id,
          headline: `Unpin a link from ${quoted(title)}`,
          rows: [
            { label: "Link", before: link.title || link.url, after: null },
          ],
          input: { kind: "project_link", id: linkId, parent_id: project.id },
        }),
      );
    }
    // Removing stages and unpinning: made at once at full power (with
    // undo), otherwise they wait for the person.
    const after: (() => Promise<void>)[] = [];
    if (
      review.length &&
      destination(ctx, seen.team_id, "W3", [], { owner: seen }) === "direct"
    ) {
      for (const change of review.splice(0)) {
        const made = await applyDirect(ctx, change);
        done.push(made.done);
        undo.push(...made.undo);
        after.push(...made.after);
      }
    }
    if (!done.length && !review.length)
      throw new CapabilityError("INVALID", "Nothing to change.");
    return finishWrite(ctx, "Changing a project", {
      done,
      after,
      review,
      reviewSummary: `Changes to the project ${quoted(title)}`,
      undo,
      teamId: seen.team_id,
    });
  },
});

/**
 * Letting a kept-out project back into AI and agents (H6b): always the
 * person's call, whatever the connection's trust. Asked in the chat when
 * the app can (made once they say yes), otherwise a Review inbox proposal
 * whose summary doesn't name it (the agent can't see the project).
 */
async function letBackIn(ctx: CapabilityContext, input: string) {
  const params = new Params();
  const scope = { ...scopeFor(ctx.spaces, params), ai: false };
  const row = (
    await ctx.db.query<{
      id: string;
      name: string;
      team_id: string | null;
      assistant_off: boolean;
    }>(
      `SELECT p.id, p.name, p.team_id, p.assistant_off FROM projects p
        WHERE p.id = ${params.add(projectId(input))}
          AND ${visibleOwned("p", "user_id", scope)}`,
      params.values,
    )
  ).rows[0];
  if (!row) throw notReachable();
  if (!row.assistant_off)
    throw new CapabilityError("INVALID", "That project isn't kept out of AI.");
  // Reaching the space at all (read-only connections are refused).
  destination(ctx, row.team_id, "W2");
  const asking = ctx.asking;
  if (asking) {
    if (asking.mode === "collect")
      asking.reasons.push({
        kind: "keep_out",
        text: "it lets a project kept out of AI back in",
      });
    await setAssistantOff(dbOf(ctx), actorOf(ctx.principal), row.id, false);
    return finishWrite(ctx, "Changing a project", {
      done: [entryOf("project", row.id, row.name, null, "Back in AI")],
      teamId: row.team_id,
    });
  }
  return finishWrite(ctx, "Changing a project", {
    done: [],
    review: [
      actionChange({
        action: "project.assistant",
        target_id: row.id,
        title: row.name,
        team_id: row.team_id,
        headline: `Let ${quoted(row.name)} back into AI and agents`,
        input: { id: row.id, off: false },
      }),
    ],
    reviewSummary: "Let a project kept out of AI back in",
    teamId: row.team_id,
  });
}

// --- get_history --------------------------------------------------------

const historyEntry = z.object({
  at: z.string(),
  what: z.string(),
  by: z.string().nullable(),
  via_agent: z.string().nullable(),
  ref: z
    .string()
    .nullable()
    .describe("A version number, or a history point for at."),
});

export const getHistory = defineCapability({
  name: "get_history",
  title: "Show history",
  description:
    "What changed and when, with who (and via which agent): a project's timeline (at: a point's snapshot of stages and tasks), a page's versions (version: that version's Markdown), open comments and suggestions, or a task's progress notes. Also lists: \"recent\" (opened and changed lately), \"trash\" (pages in Trash), \"changes\" or team:<id> (a team's recent changes).",
  input: z
    .object({
      of: z
        .string()
        .trim()
        .min(1)
        .max(300)
        .describe(
          'project:, doc:, task:, "recent", "trash", "changes" or team:<id>.',
        ),
      version: z
        .number()
        .int()
        .min(1)
        .optional()
        .describe("Pages: one version's content."),
      at: z
        .string()
        .regex(/^[1-9]\d{0,18}$/)
        .optional()
        .describe("Projects: the ref of a history point."),
      limit: z.number().int().min(1).max(100).default(30),
    })
    .strict(),
  output: z.object({
    of: z.object({ id: z.string(), title: z.string(), url: z.string() }),
    entries: z.array(historyEntry),
    comments: z.array(
      z.object({
        id: z.string(),
        body: z.string(),
        by: z.string(),
        line: z.string().nullable(),
        resolved: z.boolean(),
        at: z.string(),
      }),
    ),
    suggestions: z.array(
      z.object({
        id: z.string(),
        by: z.string(),
        line: z.string(),
        status: z.string(),
      }),
    ),
    content: z
      .string()
      .nullable()
      .describe("The version's Markdown, or the snapshot, when asked for."),
  }),
  annotations: READ,
  access: "read",
  toolset: "workspace",
  mode: "read",
  tier: "R",
  async run(ctx, a) {
    if (isHistoryList(a.of)) return historyList(ctx, a.of, a.limit);
    const ref = parseRef(a.of);
    const actor = actorOf(ctx.principal);
    const tz = ctx.timezone;
    const at = (d: Date | string) =>
      both(d, tz)?.local ?? new Date(d).toISOString();
    if (ref.type === "project") {
      const p = await seeProject(ctx, a.of);
      const rows = (
        await ctx.db.query<{
          created_at: Date;
          summary: string;
          actor: string | null;
          via: string | null;
          event_order: string;
          entity_type: string;
        }>(
          `SELECT a.created_at, a.summary, u.name AS actor, a.event_order::text,
                  a.entity_type,
                  CASE WHEN g.id IS NOT NULL THEN coalesce(nullif(g.client_name, ''), nullif(g.name, ''), 'an agent') END AS via
             FROM project_activity a
             LEFT JOIN users u ON u.id = a.actor_id
             LEFT JOIN agent_grants g ON g.id = a.via_grant_id
            WHERE a.project_id = $1
            ORDER BY a.event_order DESC LIMIT $2`,
          [p.id, a.limit],
        )
      ).rows;
      // Only history points this principal may see (the time machine's rule).
      const points = new Set(
        (await projectCheckpoints(ctx.db, actor, p.id, null, 200)).map((c) =>
          String(c.event_order),
        ),
      );
      let content: string | null = null;
      if (a.at) {
        const snap = await projectSnapshot(ctx.db, actor, p.id, a.at);
        content = JSON.stringify(snap).slice(0, 20_000);
      }
      const r = refs({ type: "project", id: p.id });
      const entries = rows
        .filter(
          (row) => row.entity_type !== "note" || points.has(row.event_order),
        )
        .map((row) => ({
          at: row.created_at.toISOString(),
          what: cleanTitle(row.summary),
          by: row.actor ? cleanTitle(row.actor) : null,
          via_agent: row.via ? cleanTitle(row.via) : null,
          ref: points.has(row.event_order) ? row.event_order : null,
        }));
      return {
        structured: {
          of: { id: r.id, title: cleanTitle(p.name), url: r.url },
          entries,
          comments: [],
          suggestions: [],
          content,
        },
        markdown: [
          `History of ${cleanTitle(p.name)}:`,
          ...entries.map(
            (e) =>
              `- ${at(e.at)} ${e.what}${e.by ? ` (${e.by}${e.via_agent ? ` via ${e.via_agent}` : ""})` : ""}${e.ref ? ` · at ${e.ref}` : ""}`,
          ),
          ...(content ? ["", "Snapshot:", content] : []),
        ].join("\n"),
        targets: [r.id],
      };
    }
    if (ref.type === "doc" || ref.type === "any") {
      const d = await seeDoc(ctx, a.of);
      const r = refs({ type: "doc", id: d.id });
      const versions = await docVersions(
        ctx.db,
        ctx.principal.user.id,
        d.id,
        a.limit,
      );
      const comments = (await listComments(ctx.db, ctx.principal.user.id, d.id))
        .filter((c) => !c.resolved_at)
        .slice(-50);
      const suggestions = (
        await listSuggestions(ctx.db, ctx.principal.user.id, d.id)
      ).filter((s) => s.status === "open");
      let content: string | null = null;
      if (a.version) {
        const v = await docVersion(
          ctx.db,
          ctx.principal.user.id,
          d.id,
          a.version,
        );
        const provenance: Provenance =
          v.user_id === ctx.principal.user.id
            ? "you"
            : `teammate:${cleanTitle(v.author ?? "someone")}`;
        content = labelled(
          serializeDoc((v.content ?? []) as DocBlock[]),
          d.imported ? "import" : provenance,
          ctx.principal.flags.hide_outside_content,
        );
      }
      const by = (id: string | null, name: string | null) =>
        id === ctx.principal.user.id ? "you" : cleanTitle(name ?? "someone");
      const structured = {
        of: { id: r.id, title: cleanTitle(d.title) || "Untitled", url: r.url },
        entries: versions.map((v) => ({
          at: new Date(v.created_at).toISOString(),
          what: `Version ${v.version}`,
          by: by(v.user_id, v.author),
          via_agent: v.via_agent ? cleanTitle(v.via_agent) : null,
          ref: String(v.version),
        })),
        comments: comments.map((c) => ({
          id: c.id,
          body: labelled(
            c.body,
            c.user_id === ctx.principal.user.id
              ? "you"
              : `teammate:${cleanTitle(c.author ?? "someone")}`,
          ).slice(0, 2000),
          by: by(c.user_id, c.author),
          line: c.block_id ?? null,
          resolved: !!c.resolved_at,
          at: new Date(c.created_at).toISOString(),
        })),
        suggestions: suggestions.map((s) => ({
          id: s.id,
          by: by(s.user_id, s.author ?? null),
          line: s.block_id,
          status: s.status,
        })),
        content,
      };
      return {
        structured,
        markdown: [
          `History of ${structured.of.title}:`,
          ...structured.entries.map(
            (e) =>
              `- ${at(e.at)} version ${e.ref} by ${e.by}${e.via_agent ? ` via ${e.via_agent}` : ""}`,
          ),
          ...(structured.comments.length
            ? [
                "",
                "Open comments:",
                ...structured.comments.map(
                  (c) =>
                    `- ${c.by}${c.line ? ` on ${c.line}` : ""}: ${c.body} (${c.id})`,
                ),
              ]
            : []),
          ...(structured.suggestions.length
            ? [
                "",
                "Open suggestions:",
                ...structured.suggestions.map(
                  (s) => `- ${s.by} on ${s.line} (${s.id})`,
                ),
              ]
            : []),
          ...(content ? ["", `Version ${a.version}:`, content] : []),
        ].join("\n"),
        targets: [r.id],
      };
    }
    if (ref.type === "task" || ref.type === "event") {
      const item = await seeItem(ctx, a.of);
      const r = refs({
        type: item.kind === "event" ? "event" : "task",
        id: item.id,
      });
      const rows = (
        await ctx.db.query<{
          created_at: Date;
          body: string;
          status: string | null;
          progress: number | null;
          user_id: string | null;
          name: string | null;
        }>(
          `SELECT x.created_at, x.body, x.status, x.progress, x.user_id, u.name
             FROM item_updates x LEFT JOIN users u ON u.id = x.user_id
            WHERE x.item_id = $1 ORDER BY x.created_at DESC LIMIT $2`,
          [item.id, a.limit],
        )
      ).rows;
      const entries = rows.map((x) => ({
        at: x.created_at.toISOString(),
        what: [
          x.status ? `status ${x.status}` : "",
          x.progress !== null ? `${x.progress}%` : "",
          x.body
            ? x.user_id === ctx.principal.user.id
              ? clean(x.body, 1000)
              : labelled(
                  x.body,
                  `teammate:${cleanTitle(x.name ?? "someone")}`,
                ).slice(0, 1200)
            : "",
        ]
          .filter(Boolean)
          .join(" · "),
        by:
          x.user_id === ctx.principal.user.id
            ? "you"
            : cleanTitle(x.name ?? "someone"),
        via_agent: null as string | null,
        ref: null as string | null,
      }));
      const proofs = await listProofs(ctx.db, item.id);
      for (const f of proofs)
        entries.push({
          at: f.created_at,
          what: `Proof: ${f.url ? `${f.url} ` : ""}${labelled(f.note, f.user_id === ctx.principal.user.id ? "you" : `teammate:${cleanTitle(f.user_name || "someone")}`).slice(0, 600)}`,
          by:
            f.user_id === ctx.principal.user.id
              ? "you"
              : cleanTitle(f.user_name || "someone"),
          via_agent: null,
          ref: f.id,
        });
      entries.sort((x, y) => y.at.localeCompare(x.at));
      return {
        structured: {
          of: {
            id: r.id,
            title: cleanTitle(item.title) || "Untitled",
            url: r.url,
          },
          entries,
          comments: [],
          suggestions: [],
          content: null,
        },
        markdown: [
          `Progress on ${cleanTitle(item.title)}:`,
          ...entries.map((e) => `- ${at(e.at)} ${e.by}: ${e.what}`),
        ].join("\n"),
        targets: [r.id],
      };
    }
    throw new CapabilityError(
      "INVALID",
      "History is kept for projects, pages and tasks.",
    );
  },
});

// --- save_template ------------------------------------------------------

export const saveTemplate = defineCapability({
  name: "save_template",
  title: "Save a template",
  description:
    'Saves a project template (kind "project": from_project, or tasks with estimates and days from the start, and an optional repeat rule such as FREQ=WEEKLY;BYDAY=MO) or a page template (kind "page": from_page, or Markdown). template changes a saved one. A team\'s project templates need its owners or admins.',
  input: z
    .object({
      kind: z.enum(["project", "page"]),
      template: z
        .string()
        .trim()
        .max(300)
        .optional()
        .describe(
          "A saved template to change: template:<id> or page_template:<id>.",
        ),
      from_project: z.string().trim().max(300).optional(),
      from_page: z.string().trim().max(300).optional(),
      name: z.string().trim().min(1).max(120).optional(),
      description: z.string().trim().max(500).optional(),
      space: z
        .string()
        .trim()
        .max(100)
        .optional()
        .describe('"personal" or a team id.'),
      tasks: z
        .array(
          z
            .object({
              title: z.string().trim().min(1).max(200),
              estimate_minutes: z.number().int().min(5).max(10080).default(30),
              due_in_days: z.number().int().min(0).max(365).default(0),
            })
            .strict(),
        )
        .max(15)
        .optional(),
      repeat: z.string().trim().max(200).nullable().optional(),
      markdown: z
        .string()
        .max(60_000)
        .optional()
        .describe("A page template's lines."),
      client_ref: clientRefInput,
    })
    .strict(),
  output: writeOutput,
  annotations: ADDS,
  access: "write",
  toolset: "workspace",
  mode: "write",
  tier: "W2",
  async run(ctx, a) {
    refuseSecrets(a.name, a.description, a.markdown);
    const db = dbOf(ctx);
    const actor = actorOf(ctx.principal);
    const space = teamFilter(a.space ?? "personal");
    const teamId = space && "team" in space ? space.team : null;
    const done: DoneEntry[] = [];
    if (a.kind === "project") {
      if (a.from_project) {
        const p = await seeProject(ctx, a.from_project);
        if (destination(ctx, p.team_id, "W2") === "review")
          throw cantWait(ctx, p.team_id);
        const t = await templateFromProject(db, actor, p.id);
        done.push(
          entryOf("template", t.id, t.name, null, "Saved from the project"),
        );
      } else if (a.template) {
        const id = parseRef(a.template);
        if (id.type === "title")
          throw new CapabilityError(
            "INVALID",
            "template must be template:<id>.",
          );
        const row = await seeTemplate(ctx, id.id);
        if (destination(ctx, row.team_id, "W2") === "review")
          throw cantWait(ctx, row.team_id);
        const t = await updateTemplate(db, actor, row.id, {
          ...(a.name ? { name: a.name } : {}),
          ...(a.description !== undefined
            ? { description: a.description }
            : {}),
          ...(a.tasks ? { tasks: templateTasks(a.tasks) } : {}),
          ...(a.repeat !== undefined ? { rrule: a.repeat } : {}),
        });
        done.push(entryOf("template", t.id, t.name, null, "Changed"));
      } else {
        if (!a.name || !a.tasks?.length)
          throw new CapabilityError(
            "INVALID",
            "A new project template needs a name and tasks (or from_project).",
          );
        if (destination(ctx, teamId, teamId ? "W2" : "W1") === "review")
          throw cantWait(ctx, teamId);
        const t = await createTemplate(db, actor, {
          name: a.name,
          description: a.description ?? "",
          team_id: teamId,
          tasks: templateTasks(a.tasks),
          rrule: a.repeat ?? null,
        });
        done.push(entryOf("template", t.id, t.name, null, "Saved"));
      }
    } else {
      if (a.template) {
        const id = a.template.replace(/^(template|page_template):/, "");
        const row = await seePageTemplate(ctx, id);
        if (destination(ctx, row.team_id, "W2") === "review")
          throw cantWait(ctx, row.team_id);
        const t = await updatePageTemplate(db, actor, row.id, {
          ...(a.name ? { name: a.name } : {}),
          ...(a.description !== undefined
            ? { description: a.description }
            : {}),
          ...(a.markdown !== undefined
            ? { content: templateFromPage(parseDoc(a.markdown)) }
            : {}),
        });
        done.push({
          ...entryOf("template", t.id, t.name, null, "Changed"),
          id: `page_template:${t.id}`,
        });
      } else if (a.from_page) {
        const d = await seeDoc(ctx, a.from_page);
        const personal = !!space && "personal" in space && d.team_id !== null;
        if (destination(ctx, personal ? null : d.team_id, "W2") === "review")
          throw cantWait(ctx, personal ? null : d.team_id);
        const t = await pageTemplateFromPage(db, actor, d.id, {
          ...(a.name ? { name: a.name } : {}),
          ...(a.description !== undefined
            ? { description: a.description }
            : {}),
          personal,
        });
        done.push({
          ...entryOf("template", t.id, t.name, null, "Saved from the page"),
          id: `page_template:${t.id}`,
        });
      } else {
        if (!a.name || a.markdown === undefined)
          throw new CapabilityError(
            "INVALID",
            "A new page template needs a name and markdown (or from_page).",
          );
        if (destination(ctx, teamId, teamId ? "W2" : "W1") === "review")
          throw cantWait(ctx, teamId);
        const t = await createPageTemplate(db, actor, {
          name: a.name,
          description: a.description ?? "",
          team_id: teamId,
          title: a.name,
          content: templateFromPage(parseDoc(a.markdown)),
        });
        done.push({
          ...entryOf("template", t.id, t.name, null, "Saved"),
          id: `page_template:${t.id}`,
        });
      }
    }
    await announceTo(
      db,
      teamId ? { team_id: teamId } : { user_id: ctx.principal.user.id },
      "changed",
      {
        area: "templates",
      },
    );
    return finishWrite(ctx, "Saving a template", { done, teamId });
  },
});

/** Template tasks from the tool's simpler list (t1, t2, … in order). */
const templateTasks = (
  tasks: { title: string; estimate_minutes: number; due_in_days: number }[],
) =>
  tasks.map((t, i) => ({
    id: `t${i + 1}`,
    title: t.title,
    estimate_minutes: t.estimate_minutes,
    due_in_days: t.due_in_days,
  }));

/** A page template the connection can see. */
async function seePageTemplate(ctx: CapabilityContext, id: string) {
  const params = new Params();
  const scope = scopeFor(ctx.spaces, params);
  const row = (
    await ctx.db.query<{ id: string; team_id: string | null }>(
      `SELECT t.id, t.team_id FROM page_templates t
        WHERE t.id = ${params.add(id)} AND ${visiblePageTemplates("t", scope)}`,
      params.values,
    )
  ).rows[0];
  if (!row) throw notReachable();
  return row;
}

/** A project template the connection can see. */
async function seeTemplate(ctx: CapabilityContext, id: string) {
  const params = new Params();
  const scope = scopeFor(ctx.spaces, params);
  const row = (
    await ctx.db.query<{ id: string; team_id: string | null }>(
      `SELECT t.id, t.team_id FROM project_templates t
        WHERE t.id = ${params.add(id)} AND ${visibleTemplates("t", scope)}`,
      params.values,
    )
  ).rows[0];
  if (!row) throw notReachable();
  return row;
}

// --- organize -----------------------------------------------------------

const ORGANIZE = [
  ...ORGANIZE_MORE,
  "create_list",
  "rename_list",
  "create_tag",
  "rename_tag",
  "create_folder",
  "rename_folder",
  "star",
  "unstar",
  "tag_page",
] as const;

export const organize = defineCapability({
  name: "organize",
  title: "Organise pages, fields and teams",
  description:
    "Up to 25 changes, each undoable. create_list/create_tag/create_folder (name, space), rename_list/rename_tag/rename_folder (id, name), star/unstar (kind doc, project or view; id), tag_page (id: page; add: tag names, remove: tag ids). Pages (id: the page): aliases (add: its other names, replacing), fold (lines: heading anchors folded, replacing), link_mention (lines: [anchor], words, to: page or project named), extract (lines, version, name?: to a new page), merge (to: page, version; this one goes to Trash), remove_source (to: source:<id>). Fields: create_field (name, type, for, space, add: choices, calendar), change_field (id, name, add, calendar), set_field (id, to: page or project, value; null clears). Teams, asked first: create_team (name; not undoable), rename_team, invite (email, role), remove_member (person), set_role (person, role), meeting_budget (minutes; null none), with id: the team. Deleting goes through propose_changes.",
  input: z
    .object({
      changes: z
        .array(
          z
            .object({
              do: z.enum(ORGANIZE),
              id: z.string().trim().max(300).optional(),
              name: z.string().trim().min(1).max(80).optional(),
              space: z.string().trim().max(100).optional(),
              // Stars on a page, project or view, as the tool has always
              // taken (a task's or heading's star is the app's).
              kind: z
                .enum(FAVOURITE_KINDS)
                .extract(["doc", "project", "view"])
                .optional(),
              add: z.array(z.string().trim().min(1).max(80)).max(30).optional(),
              remove: z.array(idField).max(20).optional(),
              lines: z
                .array(z.string().trim().min(1).max(65))
                .max(200)
                .optional(),
              to: z.string().trim().max(300).optional(),
              words: z.string().trim().min(1).max(200).optional(),
              version: z.number().int().positive().optional(),
              type: z.enum(FIELD_TYPES).optional(),
              for: z.enum(FIELD_TARGETS).optional(),
              value: z
                .union([z.string().max(500), z.number(), z.boolean(), z.null()])
                .optional(),
              calendar: z.boolean().optional(),
              email: emailField.optional(),
              person: idField.optional(),
              role: z.enum(TEAM_ROLES).optional(),
              minutes: z.number().int().min(30).max(2400).nullable().optional(),
            })
            .strict(),
        )
        .min(1)
        .max(MAX_BATCH),
      client_ref: clientRefInput,
    })
    .strict(),
  output: writeOutput,
  annotations: EDITS,
  access: "write",
  toolset: "workspace",
  mode: "write",
  tier: "W2",
  async run(ctx, a) {
    const db = dbOf(ctx);
    const actor = actorOf(ctx.principal);
    const done: DoneEntry[] = [];
    const skipped: { index: number; reason: string }[] = [];
    const after: (() => Promise<void>)[] = [];
    const teams = new Set<string | null>();
    const more: MoreState = { done, undo: [], after, review: [] };
    const need = <T>(v: T | undefined, what: string): T => {
      if (v === undefined)
        throw new CapabilityError("INVALID", `This change needs ${what}.`);
      return v;
    };
    const owned = async (
      table: "lists" | "tags" | "folders",
      input: string,
    ) => {
      const id = parseRef(input);
      if (id.type === "title")
        throw new CapabilityError("INVALID", "Name it by its id.");
      const p = new Params();
      const scope = scopeFor(ctx.spaces, p);
      const row = (
        await db.query<{ id: string; team_id: string | null; name: string }>(
          `SELECT x.id, x.team_id, x.name FROM ${table} x
            WHERE x.id = ${p.add(id.id)} AND ${visibleOwned("x", "user_id", scope)}`,
          p.values,
        )
      ).rows[0];
      if (!row) throw notReachable();
      return row;
    };
    for (const [index, c] of a.changes.entries()) {
      try {
        refuseSecrets(c.name, ...(c.add ?? []));
        if ((ORGANIZE_MORE as readonly string[]).includes(c.do)) {
          // One change at a time: one that fails leaves nothing behind.
          await db.query("SAVEPOINT organize_more");
          try {
            await organizeMore(ctx, c as MoreChange, more);
            await db.query("RELEASE SAVEPOINT organize_more");
          } catch (e) {
            await db.query("ROLLBACK TO SAVEPOINT organize_more");
            throw e;
          }
          continue;
        }
        if (c.do === "tag_page" && c.add?.some((t) => t.length > 40))
          throw new CapabilityError(
            "INVALID",
            "Tag names are 40 characters at most.",
          );
        if (c.do.startsWith("create_")) {
          const space = teamFilter(c.space ?? "personal");
          const teamId = space && "team" in space ? space.team : null;
          if (destination(ctx, teamId, teamId ? "W2" : "W1") === "review")
            throw cantWait(ctx, teamId);
          const name = need(c.name, "a name");
          const made =
            c.do === "create_list"
              ? await createList(db, actor, { team_id: teamId, name })
              : c.do === "create_tag"
                ? await createTag(db, actor, { team_id: teamId, name })
                : await createFolder(db, actor, { team_id: teamId, name });
          const type = c.do.slice(7) as "list" | "tag" | "folder";
          done.push(entryOf(type, made.id, made.name, null, "Made"));
          teams.add(teamId);
        } else if (c.do.startsWith("rename_")) {
          const type = c.do.slice(7) as "list" | "tag" | "folder";
          const row = await owned(
            `${type}s` as "lists" | "tags" | "folders",
            need(c.id, "an id"),
          );
          if (destination(ctx, row.team_id, "W2") === "review")
            throw cantWait(ctx, row.team_id);
          const name = need(c.name, "a name");
          if (type === "list") await updateList(db, actor, row.id, { name });
          else if (type === "tag") await updateTag(db, actor, row.id, { name });
          else await updateFolder(db, actor, row.id, { name });
          done.push(
            entryOf(
              type,
              row.id,
              name,
              null,
              `Renamed from ${cleanTitle(row.name)}`,
            ),
          );
          teams.add(row.team_id);
        } else if (c.do === "star" || c.do === "unstar") {
          const kind = need(c.kind, "a kind");
          const ref = parseRef(need(c.id, "an id"));
          if (ref.type === "title")
            throw new CapabilityError("INVALID", "Star something by its id.");
          const typed =
            kind === "doc"
              ? `doc:${ref.id}`
              : kind === "project"
                ? `project:${ref.id}`
                : `view:${ref.id}`;
          // Only what this connection can see.
          const title =
            kind === "doc"
              ? (await seeDoc(ctx, typed)).title
              : kind === "project"
                ? (await seeProject(ctx, typed)).name
                : await seeViewTitle(ctx, ref.id);
          if (destination(ctx, null, "W1") === "review")
            throw cantWait(ctx, null);
          await setFavourite(
            db,
            ctx.principal.user.id,
            kind,
            ref.id,
            c.do === "star",
          );
          done.push(
            entryOf(
              kind,
              ref.id,
              title,
              null,
              c.do === "star" ? "Starred" : "Unstarred",
            ),
          );
          teams.add(null);
        } else {
          const doc = await seeDoc(ctx, need(c.id, "a page id"));
          if (destination(ctx, doc.team_id, "W2") === "review")
            throw cantWait(ctx, doc.team_id);
          if (!c.add?.length && !c.remove?.length)
            throw new CapabilityError(
              "INVALID",
              "tag_page needs add or remove.",
            );
          let version = doc.version;
          if (c.remove?.length) {
            const now = (await pageTags(db, doc.id)).map((t) => t.id);
            version = (
              await setPageTags(
                db,
                actor,
                doc.id,
                now.filter((t) => !c.remove!.includes(t)),
              )
            ).version;
          }
          if (c.add?.length)
            version = (await addPageTagNames(db, actor, doc.id, c.add)).version;
          after.push(() =>
            announceDocChange(
              pool,
              doc.id,
              version,
              `agent:${ctx.principal.grant_id ?? "session"}`,
              { tags: true },
            ),
          );
          done.push(entryOf("doc", doc.id, doc.title, version, "Tags changed"));
        }
      } catch (e) {
        if (e instanceof CapabilityError && e.code === "INVALID") throw e;
        if (a.changes.length === 1) throw e;
        skipped.push({
          index,
          reason: e instanceof Error ? e.message : "It couldn't be done.",
        });
      }
    }
    for (const t of teams)
      await announceTo(
        db,
        t ? { team_id: t } : { user_id: ctx.principal.user.id },
        "changed",
        {
          area: "organize",
        },
      );
    return finishWrite(ctx, "Organising", {
      done,
      skipped,
      after,
      undo: more.undo,
      review: more.review,
      reviewSummary: "Team changes",
    });
  },
});

async function seeViewTitle(ctx: CapabilityContext, id: string) {
  const { findView } = await import("./view-store.js");
  const v = await findView(ctx.db, ctx.spaces, id);
  if (!v) throw notReachable();
  return v.name;
}

// --- comment_on_doc -----------------------------------------------------

export const commentOnDoc = defineCapability({
  name: "comment_on_doc",
  title: "Comment on a page",
  description:
    "Adds a comment on a page or one of its lines (line: its anchor), replies (reply_to), or resolves and reopens a comment. mentions (person ids) notify people, so they are kept only when this connection may notify teammates; otherwise they are left out and the answer says so. Only people who can read the page can be named.",
  input: z
    .object({
      doc: z.string().trim().min(1).max(300),
      action: z
        .enum(["comment", "reply", "resolve", "reopen"])
        .default("comment"),
      body: z.string().trim().min(1).max(4000).optional(),
      line: z.string().trim().max(64).optional(),
      quote: z.string().trim().max(400).optional(),
      reply_to: idField.optional(),
      comment: idField.optional().describe("For resolve and reopen."),
      mentions: z.array(idField).max(20).optional(),
      client_ref: clientRefInput,
    })
    .strict(),
  output: writeOutput.extend({
    mentions_left_out: z
      .number()
      .describe(
        "Mentions dropped because this connection may not notify teammates.",
      ),
  }),
  annotations: ADDS,
  access: "write",
  toolset: "workspace",
  mode: "write",
  tier: "W2",
  effects: ["notify_member"],
  async run(ctx, a) {
    refuseSecrets(a.body, a.quote);
    const db = dbOf(ctx);
    const actor = actorOf(ctx.principal);
    const doc = await seeDoc(ctx, a.doc);
    if (destination(ctx, doc.team_id, "W2") === "review")
      throw cantWait(ctx, doc.team_id);
    await requireDoc(db, doc.id, actor, "items:read");
    let left = 0;
    let change: string;
    let commentId: string;
    if (a.action === "resolve" || a.action === "reopen") {
      if (!a.comment)
        throw new CapabilityError(
          "INVALID",
          "Name the comment to resolve or reopen.",
        );
      const c = await resolveComment(
        db,
        actor,
        doc.id,
        a.comment,
        a.action === "resolve",
      );
      commentId = c.id;
      change = a.action === "resolve" ? "Comment resolved" : "Comment reopened";
    } else {
      if (!a.body)
        throw new CapabilityError("INVALID", "A comment needs a body.");
      if (a.action === "reply" && !a.reply_to)
        throw new CapabilityError("INVALID", "A reply needs reply_to.");
      const wanted = a.mentions ?? [];
      const mentions = ctx.principal.flags.notify_teammates ? wanted : [];
      left = wanted.length - mentions.length;
      const made = await addComment(db, actor, doc.id, {
        body: a.body,
        ...(a.line ? { block_id: a.line.replace(/^\^/, "") } : {}),
        ...(a.quote ? { quote: a.quote } : {}),
        ...(a.action === "reply" ? { parent_id: a.reply_to } : {}),
        mentions,
      });
      commentId = made.id;
      change = a.action === "reply" ? "Replied" : "Commented";
    }
    const answer = await finishWrite(ctx, "Commenting", {
      done: [
        {
          ...entryOf("doc", doc.id, doc.title, doc.version, change),
          id: `doc:${doc.id}`,
        },
      ],
      teamId: doc.team_id,
      after: [
        () =>
          announceTo(
            pool,
            doc.team_id
              ? { team_id: doc.team_id }
              : { user_id: ctx.principal.user.id },
            "changed",
            {
              area: "docs",
              doc: doc.id,
              entity_type: "doc",
              entity_id: doc.id,
            },
          ),
      ],
    });
    return {
      ...answer,
      structured: { ...answer.structured, mentions_left_out: left },
      markdown:
        answer.markdown +
        `\ncomment: ${commentId}` +
        (left
          ? `\n${left} mention${left === 1 ? " was" : "s were"} left out: this connection may not notify teammates.`
          : ""),
    };
  },
});

// --- resolve_suggestions ------------------------------------------------

export const resolveSuggestions = defineCapability({
  name: "resolve_suggestions",
  title: "Take or leave suggestions",
  description:
    "Takes or leaves suggested edits on a page (ids from get_history). On the person's own pages it's done at once (taking one keeps a version first); on team pages it goes to the Review inbox, so an agent never pushes words into a teammate's page.",
  input: z
    .object({
      doc: z.string().trim().min(1).max(300),
      take: z.array(idField).max(50).optional(),
      leave: z.array(idField).max(50).optional(),
      client_ref: clientRefInput,
    })
    .strict(),
  output: writeOutput,
  annotations: EDITS,
  access: "write",
  toolset: "workspace",
  mode: "write",
  tier: "W2",
  async run(ctx, a) {
    const db = dbOf(ctx);
    const actor = actorOf(ctx.principal);
    const doc = await seeDoc(ctx, a.doc);
    const take = a.take ?? [];
    const leave = a.leave ?? [];
    if (!take.length && !leave.length)
      throw new CapabilityError(
        "INVALID",
        "Name suggestions to take or leave.",
      );
    const where = destination(ctx, doc.team_id, "W2");
    if (doc.team_id || where === "review") {
      const open = await listSuggestions(db, ctx.principal.user.id, doc.id);
      const known = new Set(
        open.filter((s) => s.status === "open").map((s) => s.id),
      );
      for (const id of [...take, ...leave])
        if (!known.has(id))
          throw new CapabilityError(
            "NOT_FOUND",
            "That suggestion isn't open on this page.",
          );
      return finishWrite(ctx, "Deciding suggestions", {
        done: [],
        review: [
          actionChange({
            action: "suggestions.resolve",
            target_id: doc.id,
            title: doc.title,
            team_id: doc.team_id,
            headline: `Take ${take.length} and leave ${leave.length} suggestion${take.length + leave.length === 1 ? "" : "s"} on ${quoted(doc.title)}`,
            input: { id: doc.id, take, leave },
            version: doc.version,
          }),
        ],
        teamId: doc.team_id,
      });
    }
    let version = doc.version;
    const undo: UndoOp[] = [];
    const before = doc.version;
    for (const sid of take) {
      const saved = await decideSuggestion(db, actor, doc.id, sid, true);
      if (saved) version = saved.version;
    }
    for (const sid of leave)
      await decideSuggestion(db, actor, doc.id, sid, false);
    if (take.length)
      undo.push({
        op: "doc.restore",
        doc_id: doc.id,
        version,
        to_version: before,
      });
    return finishWrite(ctx, "Deciding suggestions", {
      done: [
        entryOf(
          "doc",
          doc.id,
          doc.title,
          version,
          `${take.length} taken, ${leave.length} left`,
        ),
      ],
      undo,
      teamId: null,
      after: take.length
        ? afterSave(doc.id, version, ctx.principal.grant_id)
        : [],
    });
  },
});

// --- tasks_from_doc -----------------------------------------------------

export const tasksFromDoc = defineCapability({
  name: "tasks_from_doc",
  title: "Make tasks from a page",
  description:
    "Turns a page's open checklist lines (all of them, or lines: their anchors) into tasks in the page's space, each tied to its line so ticking either ticks the other. At most 25 at once.",
  input: z
    .object({
      doc: z.string().trim().min(1).max(300),
      lines: z
        .array(z.string().trim().min(1).max(64))
        .max(MAX_BATCH)
        .optional(),
      project: z
        .string()
        .trim()
        .max(300)
        .optional()
        .describe("Put the tasks in this project."),
      client_ref: clientRefInput,
    })
    .strict(),
  output: writeOutput,
  annotations: ADDS,
  access: "write",
  toolset: "workspace",
  mode: "write",
  tier: "W2",
  async run(ctx, a) {
    const db = dbOf(ctx);
    const actor = actorOf(ctx.principal);
    const seen = await seeDoc(ctx, a.doc);
    if (destination(ctx, seen.team_id, seen.team_id ? "W2" : "W1") === "review")
      throw cantWait(ctx, seen.team_id);
    const project = a.project ? await seeProject(ctx, a.project) : null;
    if (project && project.team_id !== seen.team_id)
      throw new CapabilityError(
        "INVALID",
        "The project must be in the page's space.",
      );
    const doc = await requireDoc(db, seen.id, actor, "items:read");
    if (doc.kind === "agenda")
      throw new CapabilityError(
        "INVALID",
        "This agenda lists tasks you already have.",
      );
    const only = a.lines?.map((l) => l.replace(/^\^/, ""));
    // Count first: more than 25 at once is a bulk change.
    const content =
      (
        await db.query<{ content: DocBlock[] | null }>(
          "SELECT content FROM docs WHERE id = $1",
          [doc.id],
        )
      ).rows[0].content ?? [];
    const open = content.filter(
      (b) =>
        b.type === "todo" &&
        !b.done &&
        b.text.trim() &&
        (!only || (!!b.id && only.includes(b.id))),
    ).length;
    if (open > MAX_BATCH)
      throw new CapabilityError(
        "INVALID",
        `That page has ${open} open lines: name up to ${MAX_BATCH} with lines.`,
      );
    const made = await makeLineTasks(db, actor, doc, {
      ...(only ? { only } : {}),
      projectId: project?.id ?? null,
    });
    const undo: UndoOp[] = (made ?? []).map((item) => ({
      op: "item.delete",
      id: item.id,
      version: item.version,
    }));
    const version = (
      await db.query<{ version: number }>(
        "SELECT version FROM docs WHERE id = $1",
        [doc.id],
      )
    ).rows[0].version;
    return finishWrite(ctx, "Making tasks from a page", {
      done: (made ?? []).map((item) =>
        entryOf("task", item.id, item.title, item.version, "Made from a line"),
      ),
      skipped: made
        ? []
        : [
            {
              index: 0,
              reason: "No open checklist lines that aren't tasks already.",
            },
          ],
      undo,
      teamId: seen.team_id,
      after: afterSave(doc.id, version, ctx.principal.grant_id),
    });
  },
});
