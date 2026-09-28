import { z } from "zod";
import { goalInput, goalUpdate, weekdayOf } from "@orbyn/core";
import {
  deleteGoal,
  goalWeekStart,
  listGoalCheckins,
  listGoals,
  readGoal,
  saveGoal,
  saveGoalCheckin,
} from "../modules/assistant-workspace/goals.js";
import { clientRefInput, EDITS } from "./write.js";
import { defineCapability } from "./registry.js";

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
  status: z.enum(["ok", "done"]),
  goals: z.array(z.unknown()),
  goal: z.unknown().nullable(),
  checkins: z.array(z.unknown()),
});

export const manageGoals = defineCapability({
  name: "manage_goals",
  title: "Manage goals",
  description:
    "List, read, create, update or complete your private goals. Each goal can have a target, its own Agent plan note, an optional project, and weekly check-ins. Use a visible Orbyn project and a private Agent note for its plan.",
  input,
  output,
  annotations: EDITS,
  access: "write",
  toolset: "core",
  mode: "write",
  tier: "W2",
  async run(ctx, args) {
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
        },
      };
    }
    const id = args.id;
    if (args.action === "delete") {
      if (!id) throw new Error("Choose a goal id.");
      const goal = await readGoal(db, userId, id, true);
      if (!goal) throw new Error("Goal not found.");
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
        },
      };
    }
    const isCreate = args.action === "create";
    if (isCreate && !args.goal)
      throw new Error("Add the goal fields to create it.");
    if (!isCreate && (!id || !args.changes))
      throw new Error("Choose a goal and the fields to update.");
    const goal = await saveGoal(
      db,
      userId,
      isCreate ? null : id!,
      isCreate ? args.goal : args.changes,
      true,
    );
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
      },
    };
  },
});
