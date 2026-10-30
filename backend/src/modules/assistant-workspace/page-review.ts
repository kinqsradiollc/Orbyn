import type {
  AssistantPageReviewRun,
  AssistantProfileCounts,
} from "@orbyn/core";
import type { Queryable } from "../../db/pool.js";
import type { UserRow } from "../../lib/auth.js";
import {
  Params,
  scopeFor,
  visibleDocs,
  visibleProjects,
} from "../../lib/visibility.js";
import { assistantMayRead } from "../../lib/doc-visibility.js";
import { assistantPageRunEntrySourcesVisible } from "../../lib/assistant-source-visibility.js";
import { assistantPrincipal } from "../agents/assistant.js";
import { currentAssistantPrincipal } from "../../capabilities/assistant-principal.js";
import { policy } from "../../capabilities/policy.js";
import { CapabilityError } from "../../capabilities/registry.js";
const emptyCounts = (): AssistantProfileCounts => ({
  working: 0,
  waiting: 0,
  queued: 0,
  recovering: 0,
});
/** Pure projection: callers supply primary repeatable-read; never invoke the mutation/review guard here. */
export async function readAssistantPageReview(
  db: Queryable,
  owner: string,
  lane: "background" | "overnight",
  now = new Date(),
): Promise<{
  runs: AssistantPageReviewRun[];
  truncated: boolean;
  counts: AssistantProfileCounts;
}> {
  const user = (
    await db.query<UserRow>(
      "SELECT * FROM users WHERE id=$1 AND NOT disabled",
      [owner],
    )
  ).rows[0];
  if (
    !user ||
    !(
      await db.query(
        "SELECT id FROM agent_grants WHERE user_id=$1 AND kind='assistant'",
        [owner],
      )
    ).rowCount
  )
    return { runs: [], truncated: false, counts: emptyCounts() };
  let principal;
  try {
    principal = await currentAssistantPrincipal(
      db,
      await assistantPrincipal(user, { db, touch: false, lane }),
      false,
    );
  } catch (error) {
    if (error instanceof CapabilityError)
      return { runs: [], truncated: false, counts: emptyCounts() };
    throw error;
  }
  if (!policy.allows(principal, { access: "read", toolset: "core" }))
    return { runs: [], truncated: false, counts: emptyCounts() };
  const params = new Params(
      owner,
      principal.grant_id,
      lane,
      principal.assistant_rules_revision ?? 1,
      now,
    ),
    scope = scopeFor(policy.spaces(principal), params);
  const eligible = `SELECT r.id,r.state,r.lease_expires_at,r.updated_at,b.doc_id,d.title,
  (r.state='running' AND (r.lease_expires_at IS NULL OR r.lease_expires_at<=$5::timestamptz)) AS recovering,
  CASE WHEN b.source_comment_id IS NULL THEN 'page_update' ELSE 'comment_reply' END AS work_kind,
  CASE WHEN p.id IS NULL THEN jsonb_build_object('kind','page','id',d.id,'title',coalesce(nullif(left(trim(d.title),200),''),'Untitled page'))
       ELSE jsonb_build_object('kind','project','id',p.id,'title',coalesce(nullif(left(trim(p.name),200),''),'Untitled project')) END AS origin
 FROM assistant_page_runs r JOIN assistant_page_bindings b ON b.id=r.binding_id AND b.user_id=r.user_id AND b.agent_grant_id=r.agent_grant_id
 JOIN docs d ON d.id=b.doc_id LEFT JOIN projects p ON p.id=d.project_id AND ${visibleProjects("p", scope)}
 WHERE r.user_id=$1 AND r.agent_grant_id=$2 AND r.lane=$3 AND r.assistant_rules_revision=$4
  AND ${visibleDocs("d", scope)} AND ${assistantMayRead("d")}
  AND ${assistantPageRunEntrySourcesVisible("r.id", scope.user, scope)}
  AND (b.source_comment_id IS NULL OR EXISTS(SELECT 1 FROM doc_comments comment WHERE comment.id=b.source_comment_id
    AND comment.doc_id=b.doc_id AND comment.user_id=b.user_id AND comment.via_grant_id IS NULL
    AND comment.revision=b.source_comment_revision AND comment.resolved_at IS NULL AND NOT comment.detached
    AND comment.body ~* '(^|[[:space:]])@orbyn\\y'
    AND (comment.parent_id IS NULL OR EXISTS(SELECT 1 FROM doc_comments parent WHERE parent.id=comment.parent_id
      AND parent.doc_id=comment.doc_id AND parent.resolved_at IS NULL AND NOT parent.detached))))`;
  const counts = (
    await db.query<AssistantProfileCounts>(
      `WITH eligible AS (${eligible}) SELECT
  count(*) FILTER(WHERE state='running' AND lease_expires_at>$5)::int AS working,
  count(*) FILTER(WHERE state='waiting')::int AS waiting,
  count(*) FILTER(WHERE state='queued')::int AS queued,
  count(*) FILTER(WHERE state='running' AND (lease_expires_at IS NULL OR lease_expires_at<=$5))::int AS recovering FROM eligible`,
      params.values,
    )
  ).rows[0];
  type Row = {
    id: string;
    state: AssistantPageReviewRun["state"];
    lease_expires_at: Date | null;
    updated_at: Date;
    doc_id: string;
    title: string;
    work_kind: AssistantPageReviewRun["work_kind"];
    origin: AssistantPageReviewRun["origin"];
  };
  const rows = (
    await db.query<Row>(
      `WITH eligible AS (${eligible}),active AS (
  SELECT * FROM eligible WHERE state IN ('queued','running','waiting')
  ORDER BY CASE WHEN state='waiting' THEN 0 WHEN state='running' THEN 1 ELSE 2 END,updated_at DESC,id LIMIT 21
 ),terminal AS (SELECT * FROM eligible WHERE state IN ('done','failed','cancelled') ORDER BY updated_at DESC,id LIMIT 6)
 SELECT * FROM active UNION ALL SELECT * FROM terminal`,
      params.values,
    )
  ).rows;
  const active = rows.filter((r) =>
      ["queued", "running", "waiting"].includes(r.state),
    ),
    terminal = rows.filter(
      (r) => !["queued", "running", "waiting"].includes(r.state),
    );
  return {
    counts,
    truncated: active.length > 20 || terminal.length > 5,
    runs: [...active.slice(0, 20), ...terminal.slice(0, 5)].map((r) => ({
      id: r.id,
      doc_id: r.doc_id,
      title: r.title.trim().slice(0, 200) || "Untitled page",
      origin: r.origin,
      state: r.state,
      recovering:
        r.state === "running" &&
        (!r.lease_expires_at || r.lease_expires_at <= now),
      updated_at: r.updated_at.toISOString(),
      work_kind: r.work_kind,
    })),
  };
}
