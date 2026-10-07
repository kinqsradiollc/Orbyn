import {
  responsesControls,
  readOpenAiUsage,
  readChatCompletionUsage,
  readAnthropicUsage,
} from "./model-controls.js";
import type {
  AiModelUsage,
  AiProviderOptions,
  AiRequestFormat,
} from "@orbyn/core";
import { aiModelControlError } from "@orbyn/core";
import { assertProviderUrl, isPrivateUrl } from "./network.js";
import {
  embeddingVectors,
  EmbeddingResponseError,
} from "./embedding-vectors.js";

/** Everything needed to call one provider with one model. */
export type ResolvedAi = {
  kind: string;
  /** Internal authority check before dispatch; never supplied by an HTTP caller. */
  assertAuthority?: () => Promise<void>;
  /** Content-free receipt after a parsed provider response. */
  recordCompletion?: () => Promise<void>;
  /** Observed managed counters only; unavailable fields remain null. */
  recordUsage?: (usage: AiModelUsage, responseId?: unknown) => Promise<void>;
  /** Durable private-call slot; per-loop copies prevent cross-specialist mutation. */
  operationId?: string;
  /** Credential-free, internal device transport; never serialized into a client request. */
  textTransport?: (
    messages: ChatMessage[],
    signal: AbortSignal,
    operationId?: string,
    maxOutputTokens?: number,
  ) => Promise<string>;
  format: AiRequestFormat;
  baseUrl: string;
  apiKey: string;
  model: string;
  /** Internal opaque cache accounting boundary; never accepted from HTTP callers. */
  cacheScope?: string;
  options: AiProviderOptions;
  source: "database";
  /** Credential-free configuration identity for scoped execution provenance. */
  providerId?: string;
  providerRevision?: string;
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
  if (typeof text !== "string") text = "";
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

/**
 * How long one model call may take. A hosted provider that has not answered
 * in a minute is stalled; a model on the user's own machine may simply be
 * slow, and is given as long as its hardware needs.
 */
export const attemptMsFor = (ai: Pick<ResolvedAi, "local" | "baseUrl">) =>
  ai.local || isPrivateUrl(ai.baseUrl) ? 300_000 : 60_000;

export type Connection = Pick<ResolvedAi, "format" | "apiKey" | "baseUrl"> &
  Partial<Pick<ResolvedAi, "kind" | "local" | "defaultApiKey">>;

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
export function throwIfErrorEnvelope(
  body: {
    error?: unknown;
    type?: unknown;
  },
  secret = "",
) {
  if (body.type === "error" || (body.error && body.error !== null)) {
    const error = body.error as { message?: string } | string | undefined;
    const detail = providerDetail(
      typeof error === "string" ? error : (error?.message ?? ""),
      secret,
    );
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
    /** Explicit cap for bounded background work; absence preserves existing provider behavior. */
    maxOutputTokens?: number;
  } = {},
): Promise<string> {
  if (
    options.maxOutputTokens !== undefined &&
    (!Number.isSafeInteger(options.maxOutputTokens) ||
      options.maxOutputTokens < 1 ||
      options.maxOutputTokens > 65536)
  )
    throw new ProviderError(
      "invalid_limit",
      "Choose a supported output token limit.",
    );
  const signal =
    options.signal ?? AbortSignal.timeout(options.timeoutMs ?? 60_000);
  await ai.assertAuthority?.();
  signal.throwIfAborted();
  const accepted = async (text: string) => {
    await ai.assertAuthority?.();
    signal.throwIfAborted();
    return text;
  };
  const configuredError = aiModelControlError(ai.kind, ai.model, ai.options);
  if (configuredError)
    throw new ProviderError("unsupported_model_controls", configuredError);
  if (ai.textTransport)
    return accepted(
      await ai.textTransport(
        messages,
        signal,
        ai.operationId,
        options.maxOutputTokens,
      ),
    );
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
          max_tokens: options.maxOutputTokens ?? 8192,
          ...(system ? { system } : {}),
          messages: conversation,
        }),
      },
      signal,
      ai.apiKey,
    );
    const body = await json<{
      id?: unknown;
      usage?: unknown;
      type?: string;
      error?: unknown;
      stop_reason?: string;
      content?: { type: string; text?: string }[];
    }>(response);
    throwIfErrorEnvelope(body, ai.apiKey);
    await ai.recordUsage?.(readAnthropicUsage(body.usage), body.id);
    const text = (body.content ?? [])
      .filter((part) => part.type === "text")
      .map((part) => part.text ?? "")
      .join("");
    if (body.stop_reason === "max_tokens") throw truncated();
    return accepted(text);
  }

  if (usesResponsesApi(ai)) {
    const response = await send(
      `${trimSlash(ai.baseUrl)}/responses`,
      {
        method: "POST",
        headers: headers(ai),
        body: JSON.stringify({
          model: ai.model,
          ...(system && ai.options.cacheMode !== "explicit"
            ? { instructions: system }
            : {}),
          ...responsesControls(
            ai,
            (ai.options.cacheMode === "explicit" ? messages : conversation).map(
              (m) => ({ role: m.role, content: m.content }),
            ),
          ),
          store: false,
          ...(options.maxOutputTokens === undefined
            ? {}
            : { max_output_tokens: options.maxOutputTokens }),
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
      output?: {
        type?: string;
        content?: { type?: string; text?: string }[];
      }[];
    }>(response);
    throwIfErrorEnvelope(body, ai.apiKey);
    await ai.recordUsage?.(readOpenAiUsage(body.usage), body.id);
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
    await ai.assertAuthority?.();
    signal.throwIfAborted();
    return accepted(text);
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
        ...(options.maxOutputTokens === undefined
          ? {}
          : ai.kind === "openai" || ai.format === "azure"
            ? { max_completion_tokens: options.maxOutputTokens }
            : { max_tokens: options.maxOutputTokens }),
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
    id?: unknown;
    usage?: unknown;
    choices?: { message?: Message; delta?: Message; finish_reason?: string }[];
  }>(response);
  throwIfErrorEnvelope(body, ai.apiKey);
  await ai.recordUsage?.(readChatCompletionUsage(body.usage), body.id);
  const choice = body.choices?.[0];
  if (!choice)
    throw new ProviderError("no_choices", "The provider returned no answer.");
  const message = choice.message ?? choice.delta ?? {};
  let text = textOf(message.content);
  // Reasoning models sometimes leave `content` empty and answer in their
  // reasoning field; use it rather than failing (as BrainRouter's memory LLM).
  if (!text.trim()) text = message.reasoning_content ?? message.reasoning ?? "";
  if (choice.finish_reason === "length") throw truncated();
  return accepted(text);
}

/** The provider's model ids, sorted. Uses the saved key. */
export async function listModels(ai: Connection): Promise<string[]> {
  if (ai.format === "azure")
    throw new ProviderError(
      "unsupported",
      "Azure does not list deployments here. Type your deployment name as the model.",
    );
  const endpoint = `${trimSlash(ai.baseUrl)}/models`;
  // One budget covers the entire catalog, rather than eight seconds per page.
  const signal = AbortSignal.timeout(8_000);
  const invalid = () =>
    new ProviderError(
      "invalid_catalog",
      "The provider returned an invalid model catalog.",
    );
  const ids: string[] = [];
  const cursors = new Set<string>();
  let cursor: string | undefined;
  for (let page = 0; ; page++) {
    // Bound even a provider that returns endless unique cursors. Never publish
    // the partial catalog, which could silently remove a person's saved model.
    if (page >= 100) throw invalid();
    const url = cursor
      ? `${endpoint}?${new URLSearchParams({ after_id: cursor })}`
      : endpoint;
    const response = await send(
      url,
      { headers: headers(ai) },
      signal,
      ai.apiKey,
    );
    const raw = await json<unknown>(response);
    // Together's native catalog is an array of model records. Normalize only
    // its compatible protocol; all records still use the common validation.
    const body =
      ai.kind === "together" && ai.format === "openai" && Array.isArray(raw)
        ? { data: raw }
        : raw;
    if (!body || typeof body !== "object" || Array.isArray(body))
      throw invalid();
    throwIfErrorEnvelope(body, ai.apiKey);
    const catalog = body as Record<string, unknown>;
    if (!("data" in catalog) && !("models" in catalog)) throw invalid();
    for (const field of ["data", "models"] as const) {
      if (!(field in catalog)) continue;
      const entries = catalog[field];
      if (!Array.isArray(entries)) throw invalid();
      for (const entry of entries) {
        const id =
          field === "models" && typeof entry === "string"
            ? entry
            : entry && typeof entry === "object" && !Array.isArray(entry)
              ? (entry.id ?? (field === "models" ? entry.name : undefined))
              : undefined;
        if (
          typeof id !== "string" ||
          !id.trim() ||
          id.length > 512 ||
          /[\u0000-\u001f\u007f]/.test(id)
        )
          throw invalid();
        ids.push(id);
        if (ids.length > 100_000) throw invalid();
      }
    }
    // Only the native Anthropic API specifies these pagination fields.
    // Compatible catalogs retain their existing single-response contract.
    if (ai.format !== "anthropic") break;
    if ("has_more" in catalog && typeof catalog.has_more !== "boolean")
      throw invalid();
    if (catalog.has_more !== true) break;
    const next = catalog.last_id;
    if (
      !Array.isArray(catalog.data) ||
      !catalog.data.length ||
      typeof next !== "string" ||
      !next.trim() ||
      next.length > 512 ||
      /[\u0000-\u001f\u007f]/.test(next) ||
      catalog.data[catalog.data.length - 1]?.id !== next ||
      cursors.has(next)
    )
      throw invalid();
    cursors.add(next);
    cursor = next;
  }
  return [...new Set(ids)].sort();
}

/**
 * Measure a batch of passages, for finding a page that says the thing in
 * other words.
 *
 * OpenAI-compatible and Azure deployment endpoints are supported. A native
 * messages-only provider cannot receive an embedding request.
 */
export async function embed(
  ai: Connection & { model: string; options?: { apiVersion?: string } },
  passages: string[],
  options: {
    model?: string;
    timeoutMs?: number;
    expectedDimensions?: number;
  } = {},
): Promise<number[][]> {
  if (!passages.length) return [];
  if (ai.format === "anthropic")
    throw new ProviderError(
      "unsupported",
      "Choose a provider that supports text embeddings.",
    );
  const model = options.model ?? ai.model;
  if (ai.format === "azure" && !ai.options?.apiVersion?.trim())
    throw new ProviderError(
      "configuration",
      "Azure embeddings need an API version.",
    );
  const url =
    ai.format === "azure"
      ? `${trimSlash(ai.baseUrl)}/openai/deployments/${encodeURIComponent(model)}/embeddings?api-version=${encodeURIComponent(ai.options!.apiVersion!)}`
      : `${trimSlash(ai.baseUrl)}/embeddings`;
  const signal = AbortSignal.timeout(options.timeoutMs ?? 60_000);
  const response = await send(
    url,
    {
      method: "POST",
      headers: headers(ai),
      body: JSON.stringify({
        ...(ai.format === "azure" ? {} : { model }),
        input: passages,
      }),
    },
    signal,
    ai.apiKey,
  );
  const body = await json<unknown>(response);
  try {
    return embeddingVectors(body, passages.length, options.expectedDimensions);
  } catch (error) {
    if (error instanceof EmbeddingResponseError)
      throw new ProviderError(error.reason, error.message);
    throw error;
  }
}

/**
 * Write out what was said in a recording (CAP-10), through the provider's
 * OpenAI-shaped /audio/transcriptions endpoint. A provider without one
 * can't write out recordings; the app says so and keeps the recording.
 */
export async function transcribe(
  ai: Connection & {
    model: string;
    assertAuthority?: ResolvedAi["assertAuthority"];
  },
  audio: Uint8Array,
  mime: string,
  options: { model?: string; timeoutMs?: number } = {},
): Promise<string> {
  if (ai.format === "anthropic")
    throw new ProviderError(
      "no_transcription",
      "The assistant's AI service can't write out recordings.",
    );
  await ai.assertAuthority?.();
  const signal = AbortSignal.timeout(options.timeoutMs ?? 300_000);
  const form = new FormData();
  const ext = mime.split("/")[1]?.replace("mpeg", "mp3") || "webm";
  form.append(
    "file",
    new Blob([audio as Uint8Array<ArrayBuffer>], { type: mime }),
    `recording.${ext}`,
  );
  form.append("model", options.model ?? "whisper-1");
  form.append("response_format", "json");
  const { "Content-Type": _json, ...rest } = headers(ai);
  const response = await send(
    `${trimSlash(ai.baseUrl)}/audio/transcriptions`,
    { method: "POST", headers: rest, body: form },
    signal,
    ai.apiKey,
  );
  const body = await json<{ text?: string }>(response);
  await ai.assertAuthority?.();
  signal.throwIfAborted();
  return (body.text ?? "").trim();
}
