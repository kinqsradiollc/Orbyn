import { aiModelControlError } from "@orbyn/core";
import {
  responsesControls,
  readOpenAiUsage,
  readChatCompletionUsage,
  readAnthropicUsage,
} from "../providers/model-controls.js";
import type { ResolvedAi } from "../providers/adapters.js";
import {
  complete,
  headers,
  json,
  ProviderError,
  send,
  textOf,
  throwIfErrorEnvelope,
  trimSlash,
  truncated,
  usesResponsesApi,
} from "../providers/adapters.js";

/**
 * One provider-neutral step of the agent loop, in BrainRouter's style: the
 * history is kept in one OpenAI-shaped form and translated per provider.
 *
 * - native: the provider's own tool calling (OpenAI-compatible and Azure
 *   `tools`, Anthropic `tool_use`).
 * - json: for providers that ignore native tools (Maincode's Matilda) or
 *   reject them, the same tool calls travel inside a JSON reply, enforced
 *   with a JSON schema where the provider honours one.
 */
export type ToolSpec = {
  name: string;
  description: string;
  /** JSON Schema for the arguments. */
  parameters: JsonSchema;
};
export type JsonSchema = Record<string, unknown>;
export type ToolCall = { id: string; name: string; arguments: string };
/** Stateless Responses context retained with its exact assistant turn. */
export type ResponseContextItem =
  | {
      type: "reasoning";
      id: string;
      summary: { type: "summary_text"; text: string }[];
      encrypted_content: string;
    }
  | { type: "function_call"; call_id: string; name: string; arguments: string }
  | { role: "assistant"; content: string };
export type AgentMessage =
  | { role: "system" | "user"; content: string }
  | {
      role: "assistant";
      content: string;
      tool_calls?: ToolCall[];
      responseItems?: ResponseContextItem[];
    }
  | { role: "tool"; tool_call_id: string; name: string; content: string };
export type StepResult = {
  text: string;
  toolCalls: ToolCall[];
  responseItems?: ResponseContextItem[];
};
export type Mode = "native" | "json";

let counter = 0;
const newId = () => `call_${Date.now().toString(36)}_${++counter}`;

/** Providers flagged for structured output use the JSON protocol from the start. */
export const startingMode = (ai: ResolvedAi): Mode =>
  ai.structuredOutput ? "json" : "native";

/** A 400 that says the provider does not do tools: switch to the JSON protocol. */
export const rejectsTools = (error: unknown) =>
  error instanceof ProviderError &&
  error.reason === "http_400" &&
  /tool|function/i.test(error.message);

export async function step(
  ai: ResolvedAi,
  messages: AgentMessage[],
  tools: ToolSpec[],
  options: { mode: Mode; toolsAllowed: boolean; signal: AbortSignal },
): Promise<StepResult> {
  await ai.assertAuthority?.();
  options.signal.throwIfAborted();
  const controlError = aiModelControlError(ai.kind, ai.model, ai.options);
  if (controlError)
    throw new ProviderError("unsupported_model_controls", controlError);
  const result =
    options.mode === "json"
      ? await jsonStep(ai, messages, tools, options)
      : ai.format === "anthropic"
        ? await anthropicStep(ai, messages, tools, options)
        : ai.format === "openai" && usesResponsesApi(ai)
          ? await responsesStep(ai, messages, tools, options)
          : await openAiStep(ai, messages, tools, options);
  await ai.recordCompletion?.();
  return result;
}

// ---- OpenAI-compatible (and Azure) native tools ----------------------------

function responsesInput(messages: AgentMessage[]): object[] {
  return messages.flatMap((message): object[] => {
    if (message.role === "tool")
      return [
        {
          type: "function_call_output",
          call_id: message.tool_call_id,
          output: message.content,
        },
      ];
    if (message.role !== "assistant")
      return [{ role: message.role, content: message.content }];
    if (message.responseItems) return message.responseItems;
    return [
      ...(message.content
        ? [{ role: "assistant", content: message.content }]
        : []),
      ...(message.tool_calls ?? []).map((call) => ({
        type: "function_call",
        call_id: call.id,
        name: call.name,
        arguments: call.arguments,
      })),
    ];
  });
}

async function responsesStep(
  ai: ResolvedAi,
  messages: AgentMessage[],
  tools: ToolSpec[],
  { toolsAllowed, signal }: { toolsAllowed: boolean; signal: AbortSignal },
): Promise<StepResult> {
  const response = await send(
    `${trimSlash(ai.baseUrl)}/responses`,
    {
      method: "POST",
      headers: headers(ai),
      body: JSON.stringify({
        model: ai.model,
        ...responsesControls(ai, responsesInput(messages)),
        store: false,
        include: ["reasoning.encrypted_content"],
        parallel_tool_calls: false,
        tools: tools.map((tool) => ({
          type: "function",
          ...tool,
          strict: false,
        })),
        tool_choice: toolsAllowed ? "auto" : "none",
      }),
    },
    signal,
    ai.apiKey,
  );
  const body = await json<{
    error?: unknown;
    usage?: unknown;
    id?: unknown;
    status?: string;
    output?: unknown[];
  }>(response);
  throwIfErrorEnvelope(body, ai.apiKey);
  await ai.recordUsage?.(readOpenAiUsage(body.usage), body.id);
  if (body.status === "incomplete") throw truncated();
  const invalid = (): never => {
    throw new ProviderError(
      "invalid_body",
      "The provider sent a reply Orbyn could not read.",
    );
  };
  if (
    body.status !== "completed" ||
    !Array.isArray(body.output) ||
    body.output.length > 128 ||
    JSON.stringify(body.output).length > 2_000_000
  )
    invalid();
  const toolCalls: ToolCall[] = [];
  const responseItems: ResponseContextItem[] = [];
  let text = "";
  const ids = new Set<string>();
  const string = (value: unknown): value is string =>
    typeof value === "string" && value.length > 0;
  for (const raw of body.output!) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) invalid();
    const item = raw as Record<string, unknown>;
    if (item.type === "function_call") {
      if (
        !toolsAllowed ||
        !string(item.call_id) ||
        !string(item.name) ||
        typeof item.arguments !== "string" ||
        (item.status !== undefined && item.status !== "completed") ||
        ids.has(item.call_id) ||
        !tools.some((tool) => tool.name === item.name)
      )
        invalid();
      ids.add(item.call_id as string);
      toolCalls.push({
        id: item.call_id as string,
        name: item.name as string,
        arguments: item.arguments as string,
      });
      responseItems.push({
        type: "function_call",
        call_id: item.call_id as string,
        name: item.name as string,
        arguments: item.arguments as string,
      });
    } else if (item.type === "reasoning") {
      if (
        !string(item.id) ||
        !string(item.encrypted_content) ||
        !Array.isArray(item.summary)
      )
        invalid();
      const summary = (item.summary as unknown[]).map((entry) => {
        if (!entry || typeof entry !== "object") invalid();
        const part = entry as Record<string, unknown>;
        if (part.type !== "summary_text" || typeof part.text !== "string")
          invalid();
        return { type: "summary_text" as const, text: part.text as string };
      });
      responseItems.push({
        type: "reasoning",
        id: item.id as string,
        summary,
        encrypted_content: item.encrypted_content as string,
      });
    } else if (item.type === "message") {
      if (
        item.role !== "assistant" ||
        (item.status !== undefined && item.status !== "completed") ||
        !Array.isArray(item.content)
      )
        invalid();
      let content = "";
      for (const rawPart of item.content as unknown[]) {
        if (!rawPart || typeof rawPart !== "object") invalid();
        const part = rawPart as Record<string, unknown>;
        const value =
          part.type === "output_text"
            ? part.text
            : part.type === "refusal"
              ? part.refusal
              : undefined;
        if (typeof value !== "string") invalid();
        content += value;
      }
      text += content;
      if (content) responseItems.push({ role: "assistant", content });
    } else invalid();
  }
  // Orbyn executes at most one call per reasoning step on this route. Refuse
  // unexpected parallel calls rather than retaining unanswered call items.
  if (toolCalls.length > 1) invalid();
  await ai.assertAuthority?.();
  signal.throwIfAborted();
  return { text, toolCalls, responseItems };
}

function chatUrl(ai: ResolvedAi) {
  return ai.format === "azure"
    ? `${trimSlash(ai.baseUrl)}/openai/deployments/${encodeURIComponent(ai.model)}/chat/completions?api-version=${encodeURIComponent(ai.options.apiVersion ?? "")}`
    : `${trimSlash(ai.baseUrl)}/chat/completions`;
}

const toOpenAi = (messages: AgentMessage[]) =>
  messages.map((m) =>
    m.role === "assistant"
      ? {
          role: "assistant",
          content: m.content || (m.tool_calls?.length ? null : ""),
          ...(m.tool_calls?.length
            ? {
                tool_calls: m.tool_calls.map((c) => ({
                  id: c.id,
                  type: "function",
                  function: { name: c.name, arguments: c.arguments },
                })),
              }
            : {}),
        }
      : m.role === "tool"
        ? { role: "tool", tool_call_id: m.tool_call_id, content: m.content }
        : { role: m.role, content: m.content },
  );

async function openAiStep(
  ai: ResolvedAi,
  messages: AgentMessage[],
  tools: ToolSpec[],
  { toolsAllowed, signal }: { toolsAllowed: boolean; signal: AbortSignal },
): Promise<StepResult> {
  const response = await send(
    chatUrl(ai),
    {
      method: "POST",
      headers: headers(ai),
      body: JSON.stringify({
        ...(ai.format === "azure" ? {} : { model: ai.model }),
        messages: toOpenAi(messages),
        tools: tools.map((t) => ({
          type: "function",
          function: {
            name: t.name,
            description: t.description,
            parameters: t.parameters,
          },
        })),
        tool_choice: toolsAllowed ? "auto" : "none",
      }),
    },
    signal,
    ai.apiKey,
  );
  type Msg = {
    content?: unknown;
    reasoning_content?: string;
    reasoning?: string;
    tool_calls?: {
      id?: string;
      function?: { name?: string; arguments?: unknown };
    }[];
  };
  const body = await json<{
    error?: unknown;
    usage?: unknown;
    id?: unknown;
    choices?: { message?: Msg; delta?: Msg; finish_reason?: string }[];
  }>(response);
  throwIfErrorEnvelope(body, ai.apiKey);
  await ai.recordUsage?.(readChatCompletionUsage(body.usage), body.id);
  const choice = body.choices?.[0];
  if (!choice)
    throw new ProviderError("no_choices", "The provider returned no answer.");
  const message = choice.message ?? choice.delta ?? {};
  const toolCalls: ToolCall[] = (message.tool_calls ?? [])
    .filter((c) => c.function?.name)
    .map((c) => ({
      id: c.id || newId(),
      name: c.function!.name!,
      arguments:
        typeof c.function!.arguments === "string"
          ? c.function!.arguments
          : JSON.stringify(c.function!.arguments ?? {}),
    }));
  let text = textOf(message.content);
  if (!text.trim() && !toolCalls.length)
    text = message.reasoning_content ?? message.reasoning ?? "";
  if (choice.finish_reason === "length" && !toolCalls.length) throw truncated();
  return { text, toolCalls };
}

// ---- Anthropic native tools ------------------------------------------------

type AnthropicBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; tool_use_id: string; content: string };

const parseArgs = (raw: string): unknown => {
  try {
    return JSON.parse(raw || "{}");
  } catch {
    return {};
  }
};

/** Anthropic wants alternating user/assistant turns with tool results as user blocks. */
function toAnthropic(messages: AgentMessage[]) {
  const system = messages
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .join("\n\n");
  const out: { role: "user" | "assistant"; content: AnthropicBlock[] }[] = [];
  const push = (role: "user" | "assistant", blocks: AnthropicBlock[]) => {
    if (!blocks.length) return;
    const last = out.at(-1);
    if (last && last.role === role) last.content.push(...blocks);
    else out.push({ role, content: blocks });
  };
  for (const m of messages) {
    if (m.role === "system") continue;
    if (m.role === "user")
      push("user", [{ type: "text", text: m.content || " " }]);
    else if (m.role === "tool")
      push("user", [
        {
          type: "tool_result",
          tool_use_id: m.tool_call_id,
          content: m.content,
        },
      ]);
    else if (m.role === "assistant")
      push("assistant", [
        ...(m.content ? [{ type: "text" as const, text: m.content }] : []),
        ...(m.tool_calls ?? []).map((c) => ({
          type: "tool_use" as const,
          id: c.id,
          name: c.name,
          input: parseArgs(c.arguments),
        })),
      ]);
  }
  return { system, messages: out };
}

async function anthropicStep(
  ai: ResolvedAi,
  messages: AgentMessage[],
  tools: ToolSpec[],
  { toolsAllowed, signal }: { toolsAllowed: boolean; signal: AbortSignal },
): Promise<StepResult> {
  const { system, messages: turns } = toAnthropic(messages);
  const response = await send(
    `${trimSlash(ai.baseUrl)}/messages`,
    {
      method: "POST",
      headers: headers(ai),
      body: JSON.stringify({
        model: ai.model,
        max_tokens: 8192,
        ...(system ? { system } : {}),
        messages: turns,
        tools: tools.map((t) => ({
          name: t.name,
          description: t.description,
          input_schema: t.parameters,
        })),
        tool_choice: { type: toolsAllowed ? "auto" : "none" },
      }),
    },
    signal,
    ai.apiKey,
  );
  const body = await json<{
    type?: string;
    id?: unknown;
    usage?: unknown;
    error?: unknown;
    stop_reason?: string;
    content?: {
      type: string;
      text?: string;
      id?: string;
      name?: string;
      input?: unknown;
    }[];
  }>(response);
  throwIfErrorEnvelope(body, ai.apiKey);
  await ai.recordUsage?.(readAnthropicUsage(body.usage), body.id);
  const blocks = body.content ?? [];
  const toolCalls = blocks
    .filter((b) => b.type === "tool_use" && b.name)
    .map((b) => ({
      id: b.id || newId(),
      name: b.name!,
      arguments: JSON.stringify(b.input ?? {}),
    }));
  const text = blocks
    .filter((b) => b.type === "text")
    .map((b) => b.text ?? "")
    .join("");
  if (body.stop_reason === "max_tokens" && !toolCalls.length) throw truncated();
  return { text, toolCalls };
}

// ---- JSON protocol (Matilda, and providers that reject tools) ---------------

/**
 * Strict JSON Schema lists every property as required; optional ones accept
 * null, and nulls are removed again before the arguments are validated.
 */
export function strictSchema(schema: JsonSchema): JsonSchema {
  if (schema.type === "object" && schema.properties) {
    const props = schema.properties as Record<string, JsonSchema>;
    const required = new Set((schema.required as string[]) ?? []);
    return {
      type: "object",
      additionalProperties: false,
      required: Object.keys(props),
      properties: Object.fromEntries(
        Object.entries(props).map(([key, value]) => {
          const inner = strictSchema(value);
          return [key, required.has(key) ? inner : nullable(inner)];
        }),
      ),
    };
  }
  if (schema.type === "array" && schema.items)
    return { ...schema, items: strictSchema(schema.items as JsonSchema) };
  return schema;
}

function nullable(schema: JsonSchema): JsonSchema {
  const type = schema.type;
  if (Array.isArray(type))
    return type.includes("null")
      ? schema
      : { ...schema, type: [...type, "null"] };
  if (typeof type === "string")
    return {
      ...schema,
      type: [type, "null"],
      ...(Array.isArray(schema.enum)
        ? { enum: [...(schema.enum as unknown[]), null] }
        : {}),
    };
  return { anyOf: [schema, { type: "null" }] };
}

/** Tools without arguments are a true/false field in the JSON protocol. */
const takesNoArguments = (tool: ToolSpec) =>
  Object.keys((tool.parameters.properties as object | undefined) ?? {})
    .length === 0;

/**
 * The reply schema for one JSON-protocol step: one field per tool (its
 * arguments, or null when unused; true or false for tools without
 * arguments) and the answer. Named fields rather than a list of `anyOf`
 * tool shapes: with the list, Matilda's constrained decoding kept picking
 * the same one tool in live tests.
 */
export function stepFormat(tools: ToolSpec[]) {
  return {
    type: "json_schema",
    json_schema: {
      name: "orbyn_step",
      schema: {
        type: "object",
        additionalProperties: false,
        required: [...tools.map((t) => t.name), "answer"],
        properties: {
          ...Object.fromEntries(
            tools.map((t) => [
              t.name,
              takesNoArguments(t)
                ? {
                    type: "boolean",
                    description: `${t.description} True to run ${t.name}.`,
                  }
                : {
                    ...nullable(strictSchema(t.parameters)),
                    description: t.description,
                  },
            ]),
          ),
          answer: {
            type: ["array", "null"],
            items: { type: "string" },
            description:
              "Your final reply to the user as Markdown lines, or null while you still need tools.",
          },
        },
      },
    },
  };
}

/** Removes the nulls a strict schema forced onto optional fields. */
export function dropNullFields(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(dropNullFields);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, v]) => v !== null)
        .map(([k, v]) => [k, dropNullFields(v)]),
    );
  return value;
}

/**
 * How to reply, with every tool described. Sent even when a schema enforces
 * the shape: a schema alone names the fields but not what the tools do, and
 * Matilda then said it had no way to create tasks.
 */
const JSON_PROTOCOL_BASE = `Reply with ONE JSON object containing one field per tool, plus "answer". To use tools, fill in each tool field to run now, leave unused tool fields null (or false for boolean fields), and set "answer" to null. To reply, leave every tool field unused and put your Markdown reply in "answer" as a list of lines.`;

/** Include tool descriptions and argument shapes when the provider has no JSON schema. */
export function jsonProtocolNote(tools: ToolSpec[], schemaEnforced: boolean) {
  if (schemaEnforced || !tools.length)
    return `${JSON_PROTOCOL_BASE}${schemaEnforced ? " Tool descriptions and argument shapes are in the schema." : ""}`;
  return `${JSON_PROTOCOL_BASE}\nTools:\n${tools
    .map(
      (tool) =>
        `- ${tool.name}: ${tool.description}${
          takesNoArguments(tool)
            ? " (true or false)"
            : ` Arguments: ${JSON.stringify(tool.parameters)}`
        }`,
    )
    .join("\n")}`;
}

/** The history as plain messages: tool calls become a sentence, results a user message. */
function toJsonHistory(
  messages: AgentMessage[],
  tools: ToolSpec[],
  maxMessageChars?: number,
  schemaEnforced = false,
) {
  const out: { role: "system" | "user" | "assistant"; content: string }[] = [];
  for (const m of messages) {
    if (m.role === "tool")
      out.push({
        role: "user",
        content: `[Tool result: ${m.name}]\n${m.content}`,
      });
    else if (m.role === "assistant") {
      // A sentence, as BrainRouter found: a turn holding only a call stub was
      // read back by the model as an empty message and the task was dropped.
      const calls = (m.tool_calls ?? []).map(
        (c) =>
          `I called the tool ${c.name} with ${c.arguments || "{}"}; its result follows.`,
      );
      const content = [m.content, ...calls].filter(Boolean).join("\n");
      if (content) out.push({ role: "assistant", content });
    } else out.push({ role: m.role, content: m.content });
  }
  if (tools.length && out[0]?.role === "system") {
    const suffix = `\n\n${jsonProtocolNote(tools, schemaEnforced)}`;
    const maxSystemChars = maxMessageChars
      ? Math.max(0, maxMessageChars - suffix.length)
      : Number.POSITIVE_INFINITY;
    const system = out[0].content;
    const prefix =
      system.length > maxSystemChars
        ? `${system.slice(0, Math.max(0, maxSystemChars - 1))}…`
        : system;
    out[0] = {
      ...out[0],
      content: `${prefix}${suffix}`,
    };
  }
  return out;
}

/** Pulls the JSON object out of a reply that may wrap it in prose or fences. */
function extractJson(text: string): unknown {
  let body = text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  const fenced = body.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) body = fenced[1];
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end <= start) throw new SyntaxError("no JSON object");
  return JSON.parse(body.slice(start, end + 1));
}

async function jsonStep(
  ai: ResolvedAi,
  messages: AgentMessage[],
  tools: ToolSpec[],
  { toolsAllowed, signal }: { toolsAllowed: boolean; signal: AbortSignal },
): Promise<StepResult> {
  const usable = toolsAllowed ? tools : [];
  const schema = ai.structuredOutput === "json_schema" && usable.length;
  const protocolMessages = toJsonHistory(
    messages,
    usable,
    ai.limits?.maxMessageChars,
    !!ai.structuredOutput,
  );
  const response = ai.textTransport
    ? Response.json({
        choices: [
          {
            message: {
              content: await ai.textTransport(
                protocolMessages,
                signal,
                ai.operationId,
              ),
            },
            finish_reason: "stop",
          },
        ],
      })
    : ai.format === "anthropic"
      ? Response.json({
          choices: [
            {
              message: {
                // JSON is the agent protocol, not a different provider API.
                // Native Messages also owns usage, truncation and authority.
                content: await complete(ai, protocolMessages, { signal }),
              },
              finish_reason: "stop",
            },
          ],
        })
      : await send(
          chatUrl(ai),
          {
            method: "POST",
            headers: headers(ai),
            body: JSON.stringify({
              ...(ai.format === "azure" ? {} : { model: ai.model }),
              messages: protocolMessages,
              ...(schema ? { response_format: stepFormat(usable) } : {}),
            }),
          },
          signal,
          ai.apiKey,
        );
  const body = await json<{
    error?: unknown;
    usage?: unknown;
    id?: unknown;
    choices?: { message?: { content?: unknown }; finish_reason?: string }[];
  }>(response);
  throwIfErrorEnvelope(body, ai.apiKey);
  if (!ai.textTransport && ai.format !== "anthropic")
    await ai.recordUsage?.(readChatCompletionUsage(body.usage), body.id);
  const choice = body.choices?.[0];
  if (!choice)
    throw new ProviderError("no_choices", "The provider returned no answer.");
  const content = textOf(choice.message?.content);
  // With tools off (the final step), the reply is the answer as it is.
  if (!usable.length) return { text: content, toolCalls: [] };
  let parsed: Record<string, unknown>;
  try {
    const value = extractJson(content);
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new SyntaxError("not a JSON object");
    parsed = value as Record<string, unknown>;
  } catch {
    // Prose instead of JSON: treat it as the final answer.
    return { text: content, toolCalls: [] };
  }
  const toolCalls: ToolCall[] = [];
  const add = (name: string, args: unknown) =>
    toolCalls.push({
      id: newId(),
      name,
      arguments: JSON.stringify(
        dropNullFields(typeof args === "string" ? parseArgs(args) : args),
      ),
    });
  // The list form ({"tool_calls": [{"name", "arguments"}]}) some models write.
  if (Array.isArray(parsed.tool_calls))
    for (const c of parsed.tool_calls as {
      name?: unknown;
      arguments?: unknown;
    }[])
      if (c && typeof c.name === "string") add(c.name, c.arguments ?? {});
  // The named form: a field per tool, true or its arguments. A field whose
  // arguments are all null is a tool the model left unused.
  for (const t of usable) {
    const value = parsed[t.name];
    if (value === true) add(t.name, {});
    else if (
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.keys(dropNullFields(value) as object).length > 0
    )
      add(t.name, value);
  }
  const answer = Array.isArray(parsed.answer)
    ? parsed.answer.filter((l) => typeof l === "string").join("\n")
    : typeof parsed.answer === "string"
      ? parsed.answer
      : "";
  return { text: answer, toolCalls };
}
