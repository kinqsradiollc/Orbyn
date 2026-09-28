import type { ResolvedAi } from "../providers/adapters.js";
import {
  step as protocolStep,
  type AgentMessage,
  type StepResult,
  type ToolSpec,
} from "./protocol.js";

/** One sequential JSON-protocol step used by the shared assistant tool loop. */
export function runGraphToolStep(
  ai: ResolvedAi,
  messages: AgentMessage[],
  tools: ToolSpec[],
  options: { toolsAllowed: boolean; signal: AbortSignal },
): Promise<StepResult> {
  return protocolStep(ai, messages, tools, {
    ...options,
    mode: "json",
  });
}
