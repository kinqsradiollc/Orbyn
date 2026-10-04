import { readJobAiProviderChoice } from "../../auth/ai-provider-choice.js";
import {
  queueChatgptInference,
  readChatgptOperation,
  beginChatgptFallback,
  finishChatgptFallback,
  readCachedChatgptFallback,
  assertChatgptJobAccess,
  cancelChatgptInference,
} from "../../auth/chatgpt-inference.js";
import { transaction } from "../../../db/pool.js";
import { resolveAi } from "./resolve.js";
import { fail } from "@orbyn/core";
import { recordProviderUse } from "../provider-provenance.js";
import {
  ProviderError,
  type ResolvedAi,
  type ChatMessage,
} from "./adapters.js";

async function wait(signal: AbortSignal) {
  await new Promise<void>((resolve) => {
    const end = () => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", end);
      resolve();
    }, 500);
    signal.addEventListener("abort", end, { once: true });
    if (signal.aborted) end();
  });
  signal.throwIfAborted();
}
/** A job captures the explicit user choice; later changes cannot silently retarget its data. */
export async function resolveUserAi(
  userId: string,
  jobId: string,
  notice: (message: string) => Promise<void>,
): Promise<ResolvedAi | null> {
  const choice = await readJobAiProviderChoice(userId, jobId);
  const unchanged = async () => {
    const next = await readJobAiProviderChoice(userId, jobId);
    if (JSON.stringify(next) !== JSON.stringify(choice))
      throw new ProviderError(
        "provider_changed",
        "Your AI provider choice changed. Start a fresh request.",
      );
  };
  if (choice.primary === "default") {
    const ai = await resolveAi();
    return ai
      ? {
          ...ai,
          assertAuthority: unchanged,
          recordCompletion: () =>
            recordProviderUse(
              userId,
              jobId,
              "default",
              ai.model,
              false,
              "completed",
            ),
        }
      : null;
  }
  const useDefault = async (reason: string) => {
    await unchanged();
    if (!choice.fallback_to_default)
      throw new ProviderError("chatgpt_unavailable", reason);
    const ai = await resolveAi();
    if (!ai)
      throw new ProviderError(
        "fallback_unavailable",
        "Orbyn's default provider is not available.",
      );
    await notice(
      `Using Orbyn's default provider as your selected fallback. ${reason}`,
    );
    return { ...ai, assertAuthority: unchanged };
  };
  const preferred = choice.connection_id
    ? await transaction(
        async (db) =>
          (
            await db.query(
              "SELECT model FROM chatgpt_model_preferences WHERE connection_id=$1",
              [choice.connection_id],
            )
          ).rows[0]?.model as string | null | undefined,
      )
    : null;
  if (choice.connection_id && choice.executor_id && !preferred)
    throw new ProviderError(
      "chatgpt_model_unavailable",
      "Choose a ChatGPT default model before starting a fresh request.",
    );
  const initialFallback =
    !choice.connection_id || !choice.executor_id
      ? await useDefault("Your ChatGPT connection is unavailable.")
      : null;
  const model = preferred ?? initialFallback!.model;
  const fallback = async (
    messages: ChatMessage[],
    signal: AbortSignal,
    operationId: string,
    reason: string,
  ) => {
    const cached = await readCachedChatgptFallback(userId, jobId, operationId);
    if (cached) return cached.text;
    const managed = await useDefault(reason);
    await beginChatgptFallback(userId, jobId, operationId);
    await recordProviderUse(
      userId,
      jobId,
      "default",
      managed.model,
      true,
      "started",
      operationId,
    );
    const { complete } = await import("./adapters.js");
    const text = await complete(managed, messages, { signal });
    await finishChatgptFallback(
      userId,
      jobId,
      operationId,
      text,
      managed.model,
    );
    return text;
  };
  return {
    kind: "chatgpt_plan",
    assertAuthority: async () => {
      await unchanged();
      await assertChatgptJobAccess(userId, jobId);
    },
    format: "openai",
    baseUrl: "",
    apiKey: "",
    model,
    source: "database",
    options: {},
    providerId: choice.executor_id ?? undefined,
    providerRevision: String(choice.version),
    structuredOutput: "json_schema",
    textTransport: async (
      messages: ChatMessage[],
      signal: AbortSignal,
      operationId?: string,
    ) => {
      await unchanged();
      signal.throwIfAborted();
      if (!operationId) fail(409, "A durable model-call identity is required.");
      if (!choice.connection_id || !choice.executor_id)
        return fallback(
          messages,
          signal,
          operationId,
          "Your ChatGPT connection is unavailable.",
        );
      const instructions = messages
        .filter((m) => m.role === "system")
        .map((m) => m.content)
        .join("\n\n");
      const input = messages
        .filter((m) => m.role !== "system")
        .map((m) => ({
          role: m.role as "user" | "assistant",
          content: m.content,
        }));
      let request;
      try {
        request = await queueChatgptInference(
          userId,
          jobId,
          {
            connection_id: choice.connection_id!,
            executor_id: choice.executor_id!,
          },
          { instructions, input },
          model,
          choice.version,
          operationId,
        );
      } catch (error) {
        // Enqueue rolled back: no device received input and no upstream request started.
        if ((error as { statusCode?: number }).statusCode !== 503) throw error;
        return fallback(
          messages,
          signal,
          operationId,
          "Your ChatGPT device is unavailable.",
        );
      }
      try {
        while (true) {
          await unchanged();
          signal.throwIfAborted();
          const result = await readChatgptOperation(userId, jobId, operationId);
          if (result?.status === "completed") {
            await unchanged();
            return result.text;
          }
          if (result?.status === "failed") {
            // Only a confirmed pre-stream admission rejection can use the explicit fallback.
            if (
              choice.fallback_to_default &&
              result.phase === "admission" &&
              ["eligibility", "usage_limit", "unavailable"].includes(
                result.reason,
              )
            ) {
              await unchanged();
              return fallback(
                messages,
                signal,
                operationId,
                `ChatGPT ${result.reason}.`,
              );
            }
            throw new ProviderError(
              `chatgpt_${result.reason}`,
              result.reason === "usage_limit"
                ? "ChatGPT plan usage limit reached. Manage usage in ChatGPT."
                : "ChatGPT could not complete this request.",
            );
          }
          if (Date.now() >= Date.parse(request.expires_at)) break;
          await wait(signal);
        }
        throw new ProviderError(
          "chatgpt_timeout",
          "ChatGPT completion is unknown. The request was not retried or billed through another provider.",
        );
      } finally {
        await cancelChatgptInference(userId, request.id);
      }
    },
  };
}
