import {
  HttpError,
  dayTime,
  clockMinutes,
  itemBody,
  zonedParts,
  localDateKey,
  addDays,
  type ReminderNudgeCard,
} from "@orbyn/core";
import type { OrbynClient } from "./client.js";

export type ReminderActionReceipt = {
  message: string;
  undo: () => Promise<void>;
};
export type ReminderActionOptions = {
  day?: string;
  minutes?: number;
  chatId?: string;
  turnId?: string;
};

/** Run a card's explicit choice through the ordinary personal work endpoints, without AI. */
export async function performReminderAction(
  client: OrbynClient,
  card: ReminderNudgeCard,
  action: ReminderNudgeCard["actions"][number],
  options: ReminderActionOptions = {},
): Promise<ReminderActionReceipt> {
  if (!card.actions.includes(action))
    throw new HttpError(422, "This reminder does not offer that action.");
  if (action === "skip") {
    if (!options.chatId || !options.turnId)
      throw new HttpError(422, "Open this reminder in its chat first.");
    const chatId = options.chatId,
      turnId = options.turnId;
    await client.updateAiChat(chatId, {
      turn_id: turnId,
      outcome: "discarded",
    });
    return {
      message: "Skipped this reminder.",
      undo: async () => {
        await client.updateAiChat(chatId, { turn_id: turnId, outcome: "info" });
      },
    };
  }
  if ((action === "move" || action === "book") && !options.day)
    throw new HttpError(422, "Choose a day first.");
  if (
    options.day &&
    (!/^\d{4}-\d{2}-\d{2}$/.test(options.day) ||
      Number.isNaN(Date.parse(`${options.day}T12:00:00Z`)) ||
      new Date(`${options.day}T12:00:00Z`).toISOString().slice(0, 10) !==
        options.day)
  )
    throw new HttpError(422, "Choose a valid day.");
  const prefs = action === "move" ? await client.getPlannerPrefs() : null;
  const dueAt =
    prefs && options.day
      ? dayTime(
          options.day,
          clockMinutes(prefs.work_end),
          prefs.timezone,
        ).toISOString()
      : null;
  if (card.entity_kind === "task") {
    const before = await client.getItem(card.entity_id);
    if (action === "book") {
      const block = await client.createBlockOnDay({
        item_id: before.id,
        day: options.day!,
        minutes: options.minutes ?? 30,
      });
      return {
        message: "Booked time.",
        undo: async () => {
          const current = (await client.itemSessions(before.id)).sessions.find(
            (row) => row.id === block.id,
          );
          if (
            !current ||
            current.started_at ||
            current.outcome ||
            current.start_at !== block.start_at ||
            current.end_at !== block.end_at
          )
            throw new HttpError(
              409,
              "This session changed since you booked it. Open it to review.",
            );
          await client.deleteBlock(block.id);
        },
      };
    }
    let movedDue = dueAt;
    let movedEnd = before.end_at;
    if (action === "move" && prefs && options.day) {
      const zone = before.timezone || prefs.timezone;
      const old = before.due_at
        ? zonedParts(new Date(before.due_at), zone)
        : null;
      movedDue = dayTime(
        options.day,
        before.all_day
          ? 0
          : old
            ? old.hour * 60 + old.minute
            : clockMinutes(prefs.work_end),
        zone,
      ).toISOString();
      if (before.end_at && before.due_at) {
        const oldDay = localDateKey(new Date(before.due_at), zone);
        const delta = Math.round(
          (Date.parse(`${options.day}T12:00:00Z`) -
            Date.parse(`${oldDay}T12:00:00Z`)) /
            86400000,
        );
        const end = zonedParts(new Date(before.end_at), zone);
        movedEnd = dayTime(
          addDays(localDateKey(new Date(before.end_at), zone), delta),
          end.hour * 60 + end.minute,
          zone,
        ).toISOString();
      }
    }
    const after = await client.updateItem(before.id, {
      ...itemBody(before),
      ...(action === "done"
        ? { status: "done" as const }
        : { due_at: movedDue, end_at: movedEnd }),
    });
    return {
      message: action === "done" ? "Marked done." : "Moved the deadline.",
      undo: async () => {
        await client.updateItem(before.id, {
          ...itemBody(before),
          version: after.version,
        });
      },
    };
  }
  if (card.entity_kind === "record" && action !== "book") {
    const before = await client.getWorkRecord(card.entity_id);
    const after = await client.updateWorkRecord(before.id, {
      version: before.version,
      ...(action === "done" ? { status: "done" as const } : { due_at: dueAt }),
    });
    return {
      message:
        action === "done"
          ? "Marked the promise done."
          : "Moved the promise date.",
      undo: async () => {
        await client.updateWorkRecord(before.id, {
          version: after.version,
          ...(action === "done"
            ? { status: before.status }
            : { due_at: before.due_at }),
        });
      },
    };
  }
  if (card.entity_kind === "routine" && action === "move") {
    const before = (await client.listAgentRoutines()).find(
      (row) => row.id === card.entity_id,
    );
    if (!before) throw new HttpError(404, "Routine not found.");
    const after = await client.updateAgentRoutine(before.id, {
      next_run_at: dueAt!,
    });
    return {
      message: "Moved the next routine run.",
      undo: async () => {
        const current = (await client.listAgentRoutines()).find(
          (row) => row.id === before.id,
        );
        if (current?.updated_at !== after.updated_at)
          throw new HttpError(
            409,
            "This routine has changed. Open it to review.",
          );
        await client.updateAgentRoutine(before.id, {
          next_run_at: before.next_run_at,
        });
      },
    };
  }
  throw new HttpError(422, "Open this work to make that change.");
}
