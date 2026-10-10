import { fail, docContainerTaskBlocks, type DocComment } from "@orbyn/core";
import type { Db } from "../../db/pool.js";
import type { UserRow } from "../../lib/auth.js";
import type { Principal } from "../../capabilities/policy.js";
import { createMaintainedPageBinding } from "./maintenance.js";
import { readVersionedDoc } from "./content-format.js";
import { mentionsOrbyn } from "./comment-request-context.js";

/** Called only by the authenticated human comment endpoint, in its insert transaction. */
export async function createPageCommentRequest(
  db: Db,
  user: UserRow,
  comment: DocComment,
  principal: Principal,
) {
  if (!mentionsOrbyn(comment.body)) return;
  if (!comment.revision) fail(409, "Reload this comment before asking @orbyn.");
  const existing = await db.query(
    "SELECT id FROM assistant_page_bindings WHERE source_comment_id=$1",
    [comment.id],
  );
  if (existing.rowCount) return;
  const doc = await readVersionedDoc(db, user, comment.doc_id, [1, 2]);
  const blocks =
    doc.document.format === 1
      ? doc.document.blocks
      : docContainerTaskBlocks(doc.document.nodes, { projected: true });
  const ids = comment.block_id
    ? [comment.block_id]
    : blocks.flatMap((b) => (b.id ? [b.id] : []));
  if (!ids.length || ids.length > 100)
    fail(422, "Select a page block before asking @orbyn.");
  await createMaintainedPageBinding(
    db,
    user,
    principal,
    comment.doc_id,
    {
      expected_doc_version: doc.version,
      block_ids: ids,
      instruction:
        "Reply to this page comment using only its selected page content.",
      // Comment bindings are exhausted by their first queue operation, independently of recurrence.
      rrule: "FREQ=DAILY",
      timezone: "UTC",
      next_run_at: new Date().toISOString(),
      paused: false,
    },
    { id: comment.id, revision: comment.revision },
  );
}
