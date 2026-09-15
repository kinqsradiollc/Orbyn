import type { FastifyBaseLogger } from "fastify";
import type { Action, ChatTurn } from "@orbyn/core";
import { ProviderError, type ResolvedAi } from "../providers/adapters.js";
import { parseReply } from "../provider.js";
import {
  EMPTY_ANSWER_NOTE,
  FINAL_STEP_NOTE,
  PROMISED_TOOLS_NOTE,
  PROSE_ANSWER_NOTE,
  agentPrompt,
  dateReminder,
} from "./prompt.js";
import {
  rejectsTools,
  startingMode,
  step,
  type AgentMessage,
  type Mode,
  type StepResult,
} from "./protocol.js";
import { runTool, TOOL_SPECS, type AgentContext } from "./tools.js";
import { runGraph } from "./graph.js";

/**
 * The agent loop, after BrainRouter's runTurn: one loop of model call, then
 * tools, then repeat, with guards when the model stops without answering.
 * Limits are sized for a planner, not a coding agent.
 */
export const MAX_STEPS = 8;
const MAX_CALLS_PER_STEP = 8;
const GUARD_BUDGET = 2;
const DEADLINE_MS = 110_000;
const ATTEMPT_MS = 45_000;
const MAX_HISTORY_CHARS = 4000;

export type AgentResult = {
  summary: string;
  actions: Action[];
  follow_ups: string[];
  /** The reply came in the old single-JSON format (actions not yet vetted). */
  legacy: boolean;
  steps: number;
  partial: boolean;
};

const PROMISE =
  /^(sure|ok(ay)?|absolutely|great)?[,!.\s-]*(i('| wi)ll|i am going to|let me|one moment|give me a (sec|moment)|checking|looking|i'm going to)\b/i;

const RETRYABLE =
  /^(timeout|network|http_(429|5\d\d)|no_choices|error_envelope)$/;

/** Clip a message to the provider's per-message limit (Matilda: 16,000). */
function fit(messages: AgentMessage[], ai: ResolvedAi): AgentMessage[] {
  const limits = ai.limits;
  if (!limits) return messages;
  const clip = (s: string) =>
    s.length > limits.maxMessageChars
      ? `${s.slice(0, limits.maxMessageChars - 1)}…`
      : s;
  let out = messages.map((m) => ({
    ...m,
    content: clip(m.content),
  })) as AgentMessage[];
  // Over the body limit: drop the oldest history (never the system prompt or
  // the latest request), then shorten the oldest tool results.
  const size = () => Buffer.byteLength(JSON.stringify(out));
  while (size() > limits.maxBodyBytes - 4000) {
    const i = out.findIndex(
      (m, n) =>
        n > 0 &&
        (m.role === "user" || m.role === "assistant") &&
        n < out.length - 3,
    );
    if (i < 0) break;
    out = out.filter((_, n) => n !== i);
  }
  for (let n = 1; n < out.length && size() > limits.maxBodyBytes - 4000; n++) {
    const m = out[n];
    if (m.role === "tool" && m.content.length > 400)
      out[n] = {
        ...m,
        content: `${m.content.slice(0, 400)}…(shortened to fit the provider's limit)`,
      };
  }
  return out;
}

export async function runAgent(
  ai: ResolvedAi,
  ctx: AgentContext,
  message: string,
  history: ChatTurn[],
  overview: unknown,
  log?: FastifyBaseLogger,
): Promise<AgentResult> {
  // Providers that are weak at multi-step tool use get the fixed graph.
  if (ai.structuredOutput)
    return runGraph(ai, ctx, message, history, overview, log);
  const messages: AgentMessage[] = [
    { role: "system", content: agentPrompt(ctx.timezone, overview) },
    ...history.slice(-12).map((t) => ({
      role: t.role,
      content:
        t.content.length > MAX_HISTORY_CHARS
          ? `${t.content.slice(0, MAX_HISTORY_CHARS)}…`
          : t.content,
    })),
    {
      role: "user",
      // In the JSON protocol the long tool description sits between the
      // system prompt's dates and the request: repeat them next to it.
      content:
        startingMode(ai) === "json"
          ? `${message}\n\n(${dateReminder(ctx.timezone)})`
          : message,
    },
  ];
  let mode: Mode = startingMode(ai);
  const deadline = AbortSignal.timeout(DEADLINE_MS);
  let guards = GUARD_BUDGET;
  let toolsRan = 0;
  const seen = new Map<string, number>();

  const call = async (toolsAllowed: boolean): Promise<StepResult> => {
    for (let attempt = 1; ; attempt++) {
      try {
        // The JSON protocol offers fewer tools: the overview is already in the
        // prompt, and Matilda wandered through get_overview and list_teams.
        const tools =
          mode === "json"
            ? TOOL_SPECS.filter(
                (t) => t.name !== "get_overview" && t.name !== "list_teams",
              )
            : TOOL_SPECS;
        return await step(ai, fit(messages, ai), tools, {
          mode,
          toolsAllowed,
          signal: AbortSignal.any([deadline, AbortSignal.timeout(ATTEMPT_MS)]),
        });
      } catch (error) {
        if (mode === "native" && rejectsTools(error)) {
          log?.warn(
            { event: "ai_agent_json_protocol", provider: ai.kind },
            "Provider rejected tools; using the JSON protocol",
          );
          mode = "json";
          continue;
        }
        const reason =
          error instanceof ProviderError ? error.reason : "unexpected";
        log?.warn(
          { event: "ai_agent_retry", attempt, reason, provider: ai.kind },
          "AI agent step failed",
        );
        if (attempt >= 2 || deadline.aborted || !RETRYABLE.test(reason))
          throw error;
      }
    }
  };

  const finish = async (
    text: string,
    steps: number,
    partial: boolean,
  ): Promise<AgentResult> => {
    let summary = text.trim();
    let actions = ctx.actions;
    let legacy = false;
    // An older-style single JSON reply ({summary, actions}) from a provider
    // that answered without tools: keep working, vetted by the route.
    if (
      !ctx.actions.length &&
      /^\s*(```json\s*)?\{[\s\S]*"summary"[\s\S]*\}\s*(```)?\s*$/.test(summary)
    ) {
      try {
        const reply = parseReply(summary, ctx.timezone);
        summary = reply.summary;
        actions = reply.actions;
        legacy = true;
      } catch {
        // A broken plan must not reach the user as raw JSON.
        throw new ProviderError(
          "invalid_json",
          "The provider returned an invalid plan.",
        );
      }
    }
    // Structured replies from some providers are thin: write the answer as prose.
    if (
      mode === "json" &&
      toolsRan > 0 &&
      summary.length < 300 &&
      !actions.length &&
      !ctx.clarification &&
      !deadline.aborted
    ) {
      messages.push({ role: "user", content: PROSE_ANSWER_NOTE });
      try {
        const prose = (await call(false)).text.trim();
        if (prose) summary = prose;
      } catch {
        // Keep the structured answer.
      }
    }
    // A question means the model isn't sure: nothing it proposed before
    // asking goes to the user (Matilda proposed, then asked, in live tests).
    if (ctx.clarification) {
      summary = ctx.clarification.question;
      actions = [];
    }
    if (!summary)
      summary = actions.length
        ? actions.length === 1
          ? "Here's the change for you to review."
          : `Here are ${actions.length} changes for you to review.`
        : "I couldn't find an answer to that. Could you rephrase it?";
    if (partial)
      summary +=
        "\n\n_I ran out of steps before finishing, so this may be incomplete._";
    return {
      summary,
      actions,
      follow_ups: ctx.clarification?.options ?? [],
      legacy,
      steps,
      partial,
    };
  };

  for (let n = 1; n <= MAX_STEPS; n++) {
    const last = n === MAX_STEPS;
    if (last) messages.push({ role: "user", content: FINAL_STEP_NOTE });
    const result = await call(!last);

    if (result.toolCalls.length) {
      const calls = result.toolCalls.slice(0, MAX_CALLS_PER_STEP);
      messages.push({
        role: "assistant",
        content: result.text,
        tool_calls: calls,
      });
      for (const c of calls) {
        const key = `${c.name}|${c.arguments}`;
        const count = (seen.get(key) ?? 0) + 1;
        seen.set(key, count);
        const out =
          count >= 3
            ? {
                content: JSON.stringify({
                  error:
                    "You already ran this exact call twice. Use those results and move on.",
                }),
                isError: true,
              }
            : await runTool(c, ctx);
        messages.push({
          role: "tool",
          tool_call_id: c.id,
          name: c.name,
          content: out.content,
        });
        toolsRan++;
        if (ctx.clarification) return finish("", n, false);
      }
      continue;
    }

    const text = result.text.trim();
    // An empty reply (Matilda sometimes sends `{"tool_calls": [], "answer": null}`)
    // gets one nudge, whether or not tools ran first.
    if (!text && guards-- > 0 && !last) {
      messages.push({ role: "user", content: EMPTY_ANSWER_NOTE });
      continue;
    }
    if (
      text &&
      text.length < 400 &&
      PROMISE.test(text) &&
      !ctx.actions.length &&
      guards-- > 0 &&
      !last
    ) {
      messages.push({ role: "assistant", content: text });
      messages.push({ role: "user", content: PROMISED_TOOLS_NOTE });
      continue;
    }
    return finish(text, n, false);
  }
  return finish("", MAX_STEPS, true);
}
