import { createHash } from "node:crypto";
import {
  actionSchema,
  addDays,
  dayTime,
  fail,
  localDateKey,
  DEFAULT_STAGES,
  type ProjectDraft,
  type ProjectDecomposition,
  type Proposal,
} from "@orbyn/core";
import type { Db, Queryable } from "../../db/pool.js";
import type { UserRow } from "../../lib/auth.js";
import { loadPrefs, busyIntervals } from "../planner/calendar.js";
import { loadFrames } from "../planner/frames.js";
import { mutate } from "../items/service.js";
import { scheduleProjectDraft } from "./project-schedule.js";
import { parseProjectDraft } from "./project-draft.js";

export type StoredProject = ProjectDecomposition & { fingerprint: string };

/** A fixed date range is retained so approval cannot silently move the plan. */
async function snapshot(
  db: Queryable,
  userId: string,
  timezone: string,
  start: string,
  days: number,
) {
  const [prefs, frames, busy] = await Promise.all([
    loadPrefs(db, userId),
    loadFrames(db, userId),
    busyIntervals(
      db,
      userId,
      dayTime(start, 0, timezone),
      dayTime(addDays(start, days), 0, timezone),
    ),
  ]);
  const fingerprint = createHash("sha256")
    .update(
      JSON.stringify({
        prefs,
        frames,
        busy: [...busy].sort(
          (a, b) =>
            a.start_at.localeCompare(b.start_at) ||
            a.end_at.localeCompare(b.end_at),
        ),
      }),
    )
    .digest("hex");
  return { prefs, frames, busy, fingerprint };
}

/** Dependencies are injectable for isolated persistence and stale-preview tests. */
export type ProjectProposalServices = {
  snapshot: typeof snapshot;
  mutate: typeof mutate;
};
const services: ProjectProposalServices = { snapshot, mutate };

/** Store only the reviewable proposal. All domain writes wait for approval. */
export async function proposeProject(
  db: Queryable,
  userId: string,
  draft: ProjectDraft,
  timezone: string,
  now = new Date(),
  dependencies: ProjectProposalServices = services,
  details: { summary?: string; deadline?: string | null } = {},
): Promise<Proposal> {
  const start = localDateKey(now, timezone);
  const days = Math.min(
    30,
    Math.max(7, ...draft.tasks.map((t) => t.due_in_days + 1)),
  );
  const { prefs, frames, busy, fingerprint } = await dependencies.snapshot(
    db,
    userId,
    timezone,
    start,
    days,
  );
  const scheduled = scheduleProjectDraft(draft, {
    days: Array.from({ length: days }, (_, i) => addDays(start, i)),
    timezone,
    now,
    busy,
    frames,
    useFrames: true,
    workDays: prefs.work_days,
    workStart: prefs.work_start,
    workEnd: prefs.work_end,
    padPercent: prefs.pad_percent,
    split: true,
    splitAfterMinutes: prefs.split_after_minutes,
    minBlockMinutes: prefs.min_block_minutes,
    breakLevel: prefs.break_level,
  });
  const project: ProjectDecomposition = {
    ...draft,
    summary: details.summary ?? draft.summary,
    deadline: details.deadline ?? null,
    ...scheduled,
    timezone,
    start_date: start,
    days,
  };
  const actions = draft.tasks.map((t) =>
    actionSchema.parse({
      operation: "create",
      data: {
        title: t.title,
        notes: t.notes,
        kind: "task",
        estimate_minutes: t.estimate_minutes,
        due_at: dayTime(
          addDays(start, t.due_in_days + 1),
          0,
          timezone,
        ).toISOString(),
      },
    }),
  );
  const row = (
    await db.query<{ id: string }>(
      "INSERT INTO proposals(user_id,actions,project) VALUES($1,$2,$3) RETURNING id",
      [
        userId,
        JSON.stringify(actions),
        JSON.stringify({ ...project, fingerprint }),
      ],
    )
  ).rows[0];
  return {
    id: row.id,
    summary: `**${draft.title}** — ${draft.tasks.length} tasks and ${scheduled.blocks.length} scheduled sessions to review.`,
    actions,
    project,
    plan: null,
    follow_ups: [],
  };
}

/**
 * Apply inside the caller's locked, idempotent proposal transaction. Recheck
 * the reviewed calendar before writing anything; never silently reschedule.
 */
export async function applyProject(
  db: Db,
  user: UserRow,
  stored: StoredProject,
  now = new Date(),
  dependencies: ProjectProposalServices = services,
  giveTasksDeadlines = true,
) {
  const draft = parseProjectDraft(
    JSON.stringify({ title: stored.title, tasks: stored.tasks }),
  );
  const fresh = await dependencies.snapshot(
    db,
    user.id,
    stored.timezone,
    stored.start_date,
    stored.days,
  );
  if (
    fresh.fingerprint !== stored.fingerprint ||
    stored.blocks.some((b) => Date.parse(b.start_at) < now.getTime())
  )
    fail(
      409,
      "The calendar or planning settings changed. Draft this project again to review a fresh schedule.",
    );
  // Project history names who made it (the project and its stages are written
  // before any task, which would otherwise set this).
  await db.query("SELECT set_config('orbyn.user_id', $1, true)", [user.id]);
  // Started for a team: the project and its tasks are the team's.
  const teamId = stored.team_id ?? null;
  const projectId = (
    await db.query<{ id: string }>(
      "INSERT INTO projects(user_id,team_id,name,summary,deadline) VALUES($1,$2,$3,$4,$5) RETURNING id",
      [
        user.id,
        teamId,
        draft.title,
        stored.summary ?? "",
        stored.deadline ?? null,
      ],
    )
  ).rows[0].id;
  let firstStage: string | null = null;
  for (const [position, name] of DEFAULT_STAGES.entries()) {
    const stage = (
      await db.query<{ id: string }>(
        "INSERT INTO project_stages(project_id,name,position) VALUES($1,$2,$3) RETURNING id",
        [projectId, name, position],
      )
    ).rows[0];
    firstStage ??= stage.id;
  }
  const ids = new Map<string, string>();
  for (const task of draft.tasks) {
    const made = await dependencies.mutate(
      db,
      user,
      actionSchema.parse({
        operation: "create",
        data: {
          title: task.title,
          notes: task.notes,
          kind: "task",
          project_id: projectId,
          stage_id: firstStage,
          team_id: teamId,
          estimate_minutes: task.estimate_minutes,
          // A key result: a number to reach, starting from nothing.
          ...(stored.measures?.[task.id]
            ? {
                target_value: stored.measures[task.id].target_value,
                current_value: 0,
                value_unit: stored.measures[task.id].value_unit,
              }
            : {}),
          due_at: giveTasksDeadlines
            ? dayTime(
                addDays(stored.start_date, task.due_in_days + 1),
                0,
                stored.timezone,
              ).toISOString()
            : null,
        },
      }),
    );
    if (!made) throw new Error("Project subtask was not created");
    ids.set(task.id, made.id);
    for (const prerequisite of task.depends_on)
      await db.query(
        "INSERT INTO item_dependencies(item_id,prerequisite_id) VALUES($1,$2)",
        [made.id, ids.get(prerequisite)!],
      );
  }
  for (const block of stored.blocks) {
    const id = ids.get(block.item_id);
    if (!id) throw new Error("Schedule references an unknown subtask");
    await db.query(
      "INSERT INTO time_blocks(item_id,user_id,start_at,end_at,source) VALUES($1,$2,$3,$4,'planner')",
      [id, user.id, block.start_at, block.end_at],
    );
  }
  // A typed brief becomes the project's page; a template's page takes priority.
  const page =
    stored.page ??
    (stored.summary?.trim()
      ? {
          title: `${draft.title} brief`,
          content: [
            { type: "paragraph" as const, text: stored.summary.trim() },
          ],
        }
      : null);
  if (page) {
    const doc = (
      await db.query<{ id: string }>(
        `INSERT INTO docs (user_id, team_id, title, kind, content, project_id)
         VALUES ($1, $2, $3, 'doc', $4, $5) RETURNING id`,
        [
          user.id,
          teamId,
          page.title || draft.title,
          JSON.stringify(page.content),
          projectId,
        ],
      )
    ).rows[0];
    await db.query("UPDATE projects SET doc_id = $2 WHERE id = $1", [
      projectId,
      doc.id,
    ]);
  }
  return { project_id: projectId };
}
