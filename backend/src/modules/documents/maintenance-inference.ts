import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { fail, type MaintainedPageModelOrigin } from "@orbyn/core";
import { transaction, type Db } from "../../db/pool.js";
import { recordAssistantSources } from "../../lib/assistant-job-sources.js";
import { readAiProviderChoice } from "../auth/ai-provider-choice.js";
import { readChatgptCatalogLocked } from "../auth/chatgpt-model-catalog.js";
import { resolveUserAi } from "../ai/providers/user-choice.js";
import {
  guardMaintainedPageRun,
  deferMaintainedPageModel,
} from "./maintenance-runs.js";
import { PageModelUnavailable, type PageModel } from "./maintenance-model.js";

export type PageInferenceContext = {
  runId: string;
  leaseToken: string;
  now?: Date;
};
const checkpoint = z
  .object({
    version: z.literal(3),
    parent_lease: z.uuid(),
    operation_id: z.uuid(),
  })
  .passthrough();

/** The page parent is locked before its companion, matching worker heartbeats. */
export async function guardPageInferenceJob(
  db: Db,
  owner: string,
  jobId: string,
) {
  const job = (
    await db.query(
      "SELECT maintenance_run_id,run_state,claimed_by FROM ai_jobs WHERE id=$1 AND user_id=$2",
      [jobId, owner],
    )
  ).rows[0];
  if (!job || (!job.maintenance_run_id && job.run_state?.version !== 3)) return;
  const state = checkpoint.safeParse(job.run_state);
  if (
    !job.maintenance_run_id ||
    !state.success ||
    job.claimed_by !== state.data.parent_lease
  )
    fail(409, "This page transport is no longer owned by its worker.");
  const context = await guardMaintainedPageRun(
    db,
    job.maintenance_run_id,
    state.data.parent_lease,
    new Date(),
    owner,
  );
  const origin = context.run.model_origin;
  const choice = await readAiProviderChoice(db, owner);
  const preference =
    origin.kind === "chatgpt"
      ? (
          await db.query(
            "SELECT model,version FROM chatgpt_model_preferences WHERE connection_id=$1",
            [origin.connection_id],
          )
        ).rows[0]
      : null;
  if (
    origin.kind !== "chatgpt" ||
    choice.primary !== "chatgpt" ||
    origin.connection_id !== choice.connection_id ||
    origin.provider_choice_version !== choice.version ||
    preference?.model !== origin.model ||
    Number(preference?.version) !== origin.preference_version
  )
    fail(409, "The captured page provider or model changed.");
}

/** Reuse one genuine broker context under the page lease, never an arbitrary job ID. */
export async function resolvePrivatePageModel(
  owner: string,
  origin: MaintainedPageModelOrigin,
  parent: PageInferenceContext,
): Promise<PageModel> {
  const selected = await transaction(async (db) => {
    await db.query("SELECT id FROM users WHERE id=$1 FOR SHARE", [owner]);
    const context = await guardMaintainedPageRun(
      db,
      parent.runId,
      parent.leaseToken,
      parent.now ?? new Date(),
      owner,
    );
    const choice = await readAiProviderChoice(db, owner);
    if (
      JSON.stringify(context.run.model_origin) !== JSON.stringify(origin) ||
      origin.kind !== "chatgpt" ||
      choice.primary !== "chatgpt" ||
      origin.connection_id !== choice.connection_id ||
      origin.provider_choice_version !== choice.version
    )
      throw new PageModelUnavailable("provider_choice_changed");
    const preference = (
      await db.query(
        "SELECT model,version FROM chatgpt_model_preferences WHERE connection_id=$1",
        [origin.connection_id],
      )
    ).rows[0];
    if (
      !preference ||
      preference.model !== origin.model ||
      Number(preference.version) !== origin.preference_version
    )
      throw new PageModelUnavailable("provider_choice_changed");
    if (!context.run.proposal && !choice.fallback_to_default) {
      if (!choice.executor_id)
        throw new PageModelUnavailable("chatgpt_device_required");
      try {
        const device = (
          await db.query(
            "SELECT session_id FROM chatgpt_executor_enrollments WHERE id=$1",
            [choice.executor_id],
          )
        ).rows[0];
        if (!device) throw new PageModelUnavailable("chatgpt_device_required");
        const catalog = await readChatgptCatalogLocked(
          db,
          { userId: owner, sessionId: device.session_id },
          {
            connection_id: origin.connection_id,
            executor_id: choice.executor_id,
          },
          false,
          true,
          true,
        );
        if (
          catalog.status !== "ready" ||
          !catalog.models.some((model) => model.slug === origin.model)
        )
          throw new PageModelUnavailable("chatgpt_device_required");
      } catch (error) {
        if (error instanceof PageModelUnavailable) throw error;
        if (
          [404, 503].includes(
            (error as { statusCode?: number }).statusCode ?? 0,
          )
        )
          throw new PageModelUnavailable("chatgpt_device_required");
        throw error;
      }
    }
    let job = (
      await db.query(
        "SELECT * FROM ai_jobs WHERE maintenance_run_id=$1 FOR UPDATE",
        [parent.runId],
      )
    ).rows[0];
    if (!job) {
      if (context.run.proposal)
        fail(409, "This staged page update has no inference receipt.");
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
    } else if (!context.run.proposal && job.claimed_by !== parent.leaseToken) {
      const disclosed = await db.query(
        "SELECT 1 FROM chatgpt_inference_operations WHERE job_id=$1 LIMIT 1",
        [job.id],
      );
      if (
        context.run.reserved_tokens ||
        disclosed.rowCount ||
        job.result?.feature_provider
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
    const state = checkpoint.parse(job.run_state);
    await db.query(
      "INSERT INTO assistant_job_sources(job_id,source_kind,source_id) VALUES($1,'doc',$2) ON CONFLICT DO NOTHING",
      [job.id, context.binding.doc_id],
    );
    return {
      jobId: job.id as string,
      operationId: state.operation_id,
      key: createHash("sha256")
        .update(
          JSON.stringify({
            origin,
            executor: choice.executor_id,
            fallback: choice.fallback_to_default,
          }),
        )
        .digest("base64url"),
    };
  });
  await recordAssistantSources(selected.jobId, owner, {});
  const ai = await resolveUserAi(owner, selected.jobId, async () => {}, true);
  if (!ai) throw new PageModelUnavailable("not_configured");
  return {
    key: selected.key,
    ai: { ...ai, operationId: selected.operationId },
  };
}

/** Release only a reservation whose durable transport proves no dispatch began. */
export async function deferUndispatchedPrivatePage(
  owner: string,
  parent: PageInferenceContext,
): Promise<boolean> {
  return transaction(async (db) => {
    const { run } = await guardMaintainedPageRun(
      db,
      parent.runId,
      parent.leaseToken,
      parent.now ?? new Date(),
      owner,
    );
    const choice = await readAiProviderChoice(db, owner);
    if (
      run.model_origin.kind !== "chatgpt" ||
      choice.primary !== "chatgpt" ||
      choice.fallback_to_default ||
      run.proposal ||
      run.token_estimate !== run.reserved_tokens
    )
      return false;
    const job = (
      await db.query(
        "SELECT id,run_state,claimed_by,state FROM ai_jobs WHERE maintenance_run_id=$1 AND user_id=$2 FOR UPDATE",
        [run.id, owner],
      )
    ).rows[0];
    const state = checkpoint.safeParse(job?.run_state);
    if (
      !state.success ||
      job.claimed_by !== parent.leaseToken ||
      state.data.parent_lease !== parent.leaseToken ||
      job.state !== "running"
    )
      return false;
    await guardPageInferenceJob(db, owner, job.id);
    if (
      (
        await db.query(
          "SELECT 1 FROM chatgpt_inference_operations WHERE job_id=$1 LIMIT 1",
          [job.id],
        )
      ).rowCount
    )
      return false;
    if (run.night_id && run.reserved_tokens) {
      const restored = await db.query(
        "UPDATE assistant_nights SET budget_used=budget_used-$3,updated_at=$4 WHERE id=$1 AND user_id=$2 AND budget_used>=$3 RETURNING id",
        [run.night_id, owner, run.reserved_tokens, parent.now ?? new Date()],
      );
      if (!restored.rowCount) return false;
    }
    await db.query(
      "UPDATE assistant_page_runs SET token_estimate=token_estimate-reserved_tokens,reserved_tokens=0,model_key=NULL WHERE id=$1",
      [run.id],
    );
    await deferMaintainedPageModel(
      db,
      run.id,
      parent.leaseToken,
      "chatgpt_device_required",
      parent.now ?? new Date(),
    );
    return true;
  });
}
