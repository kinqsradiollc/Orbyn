import { z } from "zod";
import {
  agentRoutineInput,
  agentRoutineUpdate,
  type AgentRoutine,
} from "@orbyn/core";
import {
  deleteAgentRoutine,
  listAgentRoutines,
  readAgentRoutine,
  routineFields,
  saveAgentRoutine,
} from "../modules/assistant-workspace/routines.js";
import {
  clientRefInput,
  destination,
  EDITS,
  finishWrite,
  writeOutput,
} from "./write.js";
import {
  CapabilityError,
  defineCapability,
  type CapabilityContext,
} from "./registry.js";
import type { UndoOp } from "./undo.js";

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
  status: z.enum(["ok", "done", "pending_review"]),
  routines: z.array(z.unknown()),
  routine: z.unknown().nullable(),
  pending: writeOutput.shape.pending.optional(),
});

/** What puts a routine back as it was (undo of a change made directly). */
const restoreOp = (before: AgentRoutine, after: AgentRoutine): UndoOp => ({
  op: "routine.restore",
  id: before.id,
  expect: routineFields(after),
  fields: routineFields(before),
});

/**
 * Whether a change that makes a routine run (or run something else) may be
 * made directly: only by the person themselves, or by the built-in
 * assistant once they said yes. An outside agent's routine runs as the
 * full-power assistant and spends Orbyn's hosted AI, so it always waits for
 * the person in Review.
 */
function routeOf(ctx: CapabilityContext): "direct" | "review" {
  const via = ctx.principal.via;
  if (via === "session") return "direct";
  if (via === "assistant")
    return destination(ctx, null, "W2", [], {
      asks: "profile",
      why: "it sets what Orbyn's assistant runs on its own",
    });
  return "review";
}

export const manageAgentRoutines = defineCapability({
  name: "manage_agent_routines",
  title: "Manage assistant routines",
  description:
    "List, create, update, pause, resume or delete recurring instructions for Orbyn's built-in assistant. Personal only. Use a supported time zone, an RRULE such as FREQ=WEEKLY;BYDAY=MO, and the next local run time. Each run is Orbyn's assistant working on its own, so creating, changing or resuming a routine always waits for the person's approval in Review; pausing and deleting happen at once.",
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
        "Assistant routines are private to Personal; this connection needs Personal access.",
        "Ask the person to give this connection Personal access.",
      );
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
    const current = args.id
      ? await readAgentRoutine(ctx.db, userId, args.id)
      : null;
    if (args.action !== "create") {
      if (!args.id)
        throw new CapabilityError("INVALID", "Choose a routine id.");
      if (!current)
        throw new CapabilityError(
          "NOT_FOUND",
          "Assistant routine not found.",
          "List the routines and use an id from the results.",
        );
    }
    if (args.action === "delete") {
      // Removing a routine only lessens what runs: made at once, undoable.
      await deleteAgentRoutine(ctx.db, userId, current!.id);
      return {
        structured: { status: "done" as const, routines: [], routine: null },
        markdown: "Deleted the assistant routine.",
        targets: [`routine:${current!.id}`],
        write: {
          outcome: "ok" as const,
          counts: { "removed:routine": 1 },
          undo: [
            {
              op: "routine.recreate",
              id: current!.id,
              fields: routineFields(current!),
            } satisfies UndoOp,
          ],
        },
      };
    }
    if (args.action === "pause") {
      const routine = await saveAgentRoutine(ctx.db, userId, current!.id, {
        paused: true,
      });
      return {
        structured: { status: "done" as const, routines: [], routine },
        markdown: "Paused the assistant routine.",
        targets: [`routine:${routine.id}`],
        write: {
          outcome: "ok" as const,
          counts: { "updated:routine": 1 },
          undo: [restoreOp(current!, routine)],
        },
      };
    }

    // create, update and resume change what the assistant runs.
    const isCreate = args.action === "create";
    if (isCreate && !args.routine)
      throw new CapabilityError(
        "INVALID",
        "Add the routine fields to create it.",
      );
    const changes =
      args.action === "resume"
        ? { ...(args.changes ?? {}), paused: false }
        : args.changes;
    if (!isCreate && !changes)
      throw new CapabilityError(
        "INVALID",
        "Choose a routine and the fields to update.",
      );
    const after = isCreate
      ? agentRoutineInput.parse(args.routine)
      : agentRoutineInput.parse({ ...routineFields(current!), ...changes });
    try {
      new Intl.DateTimeFormat("en", { timeZone: after.timezone });
    } catch {
      throw new CapabilityError("INVALID", "Choose a supported time zone.");
    }

    if (routeOf(ctx) === "review") {
      const title = after.instruction.slice(0, 120);
      return finishWrite(
        ctx,
        isCreate
          ? "Creating an assistant routine"
          : "Changing an assistant routine",
        {
          done: [],
          review: [
            {
              type: "routine.save",
              title,
              team_id: null,
              routine_id: current?.id ?? null,
              routine: after,
              before: current ? routineFields(current) : null,
            },
          ],
          reviewSummary: `${isCreate ? "New" : args.action === "resume" ? "Resume" : "Change"} assistant routine: ${title}`,
        },
      ).then((answer) => ({
        ...answer,
        structured: {
          status: "pending_review" as const,
          routines: [],
          routine: null,
          pending: answer.structured.pending,
        },
      }));
    }

    const routine = await saveAgentRoutine(
      ctx.db,
      userId,
      current?.id ?? null,
      after,
    );
    return {
      structured: { status: "done" as const, routines: [], routine },
      markdown: `${isCreate ? "Created" : args.action === "resume" ? "Resumed" : "Updated"} the assistant routine.`,
      targets: [`routine:${routine.id}`],
      write: {
        outcome: "ok" as const,
        counts: { [`${isCreate ? "added" : "updated"}:routine`]: 1 },
        undo: [
          current
            ? restoreOp(current, routine)
            : ({
                op: "routine.delete",
                id: routine.id,
                expect: routineFields(routine),
              } satisfies UndoOp),
        ],
      },
    };
  },
});
