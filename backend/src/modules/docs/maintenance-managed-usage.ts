import { randomUUID } from "node:crypto";
import { fail, type MaintainedPageModelOrigin } from "@orbyn/core";
import { transaction, type Db } from "../../db/pool.js";
import { recordAssistantSources } from "../../lib/assistant-job-sources.js";
import {
  assertJobAiProviderChoice,
  readAiProviderChoice,
} from "../auth/ai-provider-choice.js";
import {
  assertManagedSelection,
  readJobManagedSnapshot,
  readManagedSelection,
} from "../ai/providers/managed-authority.js";
import { managedUsageRecorder } from "../ai/providers/usage.js";
import { recordProviderUse } from "../ai/provider-provenance.js";
import { guardMaintainedPageRun } from "./maintenance-runs.js";
import { PageModelUnavailable, type PageModel } from "./maintenance-model.js";
import type { PageInferenceContext } from "./maintenance-inference.js";

type HostedOrigin = Extract<MaintainedPageModelOrigin, { kind: "hosted" }>;
async function assertOrigin(db: Db, owner: string, origin: HostedOrigin) {
  const choice = await readAiProviderChoice(db, owner);
  if (
    choice.primary !== "default" ||
    choice.version !== (origin.provider_choice_version ?? 0) ||
    !origin.managed_provider_snapshot
  )
    throw new PageModelUnavailable("provider_choice_changed");
  assertManagedSelection(
    origin.managed_provider_snapshot,
    (await readManagedSelection(db)).snapshot,
  );
}

/** Observe managed usage under the existing page lease; staged output needs no new call. */
export async function attachManagedPageUsage(
  owner: string,
  origin: HostedOrigin,
  parent: PageInferenceContext,
  model: PageModel,
): Promise<PageModel> {
  const observedAt = Date.now();
  const now = () =>
    new Date((parent.now?.getTime() ?? observedAt) + Date.now() - observedAt);
  const selected = await transaction(async (db) => {
    const context = await guardMaintainedPageRun(
      db,
      parent.runId,
      parent.leaseToken,
      now(),
      owner,
    );
    if (JSON.stringify(context.run.model_origin) !== JSON.stringify(origin))
      throw new PageModelUnavailable("provider_choice_changed");
    await assertOrigin(db, owner, origin);
    // Older staged results can still be applied; do not invent a usage receipt for them.
    if (context.run.proposal) return null;
    let job = (
      await db.query(
        "SELECT * FROM ai_jobs WHERE maintenance_run_id=$1 AND user_id=$2 FOR UPDATE",
        [parent.runId, owner],
      )
    ).rows[0];
    if (!job) {
      job = (
        await db.query(
          `INSERT INTO ai_jobs(user_id,state,claimed_by,lease_until,maintenance_run_id,run_state)
         VALUES($1,'running',$2,$3,$4,$5::jsonb) RETURNING *`,
          [
            owner,
            parent.leaseToken,
            context.run.lease_expires_at,
            parent.runId,
            JSON.stringify({
              version: 3,
              parent_lease: parent.leaseToken,
              operation_id: randomUUID(),
              sources: [
                {
                  kind: "doc",
                  id: context.binding.doc_id,
                  version: context.run.doc_version,
                },
              ],
              request: {
                automation: {
                  kind: context.run.lane === "overnight" ? "night" : "page",
                },
              },
            }),
          ],
        )
      ).rows[0];
    } else if (job.claimed_by !== parent.leaseToken) {
      const observed = await db.query(
        "SELECT 1 FROM managed_ai_usage WHERE job_id=$1 LIMIT 1",
        [job.id],
      );
      if (
        context.run.reserved_tokens ||
        observed.rowCount ||
        job.result?.feature_provider ||
        !["queued", "running"].includes(job.state)
      )
        fail(409, "An unfinished page inference cannot be retried.");
      job = (
        await db.query(
          `UPDATE ai_jobs SET state='running',claimed_by=$2,lease_until=$3,
         run_state=jsonb_set(run_state,'{parent_lease}',to_jsonb($2::text)),heartbeat_at=now()
         WHERE id=$1 RETURNING *`,
          [job.id, parent.leaseToken, context.run.lease_expires_at],
        )
      ).rows[0];
    }
    if (job.state !== "running" || job.run_state?.version !== 3)
      fail(409, "This page inference is no longer active.");
    await assertJobAiProviderChoice(db, owner, job.id);
    assertManagedSelection(
      origin.managed_provider_snapshot!,
      await readJobManagedSnapshot(db, owner, job.id),
    );
    return { jobId: job.id as string, docId: context.binding.doc_id };
  });
  if (!selected) return model;
  await recordAssistantSources(selected.jobId, owner, {}, [
    `doc:${selected.docId}`,
  ]);
  const assertAccess = async (db: Db) => {
    await guardMaintainedPageRun(
      db,
      parent.runId,
      parent.leaseToken,
      now(),
      owner,
    );
    const job = await db.query(
      "SELECT id FROM ai_jobs WHERE id=$1 AND user_id=$2 AND state='running' AND claimed_by=$3 FOR UPDATE",
      [selected.jobId, owner, parent.leaseToken],
    );
    if (!job.rowCount) fail(409, "This page inference claim expired.");
    await assertJobAiProviderChoice(db, owner, selected.jobId);
    await assertOrigin(db, owner, origin);
  };
  const assertAuthority = async () => {
    await model.ai.assertAuthority?.();
    await transaction(assertAccess);
  };
  return {
    ...model,
    ai: {
      ...model.ai,
      assertAuthority,
      recordUsage: managedUsageRecorder(owner, selected.jobId, model.ai),
      recordCompletion: async () => {
        await model.ai.assertAuthority?.();
        await transaction(async (db) => {
          await assertAccess(db);
          await recordProviderUse(
            owner,
            selected.jobId,
            "default",
            model.ai.model,
            false,
            "completed",
            undefined,
            db,
          );
        });
      },
    },
  };
}
