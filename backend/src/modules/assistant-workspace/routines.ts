import {
  agentRoutineInput,
  agentRoutineUpdate,
  approvalScopesInput,
  fail,
  nextOccurrence,
  type AgentRoutine,
} from "@orbyn/core";
import type { FastifyInstance } from "fastify";
import { pool, transaction, type Queryable } from "../../db/pool.js";
import { authenticate } from "../../lib/auth.js";
import { idParam } from "../../lib/params.js";
import { assistantPrincipal } from "../agents/assistant.js";

type RoutineRow = Omit<
  AgentRoutine,
  "created_at" | "updated_at" | "next_run_at"
> & {
  created_at: Date;
  updated_at: Date;
  next_run_at: Date;
};
const ROUTINE_SELECT = `id, user_id, instruction, rrule, timezone, next_run_at,
  last_result, paused, created_at, updated_at`;
const routineOf = (row: RoutineRow): AgentRoutine => ({
  ...row,
  next_run_at: row.next_run_at.toISOString(),
  created_at: row.created_at.toISOString(),
  updated_at: row.updated_at.toISOString(),
});
export async function listAgentRoutines(
  db: Queryable,
  userId: string,
): Promise<AgentRoutine[]> {
  const rows = (
    await db.query<RoutineRow>(
      `SELECT ${ROUTINE_SELECT} FROM agent_routines
        WHERE user_id = $1 ORDER BY paused, next_run_at, id`,
      [userId],
    )
  ).rows;
  return rows.map(routineOf);
}

export async function saveAgentRoutine(
  db: Queryable,
  userId: string,
  id: string | null,
  raw: unknown,
): Promise<AgentRoutine> {
  const current = id
    ? (
        await db.query<RoutineRow>(
          `SELECT ${ROUTINE_SELECT} FROM agent_routines
            WHERE id = $2 AND user_id = $1 FOR UPDATE`,
          [userId, id],
        )
      ).rows[0]
    : undefined;
  if (id && !current) fail(404, "Assistant routine not found.");
  let parsed = id
    ? agentRoutineInput.parse({
        instruction: current!.instruction,
        rrule: current!.rrule,
        timezone: current!.timezone,
        next_run_at: current!.next_run_at.toISOString(),
        paused: current!.paused,
        ...agentRoutineUpdate.parse(raw),
      })
    : agentRoutineInput.parse(raw);
  try {
    new Intl.DateTimeFormat("en", { timeZone: parsed.timezone });
  } catch {
    fail(422, "Choose a supported time zone.");
  }
  if (
    current?.paused &&
    !parsed.paused &&
    new Date(parsed.next_run_at).getTime() <= Date.now()
  ) {
    const next = nextOccurrence(
      new Date(parsed.next_run_at),
      parsed.rrule,
      parsed.timezone,
      new Date(),
    );
    if (!next) fail(422, "No future run is available for this routine.");
    parsed = { ...parsed, next_run_at: next.toISOString() };
  }
  if (!parsed.paused && new Date(parsed.next_run_at).getTime() <= Date.now())
    fail(422, "The next run must be in the future.");
  const savedId = id
    ? (
        await db.query(
          `UPDATE agent_routines SET instruction = $3, rrule = $4, timezone = $5,
             next_run_at = $6, paused = $7, updated_at = now()
           WHERE id = $1 AND user_id = $2 RETURNING id`,
          [
            id,
            userId,
            parsed.instruction,
            parsed.rrule,
            parsed.timezone,
            parsed.next_run_at,
            parsed.paused,
          ],
        )
      ).rows[0]?.id
    : (
        await db.query(
          `INSERT INTO agent_routines (user_id, instruction, rrule, timezone, next_run_at, paused)
           VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
          [
            userId,
            parsed.instruction,
            parsed.rrule,
            parsed.timezone,
            parsed.next_run_at,
            parsed.paused,
          ],
        )
      ).rows[0]?.id;
  if (!savedId) fail(404, "Assistant routine not found.");
  const saved = (
    await db.query<RoutineRow>(
      `SELECT ${ROUTINE_SELECT} FROM agent_routines WHERE id = $1`,
      [savedId],
    )
  ).rows[0];
  return routineOf(saved);
}

export async function deleteAgentRoutine(
  db: Queryable,
  userId: string,
  id: string,
) {
  const result = await db.query(
    "DELETE FROM agent_routines WHERE id = $2 AND user_id = $1",
    [userId, id],
  );
  if (!result.rowCount) fail(404, "Assistant routine not found.");
}

export async function assistantRoutineRoutes(app: FastifyInstance) {
  app.get("/me/agent-routines", async (r) => {
    const user = await authenticate(r);
    return listAgentRoutines(pool, user.id);
  });
  app.post("/me/agent-routines", async (r, reply) => {
    const user = await authenticate(r);
    const routine = await transaction((db) =>
      saveAgentRoutine(db, user.id, null, r.body),
    );
    reply.code(201);
    return routine;
  });
  app.put("/me/agent-routines/:id", async (r) => {
    const user = await authenticate(r);
    return transaction((db) =>
      saveAgentRoutine(db, user.id, idParam(r), r.body),
    );
  });
  app.delete("/me/agent-routines/:id", async (r) => {
    const user = await authenticate(r);
    await transaction((db) => deleteAgentRoutine(db, user.id, idParam(r)));
    return { deleted: true };
  });
  app.get("/me/assistant/approval-scopes", async (r) => {
    const user = await authenticate(r);
    const grant = await assistantPrincipal(user);
    const row = (
      await pool.query<{ approval_scopes: unknown }>(
        "SELECT approval_scopes FROM agent_grants WHERE id = $1 AND user_id = $2",
        [grant.grant_id, user.id],
      )
    ).rows[0];
    return approvalScopesInput.parse(row?.approval_scopes ?? {});
  });
  app.put("/me/assistant/approval-scopes", async (r) => {
    const user = await authenticate(r);
    const grant = await assistantPrincipal(user);
    const scopes = approvalScopesInput.parse(r.body ?? {});
    await pool.query(
      "UPDATE agent_grants SET approval_scopes = $3::jsonb WHERE id = $1 AND user_id = $2",
      [grant.grant_id, user.id, JSON.stringify(scopes)],
    );
    return scopes;
  });
}
