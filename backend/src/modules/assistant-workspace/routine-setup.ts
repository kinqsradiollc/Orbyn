import {
  approvalScopesInput,
  fail,
  routineSetupContext,
  routineSetupInput,
  routineRunLimits,
  type RoutineSetupContext,
} from "@orbyn/core";
import type { Queryable } from "../../db/pool.js";
import { policy } from "../../capabilities/policy.js";
import { assistantPrincipal } from "../agents/assistant.js";
import { LEAD_TOKEN_BUDGET } from "../ai/agent/limits.js";
import { assistantExecutionDigest } from "./execution-authority.js";
import { readAgentRoutine, saveAgentRoutine } from "./routines.js";

/** The grant lock serializes setup with existing grant permission writers. */
export async function readRoutineSetupContext(
  db: Queryable,
  owner: string,
  lock = false,
): Promise<RoutineSetupContext> {
  const grant = (
    await db.query(
      `SELECT id,access,personal,team_ids,toolsets,flags,trust,space_trust,
         acts_alone,assistant_rules,assistant_rules_revision,approval_scopes,
         suspended_at,revoked_at,expires_at,
         (expires_at IS NULL OR expires_at>now()) AS unexpired
       FROM agent_grants WHERE user_id=$1 AND kind='assistant'${lock ? " FOR UPDATE" : ""}`,
      [owner],
    )
  ).rows[0];
  const person = (
    await db.query<{
      id: string;
      name: string;
      role: "member" | "admin";
      disabled: boolean;
    }>("SELECT id,name,role,disabled FROM users WHERE id=$1", [owner])
  ).rows[0];
  if (!person) fail(404, "Account not found.");
  const scopes = approvalScopesInput.parse(grant?.approval_scopes ?? {});
  // touch:false is essential: viewing setup must never create a grant.
  const principal = grant
    ? await assistantPrincipal(person, {
        db,
        touch: false,
        lane: "background",
      })
    : null;
  const canPreauthorize =
    !!grant &&
    !person.disabled &&
    !grant.suspended_at &&
    !grant.revoked_at &&
    grant.unexpired &&
    !!principal &&
    [null, ...principal.teams.map((team) => team.id)].some(
      (team) =>
        policy.levelIn(principal, team) === "write" &&
        policy.trustIn(principal, team) === "full",
    );
  return routineSetupContext.parse({
    approval_scopes: scopes,
    snapshot: assistantExecutionDigest({
      version: 1,
      run_limits_ceiling: routineRunLimits.parse({}),
      owner,
      disabled: person.disabled,
      grant: grant ?? null,
      teams:
        principal?.teams
          .map(({ id, role, agent_access }) => ({ id, role, agent_access }))
          .sort((a, b) => a.id.localeCompare(b.id)) ?? [],
    }),
    max_run_tokens: LEAD_TOKEN_BUDGET,
    max_active_work_minutes: 10,
    can_preauthorize: !!canPreauthorize,
  });
}

/** Caller owns the primary transaction; no provider or queue work occurs here. */
export async function setupAgentRoutine(
  db: Queryable,
  owner: string,
  raw: unknown,
) {
  const input = routineSetupInput.parse(raw);
  const digest = assistantExecutionDigest({
    ...input,
    allow_changes: [...input.allow_changes].sort(),
  });
  // Serialize even before a receipt exists, including retries after a lost ACK.
  await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
    `routine-setup:${owner}:${input.request_id}`,
  ]);
  const receipt = (
    await db.query<{ payload_digest: string; routine_id: string | null }>(
      "SELECT payload_digest,routine_id FROM assistant_routine_setup_receipts WHERE owner_id=$1 AND request_id=$2",
      [owner, input.request_id],
    )
  ).rows[0];
  if (receipt) {
    if (receipt.payload_digest !== digest)
      fail(409, "This request already set up a different routine.");
    const routine = receipt.routine_id
      ? await readAgentRoutine(db, owner, receipt.routine_id)
      : null;
    if (!routine)
      fail(410, "This routine was deleted. Create a new setup request.");
    return routine;
  }
  const current = await readRoutineSetupContext(db, owner, true);
  if (input.expected_snapshot !== current.snapshot)
    fail(
      409,
      "Assistant permissions changed. Review them before creating the routine.",
    );
  if (input.allow_changes.length && !current.can_preauthorize)
    fail(409, "Assistant permission is unavailable for automatic changes.");
  if (
    input.run_limits &&
    (input.run_limits.token_limit > current.max_run_tokens ||
      input.run_limits.active_work_minutes > current.max_active_work_minutes)
  )
    fail(422, "Choose routine limits within the current runtime ceilings.");
  const routine = await saveAgentRoutine(db, owner, null, input.routine);
  if (input.run_limits) {
    await db.query(
      "UPDATE agent_routines SET run_limits=$3::jsonb WHERE id=$2 AND user_id=$1",
      [owner, routine.id, JSON.stringify(input.run_limits)],
    );
  }
  if (input.allow_changes.length) {
    const scopes = { ...current.approval_scopes };
    for (const kind of input.allow_changes)
      scopes[kind] = { scope: "routine", id: routine.id };
    await db.query(
      "UPDATE agent_grants SET approval_scopes=$2::jsonb WHERE user_id=$1 AND kind='assistant'",
      [owner, JSON.stringify(scopes)],
    );
  }
  await db.query(
    "INSERT INTO assistant_routine_setup_receipts(owner_id,request_id,payload_digest,routine_id) VALUES($1,$2,$3,$4)",
    [owner, input.request_id, digest, routine.id],
  );
  return routine;
}
