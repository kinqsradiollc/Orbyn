import {
  characterAppearance,
  type AutomationAgentIdentity,
  type AutomationAgentLane,
} from "@orbyn/core";
import type { Queryable } from "../../db/pool.js";

/** Current per-lane identity; never inherit a later edit from the other lane. */
export async function readAutomationIdentity(
  db: Queryable,
  owner: string,
  lane: AutomationAgentLane,
): Promise<AutomationAgentIdentity> {
  const row = (
    await db.query<AutomationAgentIdentity>(
      "SELECT lane,name,persona,character,named_at,updated_at,revision FROM automation_agent_identities WHERE user_id=$1 AND lane=$2",
      [owner, lane],
    )
  ).rows[0];
  return row
    ? {
        ...row,
        character: characterAppearance(row.character),
        named_at: row.named_at ? new Date(row.named_at).toISOString() : null,
        updated_at: row.updated_at
          ? new Date(row.updated_at).toISOString()
          : null,
      }
    : {
        lane,
        name: lane === "background" ? "Background" : "Overnight",
        persona: "",
        character: characterAppearance({}),
        named_at: null,
        updated_at: null,
        revision: 0,
      };
}
