import type { FastifyBaseLogger } from "fastify";
import { agentReply, fail, type AgentReply, type ChatTurn } from "@orbyn/core";
import { systemPrompt } from "./prompt.js";
import {
  complete,
  ProviderError,
  type ChatMessage,
  type ResolvedAi,
} from "./providers/adapters.js";

const ATTEMPTS = 2;

/**
 * Pull the reply object out of whatever the model produced. Tolerates
 * reasoning blocks, code fences, prose around the JSON, and small models that
 * echo the JSON schema with their answer nested under "properties".
 */
export function parseReply(content: string): AgentReply {
  let text = content.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) text = fenced[1];
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) text = text.slice(start, end + 1);
  let value: unknown = JSON.parse(text);
  if (
    value &&
    typeof value === "object" &&
    !("summary" in value) &&
    "properties" in value &&
    value.properties &&
    typeof value.properties === "object" &&
    "summary" in value.properties
  )
    value = value.properties;
  return agentReply.parse(value);
}

/**
 * The messages for one request: the system prompt, recent history, and the
 * user's request with a planner snapshot. For providers with hard request
 * limits (such as Maincode's Matilda) it trims to fit: long messages are
 * shortened, the planner snapshot shows fewer items (and says so), and the
 * oldest history goes first when the whole request is too large.
 */
export function buildMessages(
  ai: Pick<ResolvedAi, "model" | "limits">,
  message: string,
  timezone: string,
  items: unknown[],
  history: ChatTurn[] = [],
): ChatMessage[] {
  const limits = ai.limits;
  const clip = (text: string) =>
    limits && text.length > limits.maxMessageChars
      ? text.slice(0, limits.maxMessageChars - 1) + "…"
      : text;
  let shown = items.length;
  const request = () =>
    JSON.stringify(
      shown < items.length
        ? {
            planner: items.slice(0, shown),
            planner_note: `Only ${shown} of ${items.length} items fit this provider's request limit.`,
            request: message,
          }
        : { planner: items, request: message },
    );
  let turns: ChatMessage[] = history.slice(-12).map((turn) => ({
    role: turn.role,
    content: clip(turn.content),
  }));
  const build = (): ChatMessage[] => [
    { role: "system", content: clip(systemPrompt(timezone)) },
    ...turns,
    { role: "user", content: request() },
  ];
  if (!limits) return build();
  const bytes = () =>
    Buffer.byteLength(JSON.stringify({ model: ai.model, messages: build() }));
  while (shown > 0 && request().length > limits.maxMessageChars) shown--;
  while (turns.length > 0 && bytes() > limits.maxBodyBytes)
    turns = turns.slice(1);
  while (shown > 0 && bytes() > limits.maxBodyBytes) shown--;
  return build();
}

/**
 * Ask `ai` (resolved by the caller, so this never reads the database) for a
 * plan. The reply is validated against `agentReply`; nothing here writes to
 * the database. Retries once when the provider fails or returns something
 * unusable, but both attempts share one deadline, below the client and proxy
 * timeouts, and no retry starts after it has passed.
 */
export async function askProvider(
  ai: ResolvedAi,
  message: string,
  timezone: string,
  items: unknown[],
  history: ChatTurn[] = [],
  log?: FastifyBaseLogger,
): Promise<AgentReply> {
  try {
    new Intl.DateTimeFormat("en", { timeZone: timezone });
  } catch {
    fail(422, "Unknown timezone");
  }
  const messages = buildMessages(ai, message, timezone, items, history);
  let reason = "unknown";
  const deadline = AbortSignal.timeout(60_000);
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    if (deadline.aborted) break;
    try {
      const content = await complete(ai, messages, { signal: deadline });
      if (!content) {
        reason = "empty_reply";
      } else {
        try {
          return parseReply(content);
        } catch (error) {
          reason =
            error instanceof SyntaxError ? "invalid_json" : "schema_mismatch";
        }
      }
    } catch (error) {
      reason = error instanceof ProviderError ? error.reason : "unexpected";
    }
    // Content is never logged: it contains the user's planner.
    log?.warn(
      {
        event: "ai_provider_retry",
        attempt,
        reason,
        provider: ai.kind,
        source: ai.source,
      },
      "AI retry",
    );
  }
  log?.error(
    {
      event: "ai_provider_failed",
      reason,
      provider: ai.kind,
      source: ai.source,
    },
    "AI provider failed",
  );
  fail(502, "The AI provider could not return a valid plan. Please try again.");
}
