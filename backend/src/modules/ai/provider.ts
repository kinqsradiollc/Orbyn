import { agentReply, fail, type AgentReply } from "@orbyn/core";
import { env } from "../../config/env.js";
import { systemPrompt } from "./prompt.js";

/**
 * Ask any OpenAI-compatible chat completions endpoint for a plan. The reply is
 * validated against `agentReply`; nothing here writes to the database.
 */
export async function askProvider(
  message: string,
  timezone: string,
  items: unknown[],
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
  try {
    const response = await fetch(
      env.AI_BASE_URL.replace(/\/$/, "") + "/chat/completions",
      {
        method: "POST",
        signal: AbortSignal.timeout(60000),
        headers: {
          "Content-Type": "application/json",
          ...(env.AI_API_KEY
            ? { Authorization: `Bearer ${env.AI_API_KEY}` }
            : {}),
        },
        body: JSON.stringify({
          model: env.AI_MODEL,
          messages: [
            { role: "system", content: systemPrompt(timezone) },
            {
              role: "user",
              content: JSON.stringify({ planner: items, request: message }),
            },
          ],
        }),
      },
    );
    if (!response.ok) throw new Error("Provider error");
    const result = (await response.json()) as {
      choices: { message: { content: string } }[];
    };
    const content = result.choices[0].message.content
      .trim()
      .replace(/^```(?:json)?\s*/, "")
      .replace(/\s*```$/, "");
    return agentReply.parse(JSON.parse(content));
  } catch {
    fail(
      502,
      "The AI provider could not return a valid plan. Please try again.",
    );
  }
}
