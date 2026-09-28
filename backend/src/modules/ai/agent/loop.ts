import { fitData } from "./format.js";
import type { FastifyBaseLogger } from "fastify";
import type { Action, ChatTurn, AssistantSource, DraftNote } from "@orbyn/core";
import {
  attemptMsFor,
  ProviderError,
  type ResolvedAi,
} from "../providers/adapters.js";
import { parseReply } from "../replySchema.js";
import {
  EMPTY_ANSWER_NOTE,
  FINAL_STEP_NOTE,
  PROMISED_TOOLS_NOTE,
  PROSE_ANSWER_NOTE,
  agentPrompt,
} from "./prompt.js";
import {
  rejectsTools,
  startingMode,
  step,
  type AgentMessage,
  type Mode,
  type StepResult,
  type ToolCall,
  type ToolSpec,
} from "./protocol.js";
import { runTool, TOOL_SPECS, type AgentContext } from "./tools.js";
import { runGraph, runGraphToolStep } from "./graph.js";
import { finalizeSources } from "./sources.js";

/**
 * The agent loop, after BrainRouter's runTurn: one loop of model call, then
 * tools, then repeat, with guards when the model stops without answering.
 * Limits are sized for a planner, not a coding agent.
 */
export const MAX_STEPS = 8;
const MAX_CALLS_PER_STEP = 8;
const GUARD_BUDGET = 2;
// The turn runs in the background (POST /ai/chat/start, then polled), so
// nothing in front of Orbyn cuts it off; this is the most a turn may take
// in all. Each model call gets `attemptMsFor(ai)`.
const DEADLINE_MS = 600_000;
const MAX_HISTORY_CHARS = 4000;

export type AgentResult = {
  summary: string;
  actions: Action[];
  follow_ups: string[];
  /** Pages read while answering, so the reply can point at them. */
  sources: AssistantSource[];
  /** Notes drafted this turn, which become pages only if kept. */
  notes: DraftNote[];
  /** The reply came in the old single-JSON format (actions not yet vetted). */
  legacy: boolean;
  steps: number;
  partial: boolean;
};

/** A content-free event that can be shown in a conversation's trace. */
export type AgentTraceEvent = {
  step: number;
  kind: "thinking" | "tool" | "result" | "reply" | "error";
  label: string;
  tool?: string;
};
export type AgentTrace = (event: AgentTraceEvent) => void;

export type LoopToolResult = {
  content: string;
  isError: boolean;
  /** Stop after this tool result (used by a specialist's report tool). */
  stop?: boolean;
};

/** Optional controls for the shared internal and specialist loop. */
export type AgentLoopOptions = {
  /** A focused instruction set instead of the built-in planner prompt. */
  systemPrompt?: string;
  /** Narrowed MCP tool descriptions for a specialist or the lead. */
  tools?: ToolSpec[];
  /** Route a tool through MCP or stage it, rather than the legacy registry. */
  executeTool?: (call: ToolCall, ctx: AgentContext) => Promise<LoopToolResult>;
  /** Maximum model/tool iterations for this run. */
  maxSteps?: number;
  /** Keep one tool call per reasoning step for the lead and specialists. */
  maxToolCallsPerStep?: number;
  /** Use the sequential JSON graph step for providers with structured output. */
  forceToolLoop?: boolean;
  /** Abort a running provider call when the person stops a job. */
  signal?: AbortSignal;
  /** Shared, approximate input-token budget for one bounded assistant run. */
  tokenBudget?: { used: number; limit: number };
};

class AgentTokenBudgetExhausted extends Error {}

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
  trace?: AgentTrace,
  options: AgentLoopOptions = {},
): Promise<AgentResult> {
  // Providers that are weak at multi-step tool use get the fixed graph.
  if (ai.structuredOutput && !options.forceToolLoop)
    return runGraph(ai, ctx, message, history, overview, log, trace);
  // A provider with a per-message limit gets the overview cut to fit beside
  // the rules, rather than the prompt clipped at the end.
  const fitted = ai.limits
    ? fitData(
        overview,
        ai.limits.maxMessageChars -
          agentPrompt(ctx.timezone, {}, new Date(), ctx.identity).length -
          200,
      )
    : overview;
  const messages: AgentMessage[] = [
    {
      role: "system",
      content:
        options.systemPrompt ??
        agentPrompt(ctx.timezone, fitted, new Date(), ctx.identity),
    },
    ...history.slice(-12).map((t) => ({
      role: t.role,
      content:
        t.content.length > MAX_HISTORY_CHARS
          ? `${t.content.slice(0, MAX_HISTORY_CHARS)}…`
          : t.content,
    })),
    { role: "user", content: message },
  ];
  let mode: Mode = startingMode(ai);
  const deadline = AbortSignal.timeout(DEADLINE_MS);
  const attemptMs = attemptMsFor(ai);
  const maxSteps = options.maxSteps ?? MAX_STEPS;
  const maxCallsPerStep = options.maxToolCallsPerStep ?? MAX_CALLS_PER_STEP;
  let guards = GUARD_BUDGET;
  let toolsRan = 0;
  let lastText = "";
  const seen = new Map<string, number>();

  const call = async (toolsAllowed: boolean): Promise<StepResult> => {
    for (let attempt = 1; ; attempt++) {
      try {
        // The JSON protocol offers fewer tools: the overview is already in the
        // prompt, and Matilda wandered through get_overview and list_teams.
        const available = options.tools ?? TOOL_SPECS;
        const tools =
          mode === "json"
            ? available.filter(
                (t) => t.name !== "get_overview" && t.name !== "list_teams",
              )
            : available;
        const signal = AbortSignal.any([
          deadline,
          AbortSignal.timeout(attemptMs),
          ...(options.signal ? [options.signal] : []),
        ]);
        const fittedMessages = fit(messages, ai);
        if (options.tokenBudget) {
          const estimated =
            Math.ceil(Buffer.byteLength(JSON.stringify(fittedMessages)) / 4) +
            512;
          if (options.tokenBudget.used + estimated > options.tokenBudget.limit)
            throw new AgentTokenBudgetExhausted();
          options.tokenBudget.used += estimated;
        }
        if (options.forceToolLoop && ai.structuredOutput)
          return await runGraphToolStep(ai, fittedMessages, tools, {
            toolsAllowed,
            signal,
          });
        return await step(ai, fittedMessages, tools, {
          mode,
          toolsAllowed,
          signal,
        });
      } catch (error) {
        if (options.signal?.aborted) throw error;
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
        summary = reply.summary.trim();
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
      !options.executeTool &&
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
      ctx.sessionChange = null;
      ctx.decisionLinks = [];
    }
    if (!summary)
      summary = ctx.sessionChange
        ? "Here's the session change for you to review."
        : actions.length
          ? actions.length === 1
            ? "Here's the change for you to review."
            : `Here are ${actions.length} changes for you to review.`
          : "I couldn't find an answer to that. Could you rephrase it?";
    if (partial)
      summary +=
        "\n\n_I ran out of steps before finishing, so this may be incomplete._";
    const checked = finalizeSources(summary, [...(ctx.cited?.values() ?? [])]);
    summary = checked.summary;
    trace?.({ step: Math.max(1, steps), kind: "reply", label: "Answer ready" });
    return {
      summary,
      actions,
      follow_ups: ctx.clarification?.options ?? [],
      sources: checked.sources,
      notes: ctx.notes ?? [],
      legacy,
      steps,
      partial,
    };
  };

  for (let n = 1; n <= maxSteps; n++) {
    const last = n === maxSteps;
    if (last) messages.push({ role: "user", content: FINAL_STEP_NOTE });
    trace?.({ step: n, kind: "thinking", label: "Considering the request" });
    let result: StepResult;
    try {
      result = await call(!last);
    } catch (error) {
      if (!(error instanceof AgentTokenBudgetExhausted)) throw error;
      return finish(lastText, n - 1, true);
    }

    if (result.toolCalls.length) {
      const calls = result.toolCalls.slice(0, maxCallsPerStep);
      messages.push({
        role: "assistant",
        content: result.text,
        tool_calls: calls,
      });
      for (const c of calls) {
        trace?.({
          step: n,
          kind: "tool",
          label: `Using ${c.name}`,
          tool: c.name,
        });
        const key = `${c.name}|${c.arguments}`;
        const count = (seen.get(key) ?? 0) + 1;
        seen.set(key, count);
        const limited = count >= 3;
        const output: LoopToolResult = limited
          ? {
              content: JSON.stringify({
                error:
                  "You already ran this exact call twice. Use those results and move on.",
              }),
              isError: true,
            }
          : options.executeTool
            ? await options.executeTool(c, ctx)
            : await (async () => {
                const legacy = await runTool(c, ctx);
                return {
                  content: legacy.content,
                  isError: legacy.isError,
                };
              })();
        messages.push({
          role: "tool",
          tool_call_id: c.id,
          name: c.name,
          content: output.content,
        });
        trace?.({
          step: n,
          kind: "result",
          label: `Finished ${c.name}`,
          tool: c.name,
        });
        toolsRan++;
        if (output.stop) return finish(output.content, n, false);
        if (ctx.clarification) return finish("", n, false);
      }
      continue;
    }

    const text = result.text.trim();
    if (text) lastText = text;
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
  return finish("", maxSteps, true);
}
