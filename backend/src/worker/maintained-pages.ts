import { refuseSecrets } from "../capabilities/write.js";
import { syncSavedPages } from "../modules/study/service.js";
import type { FastifyBaseLogger } from "fastify";
import { transaction } from "../db/pool.js";
import { complete, attemptMsFor } from "../modules/ai/providers/adapters.js";
import {
  maintainedPagePatchInput,
  type MaintainedPageModelOrigin,
} from "@orbyn/core";
import {
  maintainedPageMessages,
  resolveMaintainedPageModel,
  PageModelUnavailable,
  type PageModel,
} from "../modules/docs/maintenance-model.js";
import { MaintainedPageReviewRequired } from "../modules/docs/maintenance.js";
import {
  claimMaintainedPageRun,
  guardMaintainedPageRun,
  renewMaintainedPageRun,
  reserveMaintainedPageModel,
  deferMaintainedPageModel,
  stageMaintainedPageRun,
  applyMaintainedPageRun,
  waitMaintainedPageRun,
  failMaintainedPageRun,
  type PageRun,
  PageRunBudgetExceeded,
} from "../modules/docs/maintenance-runs.js";

/** One scoped consumer iteration; provider calls hold no database transaction. */
export async function processMaintainedPageRun(
  log: FastifyBaseLogger,
  lane: PageRun["lane"],
  options: {
    now?: () => Date;
    signal?: AbortSignal;
    runId?: string;
    resolveModel?: (
      userId: string,
      origin: MaintainedPageModelOrigin,
    ) => Promise<PageModel>;
    request?: typeof complete;
    heartbeatMs?: number;
  } = {},
) {
  if (options.signal?.aborted) return { state: "stopped" as const };
  const now = options.now ?? (() => new Date());
  const run = await transaction((db) =>
    claimMaintainedPageRun(db, lane, now(), options.runId),
  );
  if (!run?.lease_token) return { state: "idle" as const };
  const token = run.lease_token;
  const controller = new AbortController();
  const signal = AbortSignal.any([
    controller.signal,
    AbortSignal.timeout(600000),
    ...(options.signal ? [options.signal] : []),
  ]);
  let heartbeat: Promise<void> | null = null;
  const timer = setInterval(() => {
    if (heartbeat) return;
    heartbeat = transaction((db) =>
      renewMaintainedPageRun(db, run.id, token, now()),
    )
      .catch(() => controller.abort())
      .finally(() => {
        heartbeat = null;
      });
  }, options.heartbeatMs ?? 15000);
  timer.unref();
  let failure:
    | "provider_failed"
    | "budget_exceeded"
    | "authority_changed"
    | "source_changed" = "authority_changed";
  try {
    const context = await transaction((db) =>
      guardMaintainedPageRun(db, run.id, token, now()),
    );
    let model: PageModel;
    try {
      model = await (options.resolveModel ?? resolveMaintainedPageModel)(
        context.user.id,
        context.run.model_origin,
      );
    } catch (error) {
      if (!(error instanceof PageModelUnavailable)) throw error;
      await transaction((db) =>
        deferMaintainedPageModel(db, run.id, token, error.reason, now()),
      );
      return { state: "deferred" as const, runId: run.id };
    }
    if (context.run.model_key && context.run.model_key !== model.key) {
      failure = "authority_changed";
      throw new Error("The model selection changed.");
    }
    if (!context.run.proposal) {
      const messages = maintainedPageMessages(
        context.binding.instruction,
        context.blocks,
        context.binding.revision,
        { at: now().toISOString(), timezone: context.binding.timezone },
      );
      refuseSecrets(JSON.stringify(messages), model.ai.model);
      const inputBudget = Buffer.byteLength(JSON.stringify(messages)) + 1024;
      const maxOutputTokens = Math.min(
        4096,
        Math.min(
          context.run.token_budget - context.run.token_estimate,
          context.nightAvailableTokens ?? Number.POSITIVE_INFINITY,
        ) - inputBudget,
      );
      if (maxOutputTokens < 256) {
        failure = "budget_exceeded";
        throw new Error("The selected section exceeds this run budget.");
      }
      const reserved = inputBudget + maxOutputTokens;
      failure = "authority_changed";
      // Recheck selection and current source immediately before reserving/transmitting.
      if (
        (
          await (options.resolveModel ?? resolveMaintainedPageModel)(
            context.user.id,
            context.run.model_origin,
          )
        ).key !== model.key
      )
        throw new Error("The model selection changed.");
      if (signal.aborted) throw new Error("stopped");
      await transaction((db) =>
        reserveMaintainedPageModel(
          db,
          run.id,
          token,
          reserved,
          model.key,
          now(),
        ),
      );
      if (signal.aborted) throw new Error("stopped");
      failure = "provider_failed";
      const text = await (options.request ?? complete)(model.ai, messages, {
        signal: AbortSignal.any([
          signal,
          AbortSignal.timeout(
            Math.max(
              1,
              Math.min(
                attemptMsFor(model.ai),
                context.run.end_at
                  ? context.run.end_at.getTime() - now().getTime()
                  : Number.POSITIVE_INFINITY,
              ),
            ),
          ),
        ]),
        maxOutputTokens,
      });
      if (Buffer.byteLength(text) > 262144)
        throw new Error("The model response exceeds the supported size.");
      const proposal = maintainedPagePatchInput.parse(JSON.parse(text));
      failure = "authority_changed";
      if (
        (
          await (options.resolveModel ?? resolveMaintainedPageModel)(
            context.user.id,
            context.run.model_origin,
          )
        ).key !== model.key
      )
        throw new Error("The model selection changed.");
      await transaction((db) =>
        stageMaintainedPageRun(db, run.id, token, proposal, reserved, now()),
      );
    }
    failure = "source_changed";
    try {
      const applied = await transaction((db) =>
        applyMaintainedPageRun(db, run.id, token, now()),
      );
      await syncSavedPages(applied.doc.id);
      return { state: "done" as const, runId: run.id };
    } catch (error) {
      if (!(error instanceof MaintainedPageReviewRequired)) throw error;
      await transaction((db) =>
        waitMaintainedPageRun(db, run.id, token, error, now()),
      );
      return { state: "waiting" as const, runId: run.id };
    }
  } catch (error) {
    if (error instanceof PageRunBudgetExceeded) failure = "budget_exceeded";
    // Never persist/log raw provider errors or generated private text.
    await transaction((db) =>
      failMaintainedPageRun(db, run.id, token, failure, now()),
    ).catch(() => {});
    log.warn({ run_id: run.id, reason: failure }, "Scoped page run held");
    return { state: "failed" as const, runId: run.id };
  } finally {
    clearInterval(timer);
    controller.abort();
    await heartbeat;
  }
}
