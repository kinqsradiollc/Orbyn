import { assistantRulesInput, assistantRulesSnapshot, fail } from "@orbyn/core";
import { transaction, type Queryable } from "../../db/pool.js";

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
