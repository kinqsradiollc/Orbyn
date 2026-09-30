import { z } from "zod";
import {
  fail,
  reminderNudgeCard,
  itemData,
  blockOnDayInput,
  habitApplyInput,
  habitPlanInput,
  habitCheckInInput,
  workRecordUpdate,
  updateAiChatInput,
  type ReminderNudgeCard,
} from "@orbyn/core";
import {
  performLocalReminderAction,
  type ReminderActionClient,
} from "@orbyn/api-client";
import type { FastifyInstance } from "fastify";
import { pool, transaction, type Db } from "../../db/pool.js";
import { firstParty } from "../proposals/service.js";
import type { UserRow } from "../../lib/auth.js";
import { idParam, writeRateLimit } from "../../lib/params.js";
import { assistantSourceVisible } from "../../lib/assistant-source-visibility.js";
import { visibleItems } from "../../lib/visibility.js";
import { assistantChatVisible } from "../../lib/assistant-visibility.js";
import {
  itemDetail,
  loadItem,
  requireItemAccess,
  mutate,
  via,
} from "../items/service.js";
import { addSession, removeSession } from "../planner/blocks.js";
import { itemSessions } from "../planner/sessions.js";
import { loadPrefs } from "../planner/calendar.js";
import { readRecord, updateRecord } from "../work-records/service.js";
import { listGoals, saveGoal, goalWork } from "./goals.js";
import { listAgentRoutines, saveAgentRoutine } from "./routines.js";
import { listComments, resolveComment } from "../docs/comments.js";
import {
  habitPlan,
  applyHabitPlan,
  deleteHabitBlock,
  checkInHabitBlock,
} from "../planner/routines.js";
import {
  studyOverview,
  planRevision,
  applyRevision,
} from "../study/service.js";
import { updateChatInTransaction } from "../ai/chats.js";

const inputSchema = z
  .object({
    card: reminderNudgeCard,
    action: z.enum(["done", "move", "skip", "book"]),
    generation: z.number().int().nonnegative(),
    options: z
      .object({
        day: z.string().optional(),
        minutes: z.number().int().min(1).max(1440).optional(),
        chatId: z.uuid().optional(),
        turnId: z.uuid().optional(),
      })
      .strict()
      .default({}),
  })
  .strict();
type Command = {
  method: string;
  args: unknown[];
  guard?: { chatId: string; turnId: string; turn: unknown };
};
type Receipt = {
  id: string;
  generation: number;
  message: string;
  undone_at: Date | null;
  intent: z.output<typeof inputSchema>;
  undo_command: Command;
  source_kind: string;
  source_id: string;
};
const shape = (row: Receipt) => ({
  id: row.id,
  generation: row.generation,
  message: row.message,
  undone: !!row.undone_at,
});
const writes = new Set([
  "updateItem",
  "deleteItem",
  "createBlockOnDay",
  "deleteBlock",
  "updateWorkRecord",
  "updateAgentRoutine",
  "updateGoal",
  "resolveDocComment",
  "applyHabitPlan",
  "deleteHabitBlock",
  "checkInHabitBlock",
  "applyRevision",
  "updateAiChat",
]);
const undoWrites = new Set([
  "updateItem",
  "deleteItem",
  "deleteBlock",
  "updateWorkRecord",
  "updateAgentRoutine",
  "updateGoal",
  "resolveDocComment",
  "deleteHabitBlock",
  "checkInHabitBlock",
  "updateAiChat",
]);

/** An in-process adapter shares the explicit action flow with clients without HTTP or nested transactions. */
function actionClient(db: Db, user: UserRow) {
  const client: ReminderActionClient = {
    getItem: async (id) => {
      if (
        !(
          await db.query(
            `SELECT 1 FROM items i WHERE i.id=$2 AND ${visibleItems("i", { user: "$1", ai: true })}`,
            [user.id, id],
          )
        ).rowCount
      )
        fail(404, "Item not found.");
      return itemDetail(id, via(db));
    },
    updateItem: async (id, raw) => {
      const { version, ...data } = raw;
      return (await mutate(db, user, {
        operation: "update",
        item_id: id,
        version,
        data: itemData.parse(data),
      }))!;
    },
    deleteItem: async (id, version, options) => {
      await mutate(
        db,
        user,
        { operation: "delete", item_id: id, version },
        undefined,
        options,
      );
    },
    getPlannerPrefs: () => loadPrefs(db, user.id),
    createBlockOnDay: (input) =>
      addSession(db, user.id, blockOnDayInput.parse(input)),
    itemSessions: (id) => itemSessions(db, user.id, id),
    deleteBlock: (id, revision) => removeSession(db, user.id, id, revision),
    getWorkRecord: (id) => readRecord(db, id, user),
    updateWorkRecord: (id, input) =>
      updateRecord(db, user, id, workRecordUpdate.parse(input)),
    listAgentRoutines: () => listAgentRoutines(db, user.id),
    updateAgentRoutine: (id, input) => saveAgentRoutine(db, user.id, id, input),
    goalWork: (id) => goalWork(db, user.id, id),
    listGoals: () => listGoals(db, user.id, true),
    updateGoal: (id, input) => saveGoal(db, user.id, id, input, true),
    listDocComments: (id) => listComments(db, user.id, id),
    resolveDocComment: (id, comment, resolved, revision) =>
      resolveComment(db, user, id, comment, resolved, revision),
    planHabits: (input) => habitPlan(db, user.id, habitPlanInput.parse(input)),
    applyHabitPlan: (blocks) =>
      applyHabitPlan(db, user.id, habitApplyInput.parse({ blocks })),
    deleteHabitBlock: (id, version) =>
      deleteHabitBlock(db, user.id, id, version),
    getHabitBlock: async (id) => {
      const row = (
        await db.query(
          "SELECT id,outcome,outcome_at,version FROM habit_blocks WHERE id=$1 AND user_id=$2",
          [id, user.id],
        )
      ).rows[0];
      if (!row) fail(404, "Habit session not found.");
      return row;
    },
    checkInHabitBlock: (id, input) =>
      checkInHabitBlock(db, user.id, id, habitCheckInInput.parse(input)),
    planRevision: async (input) => {
      const exam = (await studyOverview(user.id, new Date(), db)).exams.find(
        (row) => row.key === input.key,
      );
      if (!exam) fail(404, "Exam not found.");
      return planRevision(user.id, exam, input.minutes ?? 30, new Date(), db);
    },
    applyRevision: (input) => applyRevision(db, user, input),
    updateAiChat: async (id, input) => {
      await updateChatInTransaction(
        db,
        user.id,
        id,
        updateAiChatInput.parse(input),
      );
      return (
        await db.query("SELECT * FROM ai_chats WHERE id=$1 AND user_id=$2", [
          id,
          user.id,
        ])
      ).rows[0];
    },
  };
  // APIs expose ISO dates; the local adapter preserves that contract.
  return new Proxy(client, {
    get(target, key) {
      const method = Reflect.get(target, key);
      return typeof method === "function"
        ? async (...args: unknown[]) => {
            const value = await Reflect.apply(method, target, args);
            return value === undefined
              ? undefined
              : JSON.parse(JSON.stringify(value));
          }
        : method;
    },
  });
}

async function sourceAllowed(
  db: Db,
  userId: string,
  card: Pick<ReminderNudgeCard, "entity_kind" | "entity_id">,
) {
  if (
    !(
      await db.query(
        `SELECT 1 WHERE ${assistantSourceVisible("$2::text", "$3::uuid", "$1")}`,
        [userId, card.entity_kind, card.entity_id],
      )
    ).rowCount
  )
    fail(404, "This reminder source is no longer available.");
}

/** Bind a displayed card to its owned source and store a guarded Undo command with the write. */
export async function reminderActionRoutes(app: FastifyInstance) {
  app.get("/me/assistant/reminder-actions/nudges/:id", async (request) => {
    const user = await firstParty(request);
    const row = (
      await pool.query<Receipt>(
        `SELECT * FROM assistant_action_receipts WHERE user_id=$1 AND nudge_id=$2 ORDER BY generation DESC LIMIT 1`,
        [user.id, idParam(request)],
      )
    ).rows[0];
    if (!row) return null;
    return transaction(async (db) => {
      await sourceAllowed(db, user.id, {
        entity_kind: row.source_kind as ReminderNudgeCard["entity_kind"],
        entity_id: row.source_id,
      });
      return shape(row);
    });
  });
  app.post(
    "/me/assistant/reminder-actions",
    writeRateLimit,
    async (request) => {
      const user = await firstParty(request),
        input = inputSchema.parse(request.body);
      return transaction(async (db) => {
        await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
          `${user.id}:reminder:${input.card.id}`,
        ]);
        await sourceAllowed(db, user.id, input.card);
        // Existing ledger sources cannot be replaced by altered card payloads.
        const nudge = (
          await db.query(
            "SELECT * FROM assistant_nudges WHERE id=$1 AND user_id=$2",
            [input.card.id, user.id],
          )
        ).rows[0];
        if (!nudge) fail(404, "This reminder expired. Refresh your reminders.");
        if (
          nudge &&
          (nudge.entity_kind !== input.card.entity_kind ||
            nudge.entity_id !== input.card.entity_id ||
            nudge.nudge_key !== input.card.key)
        )
          fail(409, "This reminder changed. Refresh it.");
        if (input.options.chatId) {
          const row = (
            await db.query(
              `SELECT turns FROM ai_chats c WHERE c.id=$1 AND ${assistantChatVisible("c", "$2")} FOR UPDATE`,
              [input.options.chatId, user.id],
            )
          ).rows[0];
          const turn = row?.turns?.find(
            (entry: { turn_id?: string; nudge?: ReminderNudgeCard }) =>
              entry.turn_id === input.options.turnId,
          );
          if (
            !turn?.nudge ||
            !(
              await db.query("SELECT $1::jsonb=$2::jsonb AS equal", [
                JSON.stringify(turn.nudge),
                JSON.stringify(input.card),
              ])
            ).rows[0].equal
          )
            fail(409, "This reminder card changed. Refresh it.");
        }
        const latest = (
          await db.query<Receipt>(
            "SELECT * FROM assistant_action_receipts WHERE user_id=$1 AND nudge_id=$2 ORDER BY generation DESC LIMIT 1 FOR UPDATE",
            [user.id, input.card.id],
          )
        ).rows[0];
        if (latest && latest.generation === input.generation) {
          const equal = (
            await db.query("SELECT $1::jsonb=$2::jsonb AS equal", [
              JSON.stringify(latest.intent),
              JSON.stringify(input),
            ])
          ).rows[0].equal;
          if (!equal)
            fail(409, "Another choice already answered this reminder.");
          if (latest.undone_at)
            fail(
              409,
              "This choice was undone. Refresh the reminder before choosing again.",
            );
          return shape(latest);
        }
        if (
          input.generation !== (latest ? latest.generation + 1 : 0) ||
          (latest && !latest.undone_at)
        )
          fail(409, "Another device answered this reminder. Refresh it.");
        const client = actionClient(db, user);
        let capture = false;
        const commands: Command[] = [];
        const proxy = new Proxy(client, {
          get(target, key) {
            const method = Reflect.get(target, key);
            if (typeof method !== "function") return method;
            return async (...args: unknown[]) => {
              if (capture && writes.has(String(key))) {
                commands.push({ method: String(key), args });
                return undefined;
              }
              return Reflect.apply(method, target, args);
            };
          },
        });
        const result = await performLocalReminderAction(
          proxy,
          input.card,
          input.action,
          input.options,
        );
        capture = true;
        await result.undo();
        if (commands.length !== 1 || !undoWrites.has(commands[0].method))
          fail(500, "The action has no safe Undo receipt.");
        if (commands[0].method === "updateAiChat") {
          const chatId = String(commands[0].args[0]),
            turnId = input.options.turnId!;
          const turns = (
            await db.query(
              "SELECT turns FROM ai_chats WHERE id=$1 AND user_id=$2",
              [chatId, user.id],
            )
          ).rows[0].turns;
          commands[0].guard = {
            chatId,
            turnId,
            turn: turns.find(
              (entry: { turn_id?: string }) => entry.turn_id === turnId,
            ),
          };
        }
        const row = (
          await db.query<Receipt>(
            "INSERT INTO assistant_action_receipts(user_id,nudge_id,generation,intent,message,undo_command,source_kind,source_id) VALUES($1,$2,$3,$4::jsonb,$5,$6::jsonb,$7,$8) RETURNING *",
            [
              user.id,
              input.card.id,
              input.generation,
              JSON.stringify(input),
              result.message,
              JSON.stringify(commands[0]),
              input.card.entity_kind,
              input.card.entity_id,
            ],
          )
        ).rows[0];
        return shape(row);
      });
    },
  );
  app.post(
    "/me/assistant/reminder-actions/:id/undo",
    writeRateLimit,
    async (request, reply) => {
      const user = await firstParty(request);
      z.object({})
        .strict()
        .parse(request.body ?? {});
      await transaction(async (db) => {
        const row = (
          await db.query<Receipt>(
            "SELECT * FROM assistant_action_receipts WHERE id=$1 AND user_id=$2 FOR UPDATE",
            [idParam(request), user.id],
          )
        ).rows[0];
        if (!row) fail(404, "Action receipt not found.");
        await sourceAllowed(db, user.id, {
          entity_kind: row.source_kind as ReminderNudgeCard["entity_kind"],
          entity_id: row.source_id,
        });
        if (row.undone_at) return;
        const command = row.undo_command;
        if (!undoWrites.has(command.method))
          fail(409, "This older receipt cannot be undone.");
        if (command.guard) {
          const row = (
            await db.query(
              `SELECT turns FROM ai_chats c WHERE c.id=$1 AND ${assistantChatVisible("c", "$2")} FOR UPDATE`,
              [command.guard.chatId, user.id],
            )
          ).rows[0];
          const turn = row?.turns.find(
            (entry: { turn_id?: string }) =>
              entry.turn_id === command.guard!.turnId,
          );
          if (
            !turn ||
            !(
              await db.query("SELECT $1::jsonb=$2::jsonb AS equal", [
                JSON.stringify(turn),
                JSON.stringify(command.guard.turn),
              ])
            ).rows[0].equal
          )
            fail(409, "This reminder turn changed. Refresh it.");
        }
        const method = Reflect.get(actionClient(db, user), command.method);
        await Reflect.apply(method, undefined, command.args);
        await db.query(
          "UPDATE assistant_action_receipts SET undone_at=now() WHERE id=$1",
          [row.id],
        );
      });
      return reply.code(204).send();
    },
  );
}
