import type { FastifyBaseLogger } from "fastify";
import { agentReply, fail, type AgentReply, type ChatTurn } from "@orbyn/core";
import { env } from "../../config/env.js";
import { systemPrompt } from "./prompt.js";

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
 * Ask any OpenAI-compatible chat completions endpoint for a plan. The reply is
 * validated against `agentReply`; nothing here writes to the database.
 * Retries once when the provider fails or returns something unusable.
 */
export async function askProvider(
  message: string,
  timezone: string,
  items: unknown[],
  history: ChatTurn[] = [],
  log?: FastifyBaseLogger,
): Promise<AgentReply> {
  if (!env.AI_MODEL)
    fail(
      503,
      "AI is not configured. Set AI_BASE_URL, AI_MODEL and AI_API_KEY on the server.",
    );
  try {
    new Intl.DateTimeFormat("en", { timeZone: timezone });
  } catch {
    fail(422, "Unknown timezone");
  }
  const messages = [
    { role: "system", content: systemPrompt(timezone) },
    ...history.slice(-12).map((turn) => ({
      role: turn.role,
      content: turn.content,
    })),
    {
      role: "user",
      content: JSON.stringify({ planner: items, request: message }),
    },
  ];
  let reason = "unknown";
  // Both attempts share one deadline, below the client/proxy timeouts.
  const deadline = AbortSignal.timeout(60000);
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    if (deadline.aborted) break;
    try {
      const response = await fetch(
        env.AI_BASE_URL.replace(/\/$/, "") + "/chat/completions",
        {
          method: "POST",
          signal: deadline,
          headers: {
            "Content-Type": "application/json",
            ...(env.AI_API_KEY
              ? { Authorization: `Bearer ${env.AI_API_KEY}` }
              : {}),
          },
          body: JSON.stringify({ model: env.AI_MODEL, messages }),
        },
      );
      if (!response.ok) {
        reason = `http_${response.status}`;
        continue;
      }
      const result = (await response.json()) as {
        choices?: { message?: { content?: string } }[];
      };
      const content = result.choices?.[0]?.message?.content;
      if (!content) {
        reason = "empty_reply";
        continue;
      }
      try {
        return parseReply(content);
      } catch (error) {
        reason =
          error instanceof SyntaxError ? "invalid_json" : "schema_mismatch";
      }
    } catch (error) {
      reason =
        error instanceof Error && error.name === "TimeoutError"
          ? "timeout"
          : "network";
    }
    // Content is never logged: it contains the user's planner.
    log?.warn({ event: "ai_provider_retry", attempt, reason }, "AI retry");
  }
  log?.error({ event: "ai_provider_failed", reason }, "AI provider failed");
  fail(502, "The AI provider could not return a valid plan. Please try again.");
}
