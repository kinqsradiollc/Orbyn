/** Reviewed endpoint assignments from https://opencode.ai/docs/zen, 8 October 2026.
 * Legacy/free IDs are cross-checked against https://models.dev/api.json, as used
 * by https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/provider/provider.ts.
 * Exact IDs only: model families do not reliably identify the gateway protocol.
 */
const responses = new Set([
  "gpt-6-astra",
  "gpt-6-sol",
  "gpt-6.1-sol",
  "gpt-6-luna",
  "gpt-5.6-sol",
  "gpt-5.6-terra",
  "gpt-5.6-luna",
  "gpt-5.5",
  "gpt-5.5-pro",
  "gpt-5.4",
  "gpt-5.4-pro",
  "gpt-5.4-mini",
  "gpt-5.4-nano",
  "gpt-5.3-codex",
  "gpt-5.3-codex-spark",
  "gpt-5.2",
  "gpt-5.2-codex",
  "gpt-5.1",
  "gpt-5.1-codex",
  "gpt-5.1-codex-max",
  "gpt-5.1-codex-mini",
  "gpt-5",
  "gpt-5-codex",
  "gpt-5-nano",
  "grok-4.7",
  "grok-4.6",
  "grok-4.5",
  "grok-build-0.1",
  "muse-spark-1.3",
  "muse-spark-1.2",
  "muse-spark-1.2-contributor-free",
  "muse-spark-1.3-contributor-free",
]);
const messages = new Set([
  "claude-fable-5-1",
  "claude-fable-5",
  "claude-opus-5-5",
  "claude-opus-5",
  "claude-opus-4-8",
  "claude-opus-4-7",
  "claude-opus-4-6",
  "claude-opus-4-5",
  "claude-sonnet-5",
  "claude-sonnet-4-6",
  "claude-sonnet-4-5",
  "claude-haiku-4-5",
  "qwen3.8-flash",
  "qwen3.7-max",
  "qwen3.7-plus",
  "qwen3.6-plus",
  "qwen3.5-plus",
  "qwen3.6-plus-free",
  "minimax-m3-free",
  "minimax-m2.5-free",
  "minimax-m2.1-free",
  "claude-opus-4-1",
  "claude-3-5-haiku",
  "claude-sonnet-4",
  "claude-sonnet-5-5",
]);
const gemini = new Set([
  "gemini-3.8-flash",
  "gemini-3.7-flash",
  "gemini-3.6-flash",
  "gemini-3.5-flash",
  "gemini-3.5-flash-lite",
  "gemini-3.1-pro",
  "gemini-3-flash",
  "gemini-3-pro",
]);

/** Unknown models retain the existing compatible contract, without name guessing. */
export function zenModelTransport(model: string) {
  if (model === "jev-1.13" || model === "jev-1.13-free") return "unsupported";
  if (responses.has(model)) return "responses";
  if (messages.has(model)) return "messages";
  if (gemini.has(model)) return "gemini";
  return "chat";
}
