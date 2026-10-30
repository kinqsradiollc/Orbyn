import { fail, maintainedPageRunStopResult } from "@orbyn/core";
import type { Queryable } from "../../db/pool.js";
/** Cancel only this owner's run. The row lock serializes with page publication;
 * a committed write wins unchanged, and cancellation fences every older lease.
 * Existing triggers retain reserved model usage and settle the lane segment. */
export async function stopMaintainedPageRun(
  db: Queryable,
  owner: string,
  docId: string,
  runId: string,
) {
  const row = (
    await db.query<{
      state: "queued" | "running" | "waiting" | "done" | "failed" | "cancelled";
      error_message: string | null;
    }>(
      `SELECT r.state,r.error_message FROM assistant_page_runs r JOIN assistant_page_bindings b ON b.id=r.binding_id AND b.user_id=r.user_id WHERE r.id=$1 AND r.user_id=$2 AND b.doc_id=$3 FOR UPDATE OF r`,
      [runId, owner, docId],
    )
  ).rows[0];
  if (!row) fail(404, "Page run not found.");
  if (["queued", "running", "waiting"].includes(row.state)) {
    await db.query(
      "UPDATE assistant_page_runs SET state='cancelled',lease_token=NULL,lease_expires_at=NULL,waiting_id=NULL,proposal=NULL,error_message='Stopped by you.',updated_at=clock_timestamp() WHERE id=$1",
      [runId],
    );
    return maintainedPageRunStopResult.parse({
      state: "cancelled",
      stopped: true,
    });
  }
  return maintainedPageRunStopResult.parse({
    state: row.state,
    stopped:
      row.state === "cancelled" && row.error_message === "Stopped by you.",
  });
}
