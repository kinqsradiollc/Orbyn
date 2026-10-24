import { assistantWorkControls, assistantWorkControlsInput } from "@orbyn/core";
import type { Queryable } from "../../db/pool.js";

export async function readWorkControls(db: Queryable, owner: string) {
  const row = (
    await db.query(
      "SELECT background_paused,overnight_paused FROM agent_settings WHERE user_id=$1",
      [owner],
    )
  ).rows[0];
  return assistantWorkControls.parse(
    row ?? { background_paused: false, overnight_paused: false },
  );
}

export async function updateWorkControls(
  db: Queryable,
  owner: string,
  value: unknown,
) {
  const input = assistantWorkControlsInput.parse(value);
  await db.query(
    `INSERT INTO agent_settings(user_id,background_paused,overnight_paused)
    VALUES($1,coalesce($2,false),coalesce($3,false)) ON CONFLICT(user_id) DO UPDATE
    SET background_paused=coalesce($2,agent_settings.background_paused),overnight_paused=coalesce($3,agent_settings.overnight_paused)`,
    [owner, input.background_paused ?? null, input.overnight_paused ?? null],
  );
  return readWorkControls(db, owner);
}

/** A shared settings lock serializes an admission with the person's pause. */
export async function assistantAdmissionOpen(
  db: Queryable,
  owner: string,
  lane: "background" | "overnight",
) {
  const row = (
    await db.query<{ paused: boolean }>(
      `SELECT CASE WHEN $2='overnight' THEN overnight_paused ELSE background_paused END AS paused
     FROM agent_settings WHERE user_id=$1 FOR SHARE`,
      [owner, lane],
    )
  ).rows[0];
  return !row?.paused;
}
