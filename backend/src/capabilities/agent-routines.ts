import { z } from "zod";
import { agentRoutineInput, agentRoutineUpdate } from "@orbyn/core";
import {
  deleteAgentRoutine,
  listAgentRoutines,
  saveAgentRoutine,
} from "../modules/assistant-workspace/routines.js";
import { clientRefInput, EDITS } from "./write.js";
import { defineCapability } from "./registry.js";

const input = z
  .object({
    action: z.enum(["list", "create", "update", "pause", "resume", "delete"]),
    id: z.uuid().optional(),
    routine: agentRoutineInput.optional(),
    changes: agentRoutineUpdate.optional(),
    client_ref: clientRefInput,
  })
  .strict();

const output = z.object({
  status: z.enum(["ok", "done"]),
  routines: z.array(z.unknown()),
  routine: z.unknown().nullable(),
});

export const manageAgentRoutines = defineCapability({
  name: "manage_agent_routines",
  title: "Manage assistant routines",
  description:
    "List, create, update, pause, resume or delete recurring instructions for Orbyn's built-in assistant. Use a supported time zone, an RRULE such as FREQ=WEEKLY;BYDAY=MO, and the next local run time. Each due run goes through the assistant and follows the saved approval scope.",
  input,
  output,
  annotations: EDITS,
  access: "write",
  toolset: "core",
  mode: "write",
  tier: "W2",
  async run(ctx, args) {
    const userId = ctx.principal.user.id;
    if (args.action === "list") {
      const routines = await listAgentRoutines(ctx.db, userId);
      return {
        structured: { status: "ok" as const, routines, routine: null },
        markdown: routines.length
          ? routines
              .map(
                (routine) =>
                  `- ${routine.instruction} (${routine.paused ? "paused" : routine.next_run_at})`,
              )
              .join("\n")
          : "No assistant routines yet.",
        targets: routines.map((routine) => `routine:${routine.id}`),
      };
    }
    if (args.action === "delete") {
      if (!args.id) throw new Error("Choose a routine id.");
      const before = (await listAgentRoutines(ctx.db, userId)).find(
        (routine) => routine.id === args.id,
      );
      if (!before) throw new Error("Assistant routine not found.");
      await deleteAgentRoutine(ctx.db, userId, args.id);
      return {
        structured: { status: "done" as const, routines: [], routine: null },
        markdown: "Deleted the assistant routine.",
        targets: [`routine:${args.id}`],
        write: { outcome: "ok", counts: { "removed:routine": 1 } },
      };
    }
    const isCreate = args.action === "create";
    if (args.action === "pause") {
      if (!args.id) throw new Error("Choose a routine id.");
      args.changes = { ...(args.changes ?? {}), paused: true };
    }
    if (args.action === "resume") {
      if (!args.id) throw new Error("Choose a routine id.");
      args.changes = { ...(args.changes ?? {}), paused: false };
    }
    if (isCreate && !args.routine)
      throw new Error("Add the routine fields to create it.");
    if (!isCreate && (!args.id || !args.changes))
      throw new Error("Choose a routine and the fields to update.");
    const routine = await saveAgentRoutine(
      ctx.db,
      userId,
      isCreate ? null : args.id!,
      isCreate ? args.routine : args.changes,
    );
    return {
      structured: { status: "done" as const, routines: [], routine },
      markdown: `${isCreate ? "Created" : args.action === "resume" ? "Resumed" : routine.paused ? "Paused" : "Updated"} the assistant routine.`,
      targets: [`routine:${routine.id}`],
      write: {
        outcome: "ok",
        counts: { [`${isCreate ? "added" : "updated"}:routine`]: 1 },
      },
    };
  },
});
