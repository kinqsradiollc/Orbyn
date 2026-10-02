import {
  assistantRulesInput,
  assistantRulesSnapshot,
  assistantProposalGuard,
  assistantActionRules,
  assistantRuleDecision,
  fail,
  type AgentAccess,
} from "@orbyn/core";
import { transaction, type Queryable } from "../../db/pool.js";
import { reachableTeams } from "../../capabilities/policy.js";

/** Review does not change the producing runtime or silently accept edited rules. */
export async function checkAssistantProposalRules(
  db: Queryable,
  ownerId: string,
  grantId: string | null,
  value: unknown,
  creating = false,
) {
  const row = grantId
    ? (
        await db.query<{
          kind: string;
          revision: number;
          rules: unknown;
          revoked_at: Date | null;
          suspended_at: Date | null;
          disabled: boolean;
          access: AgentAccess;
          personal: boolean;
          team_ids: string[] | null;
        }>(
          `SELECT g.kind,g.assistant_rules_revision AS revision,g.assistant_rules AS rules,
     g.revoked_at,g.suspended_at,u.disabled,g.access,g.personal,g.team_ids
     FROM agent_grants g JOIN users u ON u.id=g.user_id
     WHERE g.id=$1 AND g.user_id=$2 FOR SHARE OF g`,
          [grantId, ownerId],
        )
      ).rows[0]
    : null;
  if (grantId && !row)
    fail(403, "The proposal's source connection is no longer available.");
  if (!row || row.kind !== "assistant") {
    if (value != null)
      fail(403, "This proposal cannot use assistant authority.");
    return null;
  }
  if (row.revoked_at || row.suspended_at || row.disabled)
    fail(403, "Your assistant is paused or unavailable.");
  const rules = assistantActionRules.parse(row.rules);
  if (value == null) {
    if (creating || row.revision !== 1 || rules.length)
      fail(
        409,
        "This suggestion has no current assistant rule evidence. Ask for a new one.",
      );
    return null;
  }
  const guard = assistantProposalGuard.parse(value);
  if (guard.rules_revision !== row.revision)
    fail(
      409,
      "Assistant rules changed. Ask for a new suggestion before approving.",
    );
  if (!guard.checks.length && rules.length)
    fail(
      409,
      "This suggestion needs checked assistant actions before approval.",
    );
  const teams = await reachableTeams(db, ownerId, row.team_ids, "assistant");
  for (const check of guard.checks) {
    const team =
      check.team_id === null
        ? null
        : teams.find((candidate) => candidate.id === check.team_id);
    if (
      row.access === "read" ||
      (check.team_id === null
        ? !row.personal
        : !team || team.role === "viewer" || team.agent_access === "read")
    )
      fail(
        403,
        "The assistant can no longer suggest this change in its source space.",
      );
    if (
      assistantRuleDecision(rules, guard.lane, check.team_id, check.actions) ===
      "deny"
    )
      fail(403, "A reviewed assistant rule forbids this suggestion.");
  }
  return guard;
}

/** Only the person's existing built-in assistant owns these reviewed rules. */
export async function readAssistantRules(db: Queryable, ownerId: string) {
  const row = (
    await db.query<{ revision: number; rules: unknown }>(
      `SELECT g.assistant_rules_revision AS revision,g.assistant_rules AS rules
     FROM agent_grants g JOIN users u ON u.id=g.user_id AND NOT u.disabled
     WHERE g.user_id=$1 AND g.kind='assistant' AND g.revoked_at IS NULL`,
      [ownerId],
    )
  ).rows[0];
  if (!row) fail(404, "Your assistant rules are not available.");
  return assistantRulesSnapshot.parse(row);
}

/** Explicit reviewed replacement, serialized with every receiving write check. */
export async function replaceAssistantRules(ownerId: string, value: unknown) {
  const input = assistantRulesInput.parse(value);
  return transaction(async (db) => {
    const grant = (
      await db.query<{ id: string; revision: number }>(
        `SELECT g.id,g.assistant_rules_revision AS revision FROM agent_grants g
       JOIN users u ON u.id=g.user_id AND NOT u.disabled
       WHERE g.user_id=$1 AND g.kind='assistant' AND g.revoked_at IS NULL FOR UPDATE OF g`,
        [ownerId],
      )
    ).rows[0];
    if (!grant) fail(404, "Your assistant rules are not available.");
    if (grant.revision !== input.expected_revision)
      fail(409, "These rules changed. Reload before saving.");
    const teamIds = [
      ...new Set(
        input.rules.flatMap((rule) =>
          rule.scope.kind === "team" ? [rule.scope.id] : [],
        ),
      ),
    ];
    if (teamIds.length) {
      const reachable = await db.query(
        "SELECT team_id FROM team_members WHERE user_id=$1 AND team_id=ANY($2::uuid[]) FOR SHARE",
        [ownerId, teamIds],
      );
      if (reachable.rowCount !== teamIds.length)
        fail(404, "A rule's team is no longer available.");
    }
    const row = (
      await db.query<{ revision: number; rules: unknown }>(
        `UPDATE agent_grants SET assistant_rules=$2::jsonb,assistant_rules_revision=assistant_rules_revision+1
       WHERE id=$1 RETURNING assistant_rules_revision AS revision,assistant_rules AS rules`,
        [grant.id, JSON.stringify(input.rules)],
      )
    ).rows[0];
    return assistantRulesSnapshot.parse(row);
  });
}
