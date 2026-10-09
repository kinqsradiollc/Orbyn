import type { FastifyBaseLogger } from "fastify";
import { complete, ProviderError } from "../modules/ai/providers/adapters.js";
import {
  resolveUserAi,
  ChatgptDeviceDeferred,
} from "../modules/ai/providers/user-choice.js";
import { assertChatgptJobAccess } from "../modules/auth/chatgpt-inference.js";
import {
  agendaSummaryMessages,
  cleanAgendaSummary,
} from "../modules/ai/agenda-brief.js";
import {
  claimScheduledAgenda,
  recordScheduledAgendaSources,
  applyScheduledAgenda,
  deferScheduledAgenda,
  failScheduledAgenda,
} from "../modules/docs/agenda-summary-runs.js";

/** Background-only scoped work; a notifier never owns private model execution. */
export async function claimScheduledAgendaWork(
  log: FastifyBaseLogger,
  runId?: string,
) {
  const claimed = await claimScheduledAgenda(runId);
  if (!claimed?.run.lease_token) return null;
  const { run, jobId, snapshot } = claimed;
  const token = run.lease_token!;
  const controller = new AbortController();
  return {
    stop: () => controller.abort(),
    run: async () => {
      try {
        await recordScheduledAgendaSources(run, jobId);
        const ai = await resolveUserAi(
          run.user_id,
          jobId,
          async () => {},
          true,
        );
        if (!ai) throw new Error("The selected provider is unavailable.");
        const assertAuthority = async () => {
          await ai.assertAuthority?.();
          await assertChatgptJobAccess(run.user_id, jobId);
        };
        const raw = await complete(
          { ...ai, operationId: run.operation_id, assertAuthority },
          agendaSummaryMessages(snapshot.facts),
          {
            signal: AbortSignal.any([
              controller.signal,
              AbortSignal.timeout(30_000),
            ]),
            timeoutMs: 30_000,
            maxOutputTokens: 512,
          },
        );
        await assertAuthority();
        await ai.recordCompletion?.();
        const text = cleanAgendaSummary(raw);
        if (!text) throw new Error("No usable Agenda summary.");
        await applyScheduledAgenda(run.user_id, run.id, token, text);
      } catch (error) {
        if (error instanceof ChatgptDeviceDeferred) {
          try {
            await deferScheduledAgenda(run.user_id, run.id, token);
            return;
          } catch {
            /* Changed authority cannot remain in a waiting queue. */
          }
        }
        const reason =
          error instanceof ProviderError &&
          error.reason === "chatgpt_usage_limit"
            ? "usage_limit"
            : [403, 409].includes(
                  (error as { statusCode?: number })?.statusCode ?? 0,
                )
              ? "authority_changed"
              : "provider_failed";
        await failScheduledAgenda(run.user_id, run.id, token, reason).catch(
          () => {},
        );
        log.warn({ run_id: run.id, reason }, "Scheduled Agenda summary held");
      }
    },
  };
}
