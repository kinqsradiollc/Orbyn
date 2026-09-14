import type { FastifyBaseLogger } from "fastify";
import { agentReply, fail, type AgentReply, type ChatTurn } from "@orbyn/core";
import { answerPrompt, offsetAt, systemPrompt } from "./prompt.js";
import { wantsChanges } from "./guards.js";
import { dropNulls, REPLY_FORMAT } from "./replySchema.js";
import {
  complete,
  ProviderError,
  type ChatMessage,
  type ResolvedAi,
} from "./providers/adapters.js";

const ATTEMPTS = 2;
/** The whole request, as BrainRouter's 120 s chat timeout minus headroom. */
const DEADLINE_MS = 110_000;
/**
 * One attempt. A provider that stalls mid-reply (Matilda sometimes does) is
 * abandoned after this so the retry still fits in the deadline, like
 * BrainRouter's 45 s quiet timeout for Matilda.
 */
const ATTEMPT_MS = 45_000;

const NAIVE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/;

/**
 * Timestamps without an offset are the user's wall-clock time (models such as
 * Matilda sometimes drop it): add the user's offset for that date rather than
 * rejecting the whole reply.
 */
function addMissingOffsets(value: unknown, timezone?: string): unknown {
  if (!timezone || !value || typeof value !== "object") return value;
  const actions = (value as { actions?: unknown }).actions;
  if (!Array.isArray(actions)) return value;
  for (const action of actions) {
    const data = action && typeof action === "object" ? action.data : null;
    if (!data || typeof data !== "object") continue;
    for (const key of ["due_at", "end_at"]) {
      const at = data[key];
      if (typeof at !== "string" || !NAIVE_TIME.test(at)) continue;
      const full = at.length === 16 ? `${at}:00` : at;
      data[key] = full + offsetAt(timezone, new Date(`${full}Z`));
    }
  }
  return value;
}

/**
 * Pull the reply object out of whatever the model produced. Tolerates
 * reasoning blocks, code fences, prose around the JSON, and small models that
 * echo the JSON schema with their answer nested under "properties".
 */
export function parseReply(content: string, timezone?: string): AgentReply {
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
  return agentReply.parse(addMissingOffsets(dropNulls(value), timezone));
}

/**
 * A plain-text answer as a reply with no actions. If the model sent the JSON
 * reply anyway, that is used instead.
 */
export function answerReply(content: string, timezone?: string): AgentReply {
  const text = content.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  if (text.startsWith("{") || text.startsWith("```")) {
    try {
      return { ...parseReply(text, timezone), actions: [] };
    } catch {
      // Not the JSON reply after all: show the text as it is.
    }
  }
  return agentReply.parse({ summary: text.slice(0, 12000), actions: [] });
}

/** Proposals always come with words: a model that sent none gets a plain line. */
export function withSummary(reply: AgentReply): AgentReply {
  if (reply.summary.trim() || !reply.actions.length) return reply;
  const n = reply.actions.length;
  return {
    ...reply,
    summary:
      n === 1
        ? "Here's the change for you to review."
        : `Here are ${n} changes for you to review.`,
  };
}

/**
 * The messages for one request: the system prompt, recent history, and the
 * user's request with a planner snapshot. For providers with hard request
 * limits (such as Maincode's Matilda) it trims to fit: long messages are
 * shortened, the planner snapshot shows fewer items (and says so), and the
 * oldest history goes first when the whole request is too large.
 */
export function buildMessages(
  ai: Pick<ResolvedAi, "model" | "limits" | "structuredOutput">,
  message: string,
  timezone: string,
  items: unknown[],
  history: ChatTurn[] = [],
  mode: "plan" | "answer" = "plan",
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
    {
      role: "system",
      content: clip(
        mode === "answer" ? answerPrompt(timezone) : systemPrompt(timezone),
      ),
    },
    ...turns,
    { role: "user", content: request() },
  ];
  if (!limits) return build();
  const bytes = () =>
    Buffer.byteLength(
      JSON.stringify({
        model: ai.model,
        messages: build(),
        ...(ai.structuredOutput && mode === "plan"
          ? { response_format: REPLY_FORMAT }
          : {}),
      }),
    );
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
  // Providers that write poor JSON (Matilda) answer questions that change
  // nothing in plain Markdown; change requests still use the reply schema.
  const answerOnly = !!ai.structuredOutput && !wantsChanges(message);
  const messages = buildMessages(
    ai,
    message,
    timezone,
    items,
    history,
    answerOnly ? "answer" : "plan",
  );
  let reason = "unknown";
  const deadline = AbortSignal.timeout(DEADLINE_MS);
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    if (deadline.aborted) break;
    try {
      const content = await complete(ai, messages, {
        signal: AbortSignal.any([deadline, AbortSignal.timeout(ATTEMPT_MS)]),
        ...(answerOnly ? {} : { responseFormat: REPLY_FORMAT }),
      });
      if (!content) {
        reason = "empty_reply";
      } else {
        try {
          const parsed = answerOnly
            ? answerReply(content, timezone)
            : parseReply(content, timezone);
          if (parsed.summary.trim() || parsed.actions.length)
            return withSummary(parsed);
          reason = "empty_reply";
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
