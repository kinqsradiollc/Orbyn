import {
  fail,
  overnightKeepInput,
  overnightUndoInput,
  type OvernightNight,
  type OvernightRun,
} from "@orbyn/core";
import type { FastifyInstance } from "fastify";
import { transaction, type Db, type Queryable } from "../../db/pool.js";
import type { UserRow } from "../../lib/auth.js";
import { idParam, writeRateLimit } from "../../lib/params.js";
import { firstParty } from "../proposals/service.js";
import {
  applyProposal,
  declineProposal,
  reviewItem,
} from "../proposals/service.js";
import { grantActivity } from "../agents/service.js";
import { undoActivity, undoJob } from "../../capabilities/undo.js";
import { registry } from "../../capabilities/index.js";

type RunRow = {
  id: string;
  night_id: string;
  job_id: string;
  chat_id: string | null;
  kind: string;
  title: string;
  summary: string;
  status: OvernightRun["status"];
  state: OvernightRun["state"];
  result: unknown;
  apply_result: unknown;
  waiting: unknown;
};
const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const RUN_SELECT = `SELECT nr.*, j.chat_id, j.state, j.result, j.apply_result, j.run_state->'state'->'waiting' AS waiting, coalesce(c.title, 'Night work') AS title
 FROM assistant_night_runs nr JOIN assistant_nights n ON n.id = nr.night_id
 JOIN ai_jobs j ON j.id = nr.job_id AND j.user_id = n.user_id
 LEFT JOIN ai_chats c ON c.id = j.chat_id AND c.user_id = n.user_id`;

async function requireRun(
  db: Queryable,
  userId: string,
  id: string,
  lock = false,
) {
  const row = (
    await db.query<RunRow>(
      `${RUN_SELECT} WHERE nr.id = $1 AND n.user_id = $2${lock ? " FOR UPDATE OF n, nr" : ""}`,
      [id, userId],
    )
  ).rows[0];
  if (!row) fail(404, "That night run is not here.");
  return row;
}
async function runContext(db: Queryable, userId: string, row: RunRow) {
  const result = object(object(row.result).assistant_run);
  const receipt = object(object(row.apply_result).structured);
  const rawProposal =
    result.proposal_id ??
    object(receipt.pending).proposal_id ??
    receipt.proposal_id;
  const id =
    typeof rawProposal === "string"
      ? rawProposal.replace(/^proposal:/, "")
      : "";
  const proposalId = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)
    ? id
    : null;
  const proposal = proposalId
    ? ((
        await db.query<{ id: string; status: string; changes: unknown[] }>(
          "SELECT id, status, changes FROM proposals WHERE id = $1 AND user_id = $2",
          [proposalId, userId],
        )
      ).rows[0] ?? null)
    : null;
  const plan = proposal?.changes.find(
    (change) => object(change).action === "plan.apply",
  );
  const planInput = object(object(plan).input);
  const job = result.plan_job ?? receipt.job ?? planInput.job;
  const grantId =
    (
      await db.query<{ id: string }>(
        "SELECT id FROM agent_grants WHERE user_id = $1 AND kind = 'assistant'",
        [userId],
      )
    ).rows[0]?.id ?? null;
  const changes =
    grantId && typeof job === "string"
      ? await grantActivity(db, userId, grantId, job)
      : [];
  const steps = Array.isArray(planInput.steps)
    ? planInput.steps.flatMap((value) => {
        const step = object(value);
        return typeof step.id === "string"
          ? [
              {
                id: step.id,
                title:
                  typeof step.summary === "string"
                    ? step.summary
                    : (registry.get(String(step.tool))?.title ??
                      "Proposed change"),
              },
            ]
          : [];
      })
    : [];
  return {
    proposal,
    job: typeof job === "string" ? job : null,
    grantId,
    changes,
    steps,
  };
}
async function card(
  db: Db,
  userId: string,
  row: RunRow,
): Promise<OvernightRun> {
  const context = await runContext(db, userId, row);
  let status = row.status;
  const writes = context.changes.filter(
    (change) => change.undo_until || change.undone_at,
  );
  if (writes.some((change) => change.undone_at))
    status = writes.every((change) => change.undone_at) ? "undone" : "partly";
  else if (
    context.proposal?.status === "declined" ||
    context.proposal?.status === "cancelled"
  )
    status = "undone";
  else if (context.proposal?.status === "applied" && status === "pending")
    status = "kept";
  const proposal = context.proposal
    ? await reviewItem(db, userId, context.proposal.id)
    : null;
  if (proposal?.status === "expired" && status === "pending") status = "undone";
  const waiting = object(row.waiting);
  const question =
    row.state === "waiting" &&
    waiting.kind === "person" &&
    typeof waiting.question === "string"
      ? {
          text: waiting.question,
          choices: Array.isArray(waiting.choices)
            ? waiting.choices.filter(
                (value): value is string => typeof value === "string",
              )
            : [],
        }
      : null;
  return {
    question,
    id: row.id,
    job_id: row.job_id,
    chat_id: row.chat_id,
    kind: row.kind,
    title: row.title,
    summary: row.summary,
    status,
    state: row.state,
    changes: context.changes,
    steps: context.steps,
    proposal,
  };
}

/** The person's latest night and its live proposal and Undo states. */
export async function latestNight(
  db: Db,
  userId: string,
  nightId?: string,
): Promise<OvernightNight | null> {
  const night = (
    await db.query<{
      id: string;
      local_day: string;
      status: OvernightNight["status"];
      budget_used: number;
      summary: unknown;
    }>(
      "SELECT id, local_day::text, status, budget_used, summary FROM assistant_nights WHERE user_id = $1 AND ($2::uuid IS NULL OR id = $2) ORDER BY local_day DESC LIMIT 1",
      [userId, nightId ?? null],
    )
  ).rows[0];
  if (!night) return null;
  const rows = (
    await db.query<RunRow>(
      `${RUN_SELECT} WHERE n.id = $1 AND n.user_id = $2 ORDER BY nr.created_at, nr.id`,
      [night.id, userId],
    )
  ).rows;
  const leftovers = object(night.summary).not_done;
  return {
    id: night.id,
    local_day: night.local_day,
    status: night.status,
    budget_used: night.budget_used,
    runs: await Promise.all(rows.map((row) => card(db, userId, row))),
    not_done: Array.isArray(leftovers)
      ? leftovers.flatMap((value) => {
          const entry = object(value);
          return typeof entry.title === "string" &&
            typeof entry.reason === "string"
            ? [{ title: entry.title, reason: entry.reason }]
            : [];
        })
      : [],
  };
}

async function keep(
  db: Db,
  user: UserRow,
  id: string,
  input: { only?: number[]; steps?: string[] },
) {
  const row = await requireRun(db, user.id, id, true);
  if (row.state !== "done")
    fail(409, "This run is not finished. Open its chat to answer or stop it.");
  if (row.status === "undone") fail(409, "This run was already undone.");
  const context = await runContext(db, user.id, row);
  if ((input.only || input.steps) && context.proposal?.status !== "pending")
    fail(409, "This proposal was already decided.");
  if (context.proposal)
    await applyProposal(db, user, context.proposal.id, input);
  else if (input.only || input.steps)
    fail(422, "There is no held proposal to select changes from.");
  const partial = input.steps
    ? new Set(input.steps).size < context.steps.length
    : input.only
      ? new Set(input.only).size < (context.proposal?.changes.length ?? 0)
      : false;
  await db.query("UPDATE assistant_night_runs SET status = $2 WHERE id = $1", [
    id,
    partial || row.status === "partly" ? "partly" : "kept",
  ]);
}
async function undo(db: Db, user: UserRow, id: string, selected?: string[]) {
  const row = await requireRun(db, user.id, id, true);
  if (row.state !== "done" && row.state !== "failed")
    fail(409, "This run is still active. Open its chat to stop it.");
  const context = await runContext(db, user.id, row);
  if (row.status === "undone" && !selected) return [];
  const after: (() => Promise<void>)[] = [];
  if (context.proposal?.status === "pending") {
    if (selected) fail(422, "Held changes must be declined in Review.");
    await declineProposal(db, user, context.proposal.id);
  } else if (context.changes.some((change) => change.undoable)) {
    if (selected) {
      const ids = new Set(selected);
      if (
        [...ids].some(
          (changeId) =>
            !context.changes.some((change) => change.id === changeId),
        )
      )
        fail(404, "That change does not belong to this night run.");
      // Reverse execution order, matching whole-job Undo.
      for (const change of context.changes)
        if (ids.has(change.id) && !change.undone_at)
          after.push(...(await undoActivity(db, user, change.id)).after);
    } else if (context.grantId && context.job)
      after.push(
        ...(await undoJob(db, user, context.grantId, context.job)).after,
      );
  } else if (selected) fail(409, "These changes cannot be undone any more.");
  else if (
    context.changes.some((change) => change.undo_until && !change.undone_at)
  )
    fail(409, "These changes cannot be undone any more.");
  const remaining =
    context.grantId && context.job
      ? await grantActivity(db, user.id, context.grantId, context.job)
      : [];
  const partly = remaining.some((change) => change.undoable);
  await db.query("UPDATE assistant_night_runs SET status = $2 WHERE id = $1", [
    id,
    partly ? "partly" : "undone",
  ]);
  return after;
}

/** Person-only review of night work; all writes reuse Review and activity Undo. */
export async function overnightRoutes(app: FastifyInstance) {
  app.get("/me/assistant/nights/latest", async (request) => {
    const user = await firstParty(request);
    return transaction((db) => latestNight(db, user.id));
  });
  app.post(
    "/me/assistant/nights/runs/:id/keep",
    writeRateLimit,
    async (request) => {
      const user = await firstParty(request);
      const input = overnightKeepInput.parse(request.body ?? {});
      return transaction(async (db) => {
        await keep(db, user, idParam(request), input);
        return card(
          db,
          user.id,
          await requireRun(db, user.id, idParam(request)),
        );
      });
    },
  );
  app.post(
    "/me/assistant/nights/runs/:id/undo",
    writeRateLimit,
    async (request) => {
      const user = await firstParty(request);
      const input = overnightUndoInput.parse(request.body ?? {});
      const result = await transaction(async (db) => {
        const after = await undo(db, user, idParam(request), input.changes);
        return {
          after,
          run: await card(
            db,
            user.id,
            await requireRun(db, user.id, idParam(request)),
          ),
        };
      });
      for (const callback of result.after) await callback().catch(() => {});
      return result.run;
    },
  );
  for (const action of ["keep", "undo"] as const)
    app.post(
      `/me/assistant/nights/:id/${action}-all`,
      writeRateLimit,
      async (request) => {
        const user = await firstParty(request);
        const id = idParam(request);
        const after = await transaction(async (db) => {
          const owns = await db.query(
            "SELECT id FROM assistant_nights WHERE id = $1 AND user_id = $2 FOR UPDATE",
            [id, user.id],
          );
          if (!owns.rowCount) fail(404, "That night is not here.");
          const rows = (
            await db.query<{ id: string }>(
              `SELECT nr.id FROM assistant_night_runs nr JOIN ai_jobs j ON j.id = nr.job_id
             WHERE nr.night_id = $1 AND ($2 = 'undo' AND j.state IN ('done', 'failed')
              OR $2 = 'keep' AND j.state = 'done' AND nr.status <> 'undone')
             ORDER BY nr.created_at DESC, nr.id DESC`,
              [id, action],
            )
          ).rows;
          const callbacks: (() => Promise<void>)[] = [];
          for (const row of rows) {
            if (action === "keep") await keep(db, user, row.id, {});
            else callbacks.push(...(await undo(db, user, row.id)));
          }
          return callbacks;
        });
        for (const callback of after) await callback().catch(() => {});
        return transaction((db) => latestNight(db, user.id, id));
      },
    );
}
