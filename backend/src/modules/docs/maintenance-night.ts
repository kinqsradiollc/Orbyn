import type { OvernightPageRun } from "@orbyn/core";
import type { Db } from "../../db/pool.js";
import type { UserRow } from "../../lib/auth.js";
import { Params, scopeFor, visibleDocs } from "../../lib/visibility.js";
import { assistantMayRead } from "../../lib/doc-visibility.js";
import { assistantPrincipal } from "../agents/assistant.js";
import { currentAssistantPrincipal } from "../../capabilities/assistant-principal.js";
import { CapabilityError } from "../../capabilities/registry.js";
import { policy } from "../../capabilities/policy.js";

/** Current scoped progress only: no generated output, title, lease or credentials. */
export async function maintainedPageNightProgress(
  db: Db,
  userId: string,
  nightId: string,
): Promise<OvernightPageRun[]> {
  const user = (
    await db.query<UserRow>(
      "SELECT * FROM users WHERE id=$1 AND NOT disabled",
      [userId],
    )
  ).rows[0];
  if (!user) return [];
  const exists = await db.query(
    "SELECT 1 FROM agent_grants WHERE user_id=$1 AND kind='assistant'",
    [userId],
  );
  if (!exists.rowCount) return [];
  let principal;
  try {
    principal = await currentAssistantPrincipal(
      db,
      await assistantPrincipal(user, { db, touch: false }),
      true,
    );
  } catch (error) {
    if (error instanceof CapabilityError) return [];
    throw error;
  }
  const params = new Params(userId, nightId, principal.grant_id);
  const scope = scopeFor(policy.spaces(principal), params);
  return (
    await db.query<OvernightPageRun>(
      `SELECT r.id,r.binding_id,b.doc_id,r.state,r.token_estimate AS estimated_tokens
     FROM assistant_page_runs r JOIN assistant_page_bindings b ON b.id=r.binding_id
     JOIN docs d ON d.id=b.doc_id
     WHERE r.user_id=$1 AND r.night_id=$2 AND r.agent_grant_id=$3
       AND ${visibleDocs("d", scope)} AND ${assistantMayRead("d")}
     ORDER BY r.created_at,r.id LIMIT 10`,
      params.values,
    )
  ).rows;
}
