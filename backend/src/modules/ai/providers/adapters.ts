import type { AiRequestFormat } from "@orbyn/core";
import { assertProviderUrl } from "./network.js";

/** Everything needed to call one provider with one model. */
export type ResolvedAi = {
  kind: string;
  format: AiRequestFormat;
  baseUrl: string;
  apiKey: string;
  model: string;
  options: { apiVersion?: string };
  source: "database";
  /** Hard request limits the provider enforces, if any (see AI_PROVIDERS). */
  limits?: { maxBodyBytes: number; maxMessageChars: number };
  /** Send `options.responseFormat` as `response_format` (see AI_PROVIDERS). */
  structuredOutput?: "json_schema";
  /** A local server: a blank key is sent as "local", as BrainRouter does. */
  local?: boolean;
  /** Sent when the key is blank (opencode's "public"). */
  defaultApiKey?: string;
  /** "responses": OpenAI's Responses API for GPT and o-series models. */
  requestFormat?: "responses";
};

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

/** A provider call failed; `message` is safe to show admins, never contains the key. */
export class ProviderError extends Error {
  constructor(
    readonly reason: string,
    message: string,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

export const trimSlash = (url: string) => url.replace(/\/+$/, "");

function describeStatus(status: number, detail = "") {
  const says = detail ? ` The provider says: ${detail}` : "";
  if (status === 401 || status === 403)
    return `The provider rejected the API key (HTTP ${status}).${says}`;
  if (status === 404)
    return `The provider could not find that model or address (HTTP 404).${says}`;
  if (status === 429)
    return `The provider is rate limiting requests (HTTP 429).${says}`;
  return `The provider returned an error (HTTP ${status}).${says}`;
}

/** A short, single-line error message from a provider's reply, key masked. */
function providerDetail(raw: string, secret: string): string {
  let text = raw;
  try {
    const body = JSON.parse(raw) as {
      error?: { message?: string } | string;
      message?: string;
    };
    text =
      (typeof body.error === "string" ? body.error : body.error?.message) ??
      body.message ??
      raw;
  } catch {
    // Not JSON: use the text as it is.
  }
  if (secret) text = text.split(secret).join("••••");
  text = text.replace(/\s+/g, " ").trim();
  return text.length > 200 ? `${text.slice(0, 199)}…` : text;
}

const LOCAL_PLACEHOLDER_KEY = "local";
const isLoopback = (url: string) => {
  try {
    const host = new URL(url).hostname.replace(/^\[|\]$/g, "");
    return host === "localhost" || host === "::1" || host.startsWith("127.");
  } catch {
    return false;
  }
};

/**
 * The key to send, following BrainRouter: the saved key, else the provider's
 * default key (opencode), else "local" for local servers, else none.
 */
function keyFor(
  ai: Pick<ResolvedAi, "apiKey" | "baseUrl"> &
    Partial<Pick<ResolvedAi, "local" | "defaultApiKey">>,
) {
  if (ai.apiKey) return ai.apiKey;
  if (ai.defaultApiKey) return ai.defaultApiKey;
  return ai.local || isLoopback(ai.baseUrl) ? LOCAL_PLACEHOLDER_KEY : "";
}

export type Connection = Pick<ResolvedAi, "format" | "apiKey" | "baseUrl"> &
  Partial<Pick<ResolvedAi, "local" | "defaultApiKey">>;

export function headers(ai: Connection): Record<string, string> {
  // Anthropic's native API and Azure use their own key headers.
  if (ai.format === "anthropic")
    return {
      "Content-Type": "application/json",
      "x-api-key": ai.apiKey,
      "anthropic-version": "2023-06-01",
    };
  if (ai.format === "azure")
    return { "Content-Type": "application/json", "api-key": ai.apiKey };
  const key = keyFor(ai);
  return {
    "Content-Type": "application/json",
    ...(key ? { Authorization: `Bearer ${key}` } : {}),
  };
}

export async function send(
  url: string,
  init: RequestInit,
  signal: AbortSignal,
  secret = "",
) {
  await assertProviderUrl(url);
  let response: Response;
  try {
    response = await fetch(url, { ...init, signal });
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "TimeoutError";
    throw new ProviderError(
      timedOut ? "timeout" : "network",
      timedOut
        ? "The provider took too long to answer."
        : "Could not reach the provider.",
    );
  }
  if (!response.ok) {
    const detail = providerDetail(
      await response.text().catch(() => ""),
      secret,
    );
    throw new ProviderError(
      `http_${response.status}`,
      describeStatus(response.status, detail),
    );
  }
  return response;
}

export async function json<T>(response: Response): Promise<T> {
  try {
    return (await response.json()) as T;
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    if (name === "TimeoutError" || name === "AbortError")
      throw new ProviderError(
        "timeout",
        "The provider took too long to answer.",
      );
    throw new ProviderError(
      "invalid_body",
      "The provider sent a reply Orbyn could not read.",
    );
  }
}

export const truncated = () =>
  new ProviderError(
    "truncated",
    "The provider cut the reply off before it finished.",
  );

/** Text from a content string or an array of content parts. */
export function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) =>
      typeof part === "string"
        ? part
        : typeof part?.text === "string"
          ? part.text
          : "",
    )
    .join("");
}

/** A 200 reply that is really an error (OpenRouter and others send these). */
export function throwIfErrorEnvelope(body: {
  error?: unknown;
  type?: unknown;
}) {
  if (body.type === "error" || (body.error && body.error !== null)) {
    const error = body.error as { message?: string } | string | undefined;
    const detail = typeof error === "string" ? error : (error?.message ?? "");
    throw new ProviderError(
      "error_envelope",
      `The provider returned an error.${detail ? ` The provider says: ${detail.slice(0, 200)}` : ""}`,
    );
  }
}

const RESPONSES_MODEL = /^(gpt-[0-9]|o[134]|chatgpt-)/i;
const OPENAI_ENDPOINT = "https://api.openai.com/v1";

/**
 * BrainRouter's rule: OpenAI's Responses API only for GPT and o-series models
 * on OpenAI's own endpoint; everything else uses chat completions.
 */
export const usesResponsesApi = (
  ai: Pick<ResolvedAi, "requestFormat" | "baseUrl" | "model">,
) =>
  ai.requestFormat === "responses" &&
  trimSlash(ai.baseUrl).toLowerCase() === OPENAI_ENDPOINT &&
  RESPONSES_MODEL.test(ai.model);

/**
 * Send a chat and return the model's text reply. Pass `signal` to share one
 * deadline across retries; otherwise the call times out after `timeoutMs`.
 */
export async function complete(
  ai: ResolvedAi,
  messages: ChatMessage[],
  options: {
    signal?: AbortSignal;
    timeoutMs?: number;
    /** A `response_format` value, used only by providers with `structuredOutput`. */
    responseFormat?: object;
  } = {},
): Promise<string> {
  const signal =
    options.signal ?? AbortSignal.timeout(options.timeoutMs ?? 60_000);
  const system = messages
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .join("\n\n");
  const conversation = messages.filter((m) => m.role !== "system");

  if (ai.format === "anthropic") {
    // Native Messages API: system prompt separate, max_tokens required
    // (BrainRouter's default is 8192), thinking blocks ignored.
    const response = await send(
      `${trimSlash(ai.baseUrl)}/messages`,
      {
        method: "POST",
        headers: headers(ai),
        body: JSON.stringify({
          model: ai.model,
          max_tokens: 8192,
          ...(system ? { system } : {}),
          messages: conversation,
        }),
      },
      signal,
      ai.apiKey,
    );
    const body = await json<{
      type?: string;
      error?: unknown;
      stop_reason?: string;
      content?: { type: string; text?: string }[];
    }>(response);
    throwIfErrorEnvelope(body);
    const text = (body.content ?? [])
      .filter((part) => part.type === "text")
      .map((part) => part.text ?? "")
      .join("");
    if (body.stop_reason === "max_tokens") throw truncated();
    return text;
  }

  if (usesResponsesApi(ai)) {
    const response = await send(
      `${trimSlash(ai.baseUrl)}/responses`,
      {
        method: "POST",
        headers: headers(ai),
        body: JSON.stringify({
          model: ai.model,
          ...(system ? { instructions: system } : {}),
          input: conversation.map((m) => ({
            role: m.role,
            content: m.content,
          })),
          store: false,
        }),
      },
      signal,
      ai.apiKey,
    );
    const body = await json<{
      error?: unknown;
      status?: string;
      output?: {
        type?: string;
        content?: { type?: string; text?: string }[];
      }[];
    }>(response);
    throwIfErrorEnvelope(body);
    if (!Array.isArray(body.output))
      throw new ProviderError(
        "invalid_body",
        "The provider sent a reply Orbyn could not read.",
      );
    const text = body.output
      .filter((item) => item.type === "message")
      .flatMap((item) => item.content ?? [])
      .filter((part) => part.type === "output_text" || part.type === "text")
      .map((part) => part.text ?? "")
      .join("");
    if (body.status === "incomplete") throw truncated();
    return text;
  }

  const url =
    ai.format === "azure"
      ? `${trimSlash(ai.baseUrl)}/openai/deployments/${encodeURIComponent(ai.model)}/chat/completions?api-version=${encodeURIComponent(ai.options.apiVersion ?? "")}`
      : `${trimSlash(ai.baseUrl)}/chat/completions`;
  const response = await send(
    url,
    {
      method: "POST",
      headers: headers(ai),
      // Azure picks the model from the deployment in the URL.
      body: JSON.stringify({
        ...(ai.format === "azure" ? {} : { model: ai.model }),
        messages,
        ...(ai.structuredOutput && options.responseFormat
          ? { response_format: options.responseFormat }
          : {}),
      }),
    },
    signal,
    ai.apiKey,
  );
  type Message = {
    content?: unknown;
    reasoning_content?: string;
    reasoning?: string;
  };
  const body = await json<{
    error?: unknown;
    choices?: { message?: Message; delta?: Message; finish_reason?: string }[];
  }>(response);
  throwIfErrorEnvelope(body);
  const choice = body.choices?.[0];
  if (!choice)
    throw new ProviderError("no_choices", "The provider returned no answer.");
  const message = choice.message ?? choice.delta ?? {};
  let text = textOf(message.content);
  // Reasoning models sometimes leave `content` empty and answer in their
  // reasoning field; use it rather than failing (as BrainRouter's memory LLM).
  if (!text.trim()) text = message.reasoning_content ?? message.reasoning ?? "";
  if (choice.finish_reason === "length") throw truncated();
  return text;
}

/** The provider's model ids, sorted. Uses the saved key. */
export async function listModels(ai: Connection): Promise<string[]> {
  if (ai.format === "azure")
    throw new ProviderError(
      "unsupported",
      "Azure does not list deployments here. Type your deployment name as the model.",
    );
  const response = await send(
    `${trimSlash(ai.baseUrl)}/models`,
    { headers: headers(ai) },
    AbortSignal.timeout(8_000),
    ai.apiKey,
  );
  const body = await json<{
    data?: { id?: string }[];
    models?: ({ id?: string; name?: string } | string)[];
  }>(response);
  const ids = [
    ...(body.data ?? []).map((m) => m.id),
    ...(body.models ?? []).map((m) =>
      typeof m === "string" ? m : (m.id ?? m.name),
    ),
  ].filter((id): id is string => !!id);
  return [...new Set(ids)].sort();
}
