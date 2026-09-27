import { z } from "zod";
import {
  itemData,
  parseQuickAdd,
  PRIORITIES,
  STATUSES,
  type ReviewChangeInput,
} from "@orbyn/core";
import { Params, scopeFor, visibleItems } from "../lib/visibility.js";
import {
  lockItem,
  mutate,
  quickAddContext,
  recomputeProgress,
  type ItemRow,
} from "../modules/items/service.js";
import { editSteps, mergedItem } from "../modules/proposals/service.js";
import {
  editFollowing,
  editOccurrence,
  seriesOf,
  skipOccurrence,
} from "../modules/items/occurrences.js";
import { occurrenceEnd } from "../modules/planner/calendar.js";
import { cleanTitle } from "./format.js";
import { projectId, teamFilter, uuidOf } from "./common.js";
import { parseRef, refUrl } from "./refs.js";
import {
  CapabilityError,
  defineCapability,
  type CapabilityContext,
  type Effect,
} from "./registry.js";
import type { UndoOp } from "./undo.js";
import {
  ADDS,
  EDITS,
  MAX_BATCH,
  actorOf,
  clientRefInput,
  dbOf,
  cantWait,
  destination,
  finishWrite,
  refuseSecrets,
  teammatesListen,
  isoTime,
  idField,
  emailField,
  writeOutput,
  type DoneEntry,
} from "./write.js";

/**
 * Tasks and events: making them (create_tasks), changing them
 * (update_tasks), completing or reopening them (complete_tasks) and their
 * checklists (edit_checklist). Every change goes through the items service,
 * as the app's own does, as the person with an ordinary member's rights.
 */

const iso = isoTime;
const when = (v: Date | string | null | undefined) =>
  v ? new Date(v).toISOString() : null;

/** A task or event the connection can see, locked for a change. */
export async function visibleItem(
  ctx: CapabilityContext,
  input: string,
): Promise<ItemRow> {
  const ref = parseRef(input);
  if (ref.type !== "task" && ref.type !== "event" && ref.type !== "any")
    throw new CapabilityError(
      "INVALID",
      "That isn't a task or event id.",
      "Use a task:<id> or event:<id> from search, query or fetch.",
    );
  const params = new Params();
  const scope = scopeFor(ctx.spaces, params);
  const seen = (
    await ctx.db.query(
      `SELECT 1 FROM items i WHERE i.id = ${params.add(ref.id)} AND ${visibleItems("i", scope)}`,
      params.values,
    )
  ).rowCount;
  if (!seen)
    throw new CapabilityError(
      "NOT_FOUND",
      "Nothing with that id is reachable from this connection.",
      "Search for it and use an id from the results.",
    );
  return lockItem(dbOf(ctx), ref.id);
}

/** A task or event as the answers list it. */
export const itemEntry = (
  row: { id: string; kind: string; title: string; version: number },
  change: string,
): DoneEntry => ({
  id: `${row.kind === "event" ? "event" : "task"}:${row.id}`,
  title: cleanTitle(row.title) || "Untitled",
  url: refUrl({ type: "task", id: row.id }),
  version: row.version,
  change,
});

/** The team a "team" argument names: null for Personal, undefined for none. */
function teamOf(value: string | undefined): string | null | undefined {
  const t = teamFilter(value);
  if (!t) return undefined;
  return "personal" in t ? null : t.team;
}

/** What a change to a team item sets off outside Orbyn. */
async function effectsFor(
  ctx: CapabilityContext,
  teamId: string | null,
  events: string[],
  assigneeId: string | null | undefined,
  emails: string[],
): Promise<Effect[]> {
  const effects: Effect[] = [];
  if (emails.length) effects.push("email_outside");
  if (assigneeId && assigneeId !== ctx.principal.user.id)
    effects.push("notify_member");
  if (await teammatesListen(ctx.db, teamId, ctx.principal.user.id, events))
    effects.push("notify_member");
  return effects;
}

/**
 * Fields a task or event takes on create and update alike (H6a): alerts,
 * colour, web links, busy or free and the meeting link. Checked again by
 * the items service, as the app's own changes are.
 */
const itemExtras = {
  all_day: z.boolean().optional(),
  alerts: z
    .array(z.number().int().min(0).max(40_320))
    .max(5)
    .optional()
    .describe("Minutes before (0: at the time); [] clears."),
  color: z.string().max(7).nullable().optional(),
  links: z
    .array(
      z
        .object({
          url: z.string().trim().max(2000),
          title: z.string().trim().max(200).optional(),
        })
        .strict(),
    )
    .max(20)
    .optional()
    .describe("Replaces the list."),
  busy: z.boolean().optional().describe("false: shown as free."),
  meeting_url: z.string().trim().max(500).optional(),
};

// --- create_tasks ------------------------------------------------------

const newTask = z
  .object({
    line: z
      .string()
      .trim()
      .min(1)
      .max(500)
      .optional()
      .describe(
        'One quick-add line, such as "Essay fri 3pm !high 90m #uni @Sam". Fields given too win.',
      ),
    title: z.string().trim().min(1).max(200).optional(),
    notes: z.string().max(10_000).optional(),
    kind: z.enum(["task", "event"]).optional(),
    due_at: iso
      .nullable()
      .optional()
      .describe("A task's deadline, or an event's start (ISO 8601)."),
    end_at: iso.nullable().optional().describe("An event's end."),
    ...itemExtras,
    priority: z.enum(PRIORITIES).optional(),
    estimate_minutes: z.number().int().min(1).max(10_080).optional(),
    team: z
      .string()
      .trim()
      .max(100)
      .optional()
      .describe('"personal" (the default), or a team id from get_context.'),
    project: z
      .string()
      .trim()
      .max(300)
      .optional()
      .describe("Without team: the project's space."),
    stage_id: idField.optional(),
    parent: z
      .string()
      .trim()
      .max(300)
      .optional()
      .describe("A task this one is a subtask of."),
    list_id: idField.optional(),
    tag_ids: z.array(idField).max(20).optional(),
    assignee_id: z
      .uuid()
      .optional()
      .describe(
        "Who on the team does it. Anyone but the person notifies a teammate.",
      ),
    rrule: z.string().trim().max(200).optional(),
    location: z.string().trim().max(300).optional(),
    steps: z.array(z.string().trim().min(1).max(500)).max(50).optional(),
    invite: z
      .array(emailField)
      .max(50)
      .optional()
      .describe("People to invite to an event by email."),
  })
  .strict()
  .refine((t) => t.line || t.title, {
    message: "Give a title or a quick-add line.",
    path: ["title"],
  });

export const createTasks = defineCapability({
  name: "create_tasks",
  title: "Add tasks or events",
  description:
    'Adds up to 25 tasks or events, from fields or a quick-add line ("Essay fri 3pm !high 90m #uni @Sam", parsed without AI): space, project and stage, parent, list, tags, estimate, repeat, alerts, steps and invites. Invites, assigning someone else and spaces it may only suggest in may ask first. Habit lines are left out.',
  input: z
    .object({
      tasks: z.array(newTask).min(1).max(MAX_BATCH),
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
    const p = ctx.principal;
    const db = dbOf(ctx);
    const actor = actorOf(p);
    const done: DoneEntry[] = [];
    const review: ReviewChangeInput[] = [];
    const skipped: { index: number; reason: string }[] = [];
    const undo: UndoOp[] = [];
    let lastTeam: string | null = null;
    const context = a.tasks.some((t) => t.line)
      ? await quickAddContext(ctx.db, p.user.id)
      : null;
    for (const [index, t] of a.tasks.entries()) {
      refuseSecrets(t.line, t.title, t.notes);
      const parsed = t.line
        ? parseQuickAdd(t.line, {
            timeZone: ctx.timezone,
            now: ctx.now,
            ...context!,
            selfId: p.user.id,
          })
        : null;
      if (parsed?.habit) {
        skipped.push({
          index,
          reason:
            "That line describes a habit (a repeating goal the planner places), which is set up in Orbyn, not added as a task.",
        });
        continue;
      }
      const team = teamOf(t.team);
      let teamId = team !== undefined ? team : (parsed?.input.team_id ?? null);
      // A task in a project goes in the project's space, so team can be
      // left out (a team project reached through this connection).
      if (team === undefined && !parsed?.input.team_id && t.project) {
        const home = (
          await db.query<{ team_id: string | null }>(
            "SELECT team_id FROM projects WHERE id = $1",
            [projectId(t.project)],
          )
        ).rows[0];
        if (
          home?.team_id &&
          (p.team_ids === null || p.team_ids.includes(home.team_id))
        )
          teamId = home.team_id;
      }
      const parent = t.parent ? uuidOf(t.parent, "parent") : undefined;
      const data = itemData.parse({
        ...(parsed?.input ?? {}),
        ...(t.title ? { title: t.title } : {}),
        ...(t.notes !== undefined ? { notes: t.notes } : {}),
        ...(t.kind ? { kind: t.kind } : {}),
        ...(t.due_at !== undefined ? { due_at: t.due_at } : {}),
        ...(t.end_at !== undefined ? { end_at: t.end_at } : {}),
        ...(t.all_day !== undefined ? { all_day: t.all_day } : {}),
        ...(t.alerts ? { alerts: t.alerts } : {}),
        ...(t.color !== undefined ? { color: t.color } : {}),
        ...(t.links ? { links: t.links } : {}),
        ...(t.busy !== undefined ? { busy: t.busy } : {}),
        ...(t.meeting_url !== undefined ? { meeting_url: t.meeting_url } : {}),
        ...(t.priority ? { priority: t.priority } : {}),
        ...(t.estimate_minutes ? { estimate_minutes: t.estimate_minutes } : {}),
        team_id: teamId,
        ...(t.project ? { project_id: projectId(t.project) } : {}),
        ...(t.stage_id ? { stage_id: t.stage_id } : {}),
        ...(parent ? { parent_id: parent } : {}),
        ...(t.list_id ? { list_id: t.list_id } : {}),
        ...(t.tag_ids ? { tag_ids: t.tag_ids } : {}),
        ...(t.assignee_id ? { assignee_id: t.assignee_id } : {}),
        ...(t.rrule ? { rrule: t.rrule } : {}),
        ...(t.location ? { location: t.location } : {}),
        ...(t.invite?.length
          ? { attendees: t.invite.map((email) => ({ email })) }
          : {}),
      });
      const emails =
        data.kind === "event" ? (data.attendees ?? []).map((x) => x.email) : [];
      const effects = await effectsFor(
        ctx,
        teamId,
        ["item.created"],
        data.assignee_id,
        emails,
      );
      const where = destination(ctx, teamId, teamId ? "W2" : "W1", effects);
      lastTeam = teamId;
      if (where === "review") {
        review.push({
          type: "task.create",
          title: data.title,
          team_id: teamId,
          data: JSON.parse(JSON.stringify(data)),
          emails,
        });
        continue;
      }
      const item = (await mutate(db, actor, { operation: "create", data }))!;
      for (const [i, title] of (t.steps ?? []).entries())
        await db.query(
          "INSERT INTO item_steps (item_id, title, position) VALUES ($1, $2, $3)",
          [item.id, title, i],
        );
      if (t.steps?.length) await recomputeProgress(db, item.id);
      const now = t.steps?.length ? await lockItem(db, item.id) : item;
      undo.push({ op: "item.delete", id: item.id, version: now.version });
      done.push(itemEntry(now, "Added"));
    }
    return finishWrite(ctx, "Adding tasks", {
      done,
      review,
      reviewSummary: `Add ${review.length === 1 ? `“${cleanTitle(String(review[0].title))}”` : `${review.length} tasks and events`}`,
      skipped,
      undo,
      teamId: lastTeam,
    });
  },
});

// --- update_tasks ------------------------------------------------------

const change = z
  .object({
    id: z.string().trim().min(1).max(300).describe("task:<id> or event:<id>."),
    version: z
      .number()
      .int()
      .positive()
      .describe("The version you last read (fetch or query gives it)."),
    title: z.string().trim().min(1).max(200).optional(),
    notes: z.string().max(10_000).optional(),
    due_at: iso.nullable().optional(),
    end_at: iso.nullable().optional(),
    priority: z.enum(PRIORITIES).optional(),
    estimate_minutes: z.number().int().min(1).max(10_080).nullable().optional(),
    progress: z.number().int().min(0).max(100).optional(),
    list_id: idField.nullable().optional(),
    tag_ids: z.array(idField).max(20).optional(),
    project: z
      .string()
      .trim()
      .max(300)
      .nullable()
      .optional()
      .describe("Move it to this project (null takes it out)."),
    stage_id: idField.nullable().optional(),
    assignee_id: idField.nullable().optional(),
    location: z.string().trim().max(300).optional(),
    team: z
      .string()
      .trim()
      .max(100)
      .optional()
      .describe('Move it to "personal" or another team.'),
    skip: iso
      .optional()
      .describe("A repeating item: skip this one occurrence (its start)."),
    ...itemExtras,
    status: z.enum(STATUSES).optional(),
    rrule: z
      .string()
      .trim()
      .max(200)
      .nullable()
      .optional()
      .describe("null stops the repeat."),
    parent: z
      .string()
      .trim()
      .max(300)
      .nullable()
      .optional()
      .describe("A task to nest under; null: top level."),
    target_value: z.number().nullable().optional(),
    current_value: z.number().nullable().optional(),
    value_unit: z.string().trim().max(16).optional(),
    scope: z
      .enum(["this", "following"])
      .optional()
      .describe("Change just `occurrence`, or it and later ones."),
    occurrence: iso.optional(),
  })
  .strict();

/** The item's fields a patch names, as they are now. */
function beforeOf(row: ItemRow, patch: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(patch)) {
    const v = (row as unknown as Record<string, unknown>)[key];
    out[key] = v instanceof Date ? v.toISOString() : (v ?? null);
  }
  return out;
}

/** The fields a patch names as they are now, links included (for Undo). */
async function priorFields(
  db: ReturnType<typeof dbOf>,
  row: ItemRow,
  patch: Record<string, unknown>,
) {
  const before = beforeOf(row, patch);
  if ("links" in patch)
    before.links = (
      await db.query<{ url: string; title: string }>(
        "SELECT url, title FROM item_links WHERE item_id = $1 ORDER BY position, id",
        [row.id],
      )
    ).rows;
  return before;
}

export const updateTasks = defineCapability({
  name: "update_tasks",
  title: "Change tasks or events",
  description:
    "Changes up to 25 tasks or events. Only named fields change and the version is checked (VERSION_CONFLICT otherwise). A repeating item changes as a series, or with scope one occurrence or it and later ones. Moving between spaces, emailing invitees or notifying a teammate may ask first. Undo keeps the old values.",
  input: z
    .object({
      changes: z.array(change).min(1).max(MAX_BATCH),
      client_ref: clientRefInput,
    })
    .strict(),
  output: writeOutput,
  annotations: EDITS,
  access: "suggest",
  toolset: "core",
  mode: "write",
  tier: "W2",
  async run(ctx, a) {
    const db = dbOf(ctx);
    const actor = actorOf(ctx.principal);
    const done: DoneEntry[] = [];
    const review: ReviewChangeInput[] = [];
    const undo: UndoOp[] = [];
    let lastTeam: string | null = null;
    for (const c of a.changes) {
      refuseSecrets(
        c.title,
        c.notes,
        c.location,
        c.meeting_url,
        ...(c.links ?? []).map((l) => `${l.url} ${l.title ?? ""}`),
      );
      const row = await visibleItem(ctx, c.id);
      if (row.version !== c.version)
        throw new CapabilityError(
          "VERSION_CONFLICT",
          `“${cleanTitle(row.title)}” changed since version ${c.version}.`,
          "Fetch it again for its current version, then retry with that version.",
          { id: `task:${row.id}`, version: row.version },
        );
      const {
        id: _id,
        version: _v,
        team,
        project,
        skip,
        parent,
        scope,
        occurrence,
        ...fields
      } = c;
      if (skip) {
        if (
          destination(ctx, row.team_id, "W2", [], { owner: row }) === "review"
        )
          throw cantWait(ctx, row.team_id);
        await skipOccurrence(db, actor, row.id, skip);
        const after = await lockItem(db, row.id);
        done.push(itemEntry(after, "Skipped one occurrence"));
        lastTeam = row.team_id;
        if (
          !Object.keys(fields).length &&
          team === undefined &&
          project === undefined
        )
          continue;
      }
      const patch: Record<string, unknown> = { ...fields };
      if (project !== undefined)
        patch.project_id = project === null ? null : projectId(project);
      if (parent !== undefined)
        patch.parent_id = parent === null ? null : uuidOf(parent, "parent");
      if (scope) {
        if (!occurrence)
          throw new CapabilityError(
            "INVALID",
            "A change to part of a series needs occurrence: that occurrence's start.",
          );
        if (team !== undefined || project !== undefined)
          throw new CapabilityError(
            "INVALID",
            "Moving it to another space or project changes the whole series: leave out scope.",
          );
        if (!Object.keys(patch).length)
          throw new CapabilityError(
            "INVALID",
            "Name at least one field to change.",
          );
        if (
          destination(ctx, row.team_id, row.team_id ? "W2" : "W1", [], {
            owner: row,
          }) === "review"
        )
          throw cantWait(ctx, row.team_id);
        done.push(await editPart(ctx, row, scope, occurrence, patch, undo));
        lastTeam = row.team_id;
        continue;
      }
      const moveTo = teamOf(team);
      const moving = moveTo !== undefined && moveTo !== row.team_id;
      if (moving) patch.team_id = moveTo;
      if (!Object.keys(patch).length)
        throw new CapabilityError(
          "INVALID",
          "Name at least one field to change.",
        );
      const before = await priorFields(db, row, patch);
      const emails =
        row.kind === "event"
          ? (
              await db.query<{ email: string }>(
                "SELECT email FROM item_attendees WHERE item_id = $1",
                [row.id],
              )
            ).rows.map((r) => r.email)
          : [];
      const noticeable = ["title", "due_at", "end_at", "location"].some(
        (k) => k in patch,
      );
      const effects = await effectsFor(
        ctx,
        row.team_id,
        ["item.updated"],
        "assignee_id" in patch && patch.assignee_id !== row.assignee_id
          ? (patch.assignee_id as string | null)
          : null,
        noticeable ? emails : [],
      );
      const home = destination(
        ctx,
        row.team_id,
        moving ? "W3" : row.team_id ? "W2" : "W1",
        effects,
        { owner: row },
      );
      // Moving: both spaces must allow it; the stricter one decides.
      const where =
        moving && moveTo && destination(ctx, moveTo, "W3") === "review"
          ? "review"
          : home;
      lastTeam = row.team_id;
      if (where === "review") {
        review.push({
          type: "task.update",
          item_id: row.id,
          version: row.version,
          title: row.title,
          team_id: row.team_id,
          patch,
          before,
          emails: noticeable ? emails : [],
        });
        continue;
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
      done.push(itemEntry(item, "Changed"));
    }
    return finishWrite(ctx, "Changing tasks", {
      done,
      review,
      reviewSummary:
        review.length === 1
          ? `Change “${cleanTitle(String(review[0].title))}”`
          : `Change ${review.length} tasks and events`,
      undo,
      teamId: lastTeam,
    });
  },
});

/**
 * Changes one occurrence of a repeating item ("this"), or it and every later
 * one ("following"), through the app's own occurrence edits: the fields not
 * named keep the occurrence's own values. One occurrence's change can be
 * undone; "following" starts a new series, which Undo can't take back.
 */
async function editPart(
  ctx: CapabilityContext,
  row: ItemRow,
  scope: "this" | "following",
  occurrence: string,
  patch: Record<string, unknown>,
  undo: UndoOp[],
): Promise<DoneEntry> {
  const db = dbOf(ctx);
  const actor = actorOf(ctx.principal);
  if (!row.rrule || !row.due_at)
    throw new CapabilityError(
      "INVALID",
      `“${cleanTitle(row.title)}” doesn't repeat: leave out scope.`,
    );
  const when = new Date(occurrence);
  const usualEnd = occurrenceEnd(seriesOf(row), when);
  const data = mergedItem(row as never, {
    due_at: when.toISOString(),
    end_at: usualEnd ? usualEnd.toISOString() : null,
    ...patch,
  });
  if (scope === "this") {
    const kept = (
      await db.query<{ data: unknown }>(
        "SELECT data FROM item_overrides WHERE item_id = $1 AND occurrence = $2",
        [row.id, when],
      )
    ).rows[0];
    const item = await editOccurrence(
      db,
      actor,
      row.id,
      row.version,
      occurrence,
      data,
    );
    undo.push({
      op: "occurrence.restore",
      id: row.id,
      version: item.version,
      occurrence: when.toISOString(),
      data: kept?.data ?? null,
    });
    return itemEntry(
      { ...row, version: item.version },
      `Changed the occurrence at ${when.toISOString()}`,
    );
  }
  const prior = await priorFields(db, row, patch);
  const made = await editFollowing(
    db,
    actor,
    row.id,
    row.version,
    occurrence,
    data,
  );
  const now = made ?? (await lockItem(db, row.id));
  if (now.id === row.id) {
    // From the first occurrence, "following" is the whole series.
    undo.push({
      op: "item.restore",
      id: row.id,
      version: now.version,
      fields: prior,
    });
    return itemEntry(now as ItemRow, "Changed the whole series");
  }
  return itemEntry(
    now as ItemRow,
    `Changed from ${when.toISOString()} on, as a new series (no undo)`,
  );
}

// --- complete_tasks ----------------------------------------------------

export const completeTasks = defineCapability({
  name: "complete_tasks",
  title: "Complete or reopen tasks",
  description:
    "Completes (or with done false reopens) up to 25 tasks. Each needs its version, and a repeating task the occurrence (its due_at), so a retry never completes the next repeat. Future sessions of a completed task are cleared; Undo puts task and sessions back.",
  input: z
    .object({
      tasks: z
        .array(
          z
            .object({
              id: z.string().trim().min(1).max(300),
              version: z.number().int().positive(),
              done: z.boolean().default(true),
              occurrence: iso
                .optional()
                .describe("For a repeating task: the due_at being completed."),
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
  toolset: "core",
  mode: "write",
  tier: "W2",
  async run(ctx, a) {
    const db = dbOf(ctx);
    const actor = actorOf(ctx.principal);
    const done: DoneEntry[] = [];
    const review: ReviewChangeInput[] = [];
    const undo: UndoOp[] = [];
    let lastTeam: string | null = null;
    for (const t of a.tasks) {
      const row = await visibleItem(ctx, t.id);
      if (row.version !== t.version)
        throw new CapabilityError(
          "VERSION_CONFLICT",
          `“${cleanTitle(row.title)}” changed since version ${t.version}.`,
          "Fetch it again: it may already be complete, or have moved to its next occurrence.",
          { id: `task:${row.id}`, version: row.version },
        );
      if (row.rrule && t.done) {
        if (!t.occurrence)
          throw new CapabilityError(
            "INVALID",
            `“${cleanTitle(row.title)}” repeats: give the occurrence (its due_at) you mean.`,
          );
        if (when(row.due_at) !== new Date(t.occurrence).toISOString())
          throw new CapabilityError(
            "STALE",
            `That occurrence of “${cleanTitle(row.title)}” isn't the current one.`,
            "Fetch it again for its current due_at.",
            { id: `task:${row.id}`, due_at: when(row.due_at) },
          );
      }
      const status = t.done ? "done" : "todo";
      if (row.status === status) {
        done.push(itemEntry(row, t.done ? "Already complete" : "Already open"));
        continue;
      }
      const effects = await effectsFor(
        ctx,
        row.team_id,
        ["item.completed", "item.updated"],
        null,
        [],
      );
      const where = destination(
        ctx,
        row.team_id,
        row.team_id ? "W2" : "W1",
        effects,
        { owner: row },
      );
      lastTeam = row.team_id;
      if (where === "review") {
        review.push({
          type: "task.complete",
          item_id: row.id,
          version: row.version,
          title: row.title,
          team_id: row.team_id,
          done: t.done,
        });
        continue;
      }
      // What completing clears, so Undo can put it back.
      const sessions = t.done
        ? (
            await db.query<{
              id: string;
              item_id: string;
              start_at: Date;
              end_at: Date;
              source: string;
              plan_id: string | null;
            }>(
              `SELECT id, item_id, start_at, end_at, source, plan_id FROM time_blocks
                WHERE item_id = $1 AND start_at > now()`,
              [row.id],
            )
          ).rows
        : [];
      const item = (await mutate(db, actor, {
        operation: "update",
        item_id: row.id,
        version: row.version,
        data: mergedItem(row as never, { status }),
      }))!;
      const left = new Set(
        (
          await db.query<{ id: string }>(
            "SELECT id FROM time_blocks WHERE id = ANY($1::uuid[])",
            [sessions.map((s) => s.id)],
          )
        ).rows.map((r) => r.id),
      );
      const cleared = sessions.filter((s) => !left.has(s.id));
      if (cleared.length)
        undo.push({
          op: "blocks.restore",
          blocks: cleared.map((s) => ({
            id: s.id,
            item_id: s.item_id,
            start_at: s.start_at.toISOString(),
            end_at: s.end_at.toISOString(),
            source: s.source,
            plan_id: s.plan_id,
          })),
        });
      undo.push({
        op: "item.restore",
        id: item.id,
        version: item.version,
        fields: {
          status: row.status,
          due_at: when(row.due_at),
          end_at: when(row.end_at),
          progress: row.progress,
        },
        spent_minutes: row.spent_minutes,
      });
      done.push(
        itemEntry(
          item,
          t.done
            ? row.rrule
              ? "Completed this occurrence"
              : "Completed"
            : "Reopened",
        ),
      );
    }
    return finishWrite(ctx, "Completing tasks", {
      done,
      review,
      reviewSummary: `${review.length === 1 ? "Complete a task" : `Complete ${review.length} tasks`}`,
      undo,
      teamId: lastTeam,
    });
  },
});

// --- edit_checklist ----------------------------------------------------

export const editChecklist = defineCapability({
  name: "edit_checklist",
  title: "Edit a task's checklist",
  description:
    "Adds, ticks, unticks, renames or moves (position 0 is the top) checklist steps on one task (step ids from fetch); progress is worked out again. Removing steps goes through propose_changes.",
  input: z
    .object({
      task: z.string().trim().min(1).max(300),
      add: z.array(z.string().trim().min(1).max(500)).max(50).optional(),
      tick: z.array(idField).max(100).optional(),
      untick: z.array(idField).max(100).optional(),
      rename: z
        .array(
          z
            .object({ id: idField, title: z.string().trim().min(1).max(500) })
            .strict(),
        )
        .max(100)
        .optional(),
      move: z
        .array(
          z
            .object({
              id: idField,
              position: z.number().int().min(0).max(1000),
            })
            .strict(),
        )
        .max(100)
        .optional(),
      client_ref: clientRefInput,
    })
    .strict()
    .refine(
      (e) =>
        e.add?.length ||
        e.tick?.length ||
        e.untick?.length ||
        e.rename?.length ||
        e.move?.length,
      { message: "Add, tick, untick, rename or move at least one step." },
    ),
  output: writeOutput,
  annotations: EDITS,
  access: "write",
  toolset: "core",
  mode: "write",
  tier: "W2",
  async run(ctx, a) {
    refuseSecrets(...(a.add ?? []), ...(a.rename ?? []).map((r) => r.title));
    const row = await visibleItem(ctx, a.task);
    const where = destination(ctx, row.team_id, row.team_id ? "W2" : "W1", [], {
      owner: row,
    });
    if (where === "review")
      return finishWrite(ctx, "Editing the checklist", {
        done: [],
        review: [
          {
            type: "checklist.edit",
            item_id: row.id,
            title: row.title,
            team_id: row.team_id,
            add: a.add ?? [],
            tick: a.tick ?? [],
            untick: a.untick ?? [],
            rename: a.rename ?? [],
            move: a.move ?? [],
          },
        ],
        reviewSummary: `Change the checklist of “${cleanTitle(row.title)}”`,
        teamId: row.team_id,
      });
    const { before } = await editSteps(
      dbOf(ctx),
      actorOf(ctx.principal),
      row.id,
      a,
    );
    const now = await lockItem(dbOf(ctx), row.id);
    return finishWrite(ctx, "Editing the checklist", {
      done: [itemEntry(now, "Checklist changed")],
      undo: [{ op: "steps.restore", item_id: row.id, steps: before }],
      teamId: row.team_id,
    });
  },
});
