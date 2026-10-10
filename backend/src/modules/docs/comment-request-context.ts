import { fail } from "@orbyn/core";
import type { Db } from "../../db/pool.js";
import { privacyFrom } from "../links/privacy.js";

export const mentionsOrbyn = (body: string) => /(?:^|\s)@orbyn\b/i.test(body);
export type PageCommentSource = {
  source_comment_id: string | null;
  source_comment_revision: number | null;
};

/** Only the initiating remark enters the model context, never sibling/private conversations. */
export async function pageCommentRequestContext(
  db: Db,
  binding: PageCommentSource & { doc_id: string; user_id: string },
) {
  if (!binding.source_comment_id) return null;
  const comment = (
    await db.query<{
      id: string;
      body: string;
      parent_id: string | null;
      revision: number;
      detached: boolean;
      resolved_at: Date | null;
    }>(
      `SELECT id,body,parent_id,revision,detached,resolved_at FROM doc_comments
     WHERE id=$1 AND doc_id=$2 AND user_id=$3 AND via_grant_id IS NULL FOR SHARE`,
      [binding.source_comment_id, binding.doc_id, binding.user_id],
    )
  ).rows[0];
  if (
    !comment ||
    comment.revision !== binding.source_comment_revision ||
    comment.detached ||
    comment.resolved_at ||
    !mentionsOrbyn(comment.body)
  )
    fail(409, "This comment request changed or was removed.");
  if (comment.parent_id) {
    const parent = await db.query(
      "SELECT id FROM doc_comments WHERE id=$1 AND doc_id=$2 AND resolved_at IS NULL AND NOT detached FOR SHARE",
      [comment.parent_id, binding.doc_id],
    );
    if (!parent.rowCount)
      fail(409, "This comment thread was resolved or removed.");
  }
  // A page-visible answer cannot quote labels from the requester's private links.
  const body = privacyFrom(() => true).value(comment.body);
  return { id: comment.id, parentId: comment.parent_id ?? comment.id, body };
}
