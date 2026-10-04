import { readJobAiProviderChoice } from "../../auth/ai-provider-choice.js";
import {
  queueChatgptInference,
  readChatgptInference,
  cancelChatgptInference,
} from "../../auth/chatgpt-inference.js";
import { readChatgptCatalogLocked } from "../../auth/chatgpt-model-catalog.js";
import { transaction } from "../../../db/pool.js";
import { resolveAi } from "./resolve.js";
import { fail } from "@orbyn/core";
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
    return ai ? { ...ai, assertAuthority: unchanged } : null;
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
  if (!choice.connection_id || !choice.executor_id)
    return useDefault("Your ChatGPT connection is unavailable.");
  let catalog;
  try {
    catalog = await transaction(async (db) => {
      const e = (
        await db.query(
          "SELECT session_id FROM chatgpt_executor_enrollments WHERE id=$1 AND connection_id=$2",
          [choice.executor_id, choice.connection_id],
        )
      ).rows[0];
      if (!e) fail(503, "The ChatGPT device is unavailable.");
      return readChatgptCatalogLocked(
        db,
        { userId, sessionId: e.session_id },
        {
          executor_id: choice.executor_id!,
          connection_id: choice.connection_id!,
        },
        false,
        true,
      );
    });
  } catch (error) {
    const status = (error as { statusCode?: number }).statusCode;
    if (status !== 404 && status !== 503) throw error;
    return useDefault("Your ChatGPT device is unavailable.");
  }
  if (catalog.status !== "ready" || !catalog.preference.model)
    return useDefault("Your ChatGPT device or default model is unavailable.");
  const model = catalog.preference.model;
  return {
    kind: "chatgpt_plan",
    assertAuthority: unchanged,
    format: "openai",
    baseUrl: "",
    apiKey: "",
    model,
    source: "database",
    options: {},
    providerId: choice.executor_id,
    providerRevision: String(choice.version),
    structuredOutput: "json_schema",
    textTransport: async (messages: ChatMessage[], signal: AbortSignal) => {
      await unchanged();
      signal.throwIfAborted();
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
        );
      } catch (error) {
        // Enqueue rolled back: no device received input and no upstream request started.
        if ((error as { statusCode?: number }).statusCode !== 503) throw error;
        const managed = await useDefault("Your ChatGPT device is unavailable.");
        const { complete } = await import("./adapters.js");
        return complete(managed, messages, { signal });
      }
      try {
        while (Date.now() < Date.parse(request.expires_at)) {
          await unchanged();
          signal.throwIfAborted();
          const result = await readChatgptInference(userId, jobId, request.id);
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
              await notice(
                `Using Orbyn's default provider as your selected fallback (${result.reason}).`,
              );
              const { complete } = await import("./adapters.js");
              const managed = await resolveAi();
              if (!managed)
                throw new ProviderError(
                  "fallback_unavailable",
                  "Orbyn's default provider is not available.",
                );
              return complete(
                { ...managed, assertAuthority: unchanged },
                messages,
                { signal },
              );
            }
            throw new ProviderError(
              `chatgpt_${result.reason}`,
              result.reason === "usage_limit"
                ? "ChatGPT plan usage limit reached. Manage usage in ChatGPT."
                : "ChatGPT could not complete this request.",
            );
          }
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
