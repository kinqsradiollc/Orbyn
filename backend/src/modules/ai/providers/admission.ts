import { pool } from "../../../db/pool.js";
import { readAiProviderChoice } from "../../auth/ai-provider-choice.js";
import { resolveAi } from "./resolve.js";
import type { AiProviderChoice } from "@orbyn/core";
import type { ResolvedAi } from "./adapters.js";

/** Admission advertises the selected route; dispatch still verifies live account authority. */
export async function assistantProviderCapabilities(
  owner: string,
  readChoice: (owner: string) => Promise<AiProviderChoice> = (id) =>
    readAiProviderChoice(pool, id),
  managed: () => Promise<ResolvedAi | null> = resolveAi,
): Promise<{ enabled: boolean; tools: boolean }> {
  const choice = await readChoice(owner);
  if (choice.primary === "chatgpt") {
    // Device readiness is rechecked at dispatch. Admission must not require
    // a workspace provider or substitute it for this personal choice.
    if (choice.connection_id && choice.executor_id)
      return { enabled: true, tools: false };
    if (!choice.fallback_to_default) return { enabled: false, tools: false };
    return { enabled: !!(await managed()), tools: false };
  }
  const provider = await managed();
  return {
    enabled: !!provider,
    tools: !!provider && !provider.structuredOutput,
  };
}
