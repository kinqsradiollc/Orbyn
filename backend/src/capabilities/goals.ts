import { z } from "zod";
import { goalInput, goalUpdate, weekdayOf, type Goal } from "@orbyn/core";
import {
  deleteGoal,
  goalWeekStart,
  listGoalCheckins,
  listGoals,
  readGoal,
  saveGoal,
  saveGoalCheckin,
} from "../modules/assistant-workspace/goals.js";
import {
  clientRefInput,
  destination,
  EDITS,
  finishWrite,
  writeOutput,
} from "./write.js";
import { CapabilityError, defineCapability } from "./registry.js";
import { goalFields, type UndoOp } from "./undo.js";

const input = z
  .object({
    action: z.enum(["list", "read", "create", "update", "delete", "checkin"]),
    id: z.uuid().optional(),
    goal: goalInput.optional(),
    changes: goalUpdate.optional(),
    summary: z.string().trim().min(1).max(2000).optional(),
    progress: z.record(z.string(), z.unknown()).optional(),
    week_of: z.iso.date().optional(),
    client_ref: clientRefInput,
  })
  .strict();

const output = z.object({
  status: z.enum(["ok", "done", "pending_review"]),
  goals: z.array(z.unknown()),
  goal: z.unknown().nullable(),
  checkins: z.array(z.unknown()),
  pending: writeOutput.shape.pending.optional(),
});

const notFound = () =>
  new CapabilityError(
    "NOT_FOUND",
    "Goal not found.",
    "List the goals and use an id from the results.",
  );

export const manageGoals = defineCapability({
  name: "manage_goals",
  title: "Manage goals",
  description:
    "List, read, create, update or complete your private goals. Personal only. Each goal can have a target, its own Agent plan note, an optional project, and weekly check-ins. Use a visible Orbyn project and a private Agent note for its plan. An active goal gets a weekly check-in that Orbyn's own assistant runs, so a connection that asks first or only suggests sends creates and updates to the person's Review inbox.",
  input,
  output,
  annotations: EDITS,
  access: "write",
  toolset: "core",
  mode: "write",
  tier: "W2",
  async run(ctx, args) {
    if (!ctx.principal.personal)
      throw new CapabilityError(
        "FORBIDDEN",
        "Goals are private to Personal; this connection needs Personal access.",
        "Ask the person to give this connection Personal access.",
      );
    const db = ctx.db;
    const userId = ctx.principal.user.id;
    if (args.action === "list") {
      const goals = await listGoals(db, userId, true);
      return {
        structured: { status: "ok" as const, goals, goal: null, checkins: [] },
        markdown: goals.length
          ? goals
              .map(
                (goal) =>
                  `- ${goal.title} (${goal.status})${goal.target ? ` — ${goal.target}` : ""}`,
              )
              .join("\n")
          : "No goals yet.",
        targets: goals.map((goal) => `goal:${goal.id}`),
      };
    }
    if (args.action === "read" || args.action === "checkin") {
      const id = args.id;
      if (!id) throw new Error("Choose a goal id.");
      const goal = await readGoal(db, userId, id, true);
      if (!goal) throw new Error("Goal not found.");
      const checkins = await listGoalCheckins(db, userId, id, true);
      if (args.action === "read")
        return {
          structured: { status: "ok" as const, goals: [], goal, checkins },
          markdown: `${goal.title}${goal.target ? `\nTarget: ${goal.target}` : ""}${checkins.length ? `\nLatest check-in: ${checkins[0].summary}` : "\nNo check-ins yet."}`,
          targets: [`goal:${goal.id}`],
        };
      if (!args.summary) throw new Error("Add a short check-in summary.");
      const weekOf = args.week_of ?? (await goalWeekStart(db, userId));
      if (weekdayOf(weekOf) !== 1)
        throw new Error("Choose the Monday that begins the check-in week.");
      const was = (
        await db.query<{ summary: string; progress: Record<string, unknown> }>(
          `SELECT summary, progress FROM goals_checkins
            WHERE goal_id = $1 AND user_id = $2 AND week_of = $3::date`,
          [id, userId, weekOf],
        )
      ).rows[0];
      await saveGoalCheckin(db, {
        userId,
        goalId: id,
        weekOf,
        summary: args.summary,
        progress: args.progress ?? {},
        assistantVisible: true,
      });
      return {
        structured: {
          status: "done" as const,
          goals: [],
          goal,
          checkins: await listGoalCheckins(db, userId, id, true),
        },
        markdown: `Saved this week's check-in for ${goal.title}.`,
        targets: [`goal:${goal.id}`],
        write: {
          outcome: "ok",
          counts: { "updated:goal": 1 } as Record<string, number>,
          undo: [
            {
              op: "goal_checkin.restore",
              goal_id: goal.id,
              week_of: weekOf,
              summary: args.summary,
              was: was
                ? { summary: was.summary, progress: was.progress ?? {} }
                : null,
            } satisfies UndoOp,
          ],
        },
      };
    }
    const id = args.id;
    if (args.action === "delete") {
      if (!id) throw new Error("Choose a goal id.");
      const goal = await readGoal(db, userId, id, true);
      if (!goal) throw notFound();
      const checkins = await listGoalCheckins(db, userId, id, true);
      await deleteGoal(db, userId, id, true);
      return {
        structured: {
          status: "done" as const,
          goals: [],
          goal: null,
          checkins: [],
        },
        markdown: `Deleted the goal ${goal.title}.`,
        targets: [`goal:${goal.id}`],
        write: {
          outcome: "ok",
          counts: { "removed:goal": 1 } as Record<string, number>,
          undo: [
            {
              op: "goal.recreate",
              id: goal.id,
              fields: goalFields(goal),
              checkins: checkins
                .filter((c) => c.status === "done")
                .map((c) => ({
                  week_of: c.week_of,
                  summary: c.summary,
                  progress: c.progress,
                })),
            } satisfies UndoOp,
          ],
        },
      };
    }
    const isCreate = args.action === "create";
    if (isCreate && !args.goal)
      throw new Error("Add the goal fields to create it.");
    if (!isCreate && (!id || !args.changes))
      throw new Error("Choose a goal and the fields to update.");
    const current: Goal | null = isCreate
      ? null
      : await readGoal(db, userId, id!, true);
    if (!isCreate && !current) throw notFound();
    const after = goalInput.parse(
      isCreate ? args.goal : { ...goalFields(current!), ...args.changes },
    );
    // Goals start weekly check-ins that Orbyn's assistant runs: a
    // connection that asks first or only suggests sends them to Review.
    if (destination(ctx, null, "W2") === "review")
      return finishWrite(
        ctx,
        isCreate ? "Creating a goal" : "Changing a goal",
        {
          done: [],
          review: [
            {
              type: "goal.save",
              title: after.title,
              team_id: null,
              goal_id: current?.id ?? null,
              goal: after,
              before: current ? goalFields(current) : null,
            },
          ],
          reviewSummary: `${isCreate ? "New goal" : "Change the goal"}: ${after.title}`,
        },
      ).then((answer) => ({
        ...answer,
        structured: {
          status: "pending_review" as const,
          goals: [],
          goal: null,
          checkins: [],
          pending: answer.structured.pending,
        },
      }));
    const goal = await saveGoal(db, userId, current?.id ?? null, after, true);
    return {
      structured: { status: "done" as const, goals: [], goal, checkins: [] },
      markdown: `${isCreate ? "Created" : "Updated"} the goal ${goal.title}.`,
      targets: [`goal:${goal.id}`],
      write: {
        outcome: "ok",
        counts: { [`${isCreate ? "added" : "updated"}:goal`]: 1 } as Record<
          string,
          number
        >,
        undo: [
          current
            ? ({
                op: "goal.restore",
                id: goal.id,
                expect: goalFields(goal),
                fields: goalFields(current),
              } satisfies UndoOp)
            : ({
                op: "goal.delete",
                id: goal.id,
                expect: goalFields(goal),
              } satisfies UndoOp),
        ],
      },
    };
  },
});
