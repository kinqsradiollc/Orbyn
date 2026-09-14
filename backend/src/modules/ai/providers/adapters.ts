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

const trimSlash = (url: string) => url.replace(/\/+$/, "");

function describeStatus(status: number) {
  if (status === 401 || status === 403)
    return `The provider rejected the API key (HTTP ${status}).`;
  if (status === 404)
    return "The provider could not find that model or address (HTTP 404).";
  if (status === 429)
    return "The provider is rate limiting requests (HTTP 429).";
  return `The provider returned an error (HTTP ${status}).`;
}

function headers(
  ai: Pick<ResolvedAi, "format" | "apiKey">,
): Record<string, string> {
  if (ai.format === "anthropic")
    return {
      "Content-Type": "application/json",
      "x-api-key": ai.apiKey,
      "anthropic-version": "2023-06-01",
    };
  if (ai.format === "azure")
    return { "Content-Type": "application/json", "api-key": ai.apiKey };
  return {
    "Content-Type": "application/json",
    ...(ai.apiKey ? { Authorization: `Bearer ${ai.apiKey}` } : {}),
  };
}

async function send(url: string, init: RequestInit, signal: AbortSignal) {
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
  if (!response.ok)
    throw new ProviderError(
      `http_${response.status}`,
      describeStatus(response.status),
    );
  return response;
}

async function json<T>(response: Response): Promise<T> {
  try {
    return (await response.json()) as T;
  } catch {
    throw new ProviderError(
      "invalid_body",
      "The provider sent a reply Orbyn could not read.",
    );
  }
}

/**
 * Send a chat and return the model's text reply. Pass `signal` to share one
 * deadline across retries; otherwise the call times out after `timeoutMs`.
 */
export async function complete(
  ai: ResolvedAi,
  messages: ChatMessage[],
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<string> {
  const signal =
    options.signal ?? AbortSignal.timeout(options.timeoutMs ?? 60_000);
  if (ai.format === "anthropic") {
    // Anthropic takes the system prompt separately and requires max_tokens.
    const system = messages
      .filter((m) => m.role === "system")
      .map((m) => m.content)
      .join("\n\n");
    const response = await send(
      `${trimSlash(ai.baseUrl)}/messages`,
      {
        method: "POST",
        headers: headers(ai),
        body: JSON.stringify({
          model: ai.model,
          max_tokens: 4096,
          ...(system ? { system } : {}),
          messages: messages.filter((m) => m.role !== "system"),
        }),
      },
      signal,
    );
    const body = await json<{ content?: { type: string; text?: string }[] }>(
      response,
    );
    return (body.content ?? [])
      .filter((part) => part.type === "text")
      .map((part) => part.text ?? "")
      .join("");
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
      body: JSON.stringify(
        ai.format === "azure" ? { messages } : { model: ai.model, messages },
      ),
    },
    signal,
  );
  const body = await json<{ choices?: { message?: { content?: string } }[] }>(
    response,
  );
  return body.choices?.[0]?.message?.content ?? "";
}

/** The provider's model ids, sorted. Uses the saved key. */
export async function listModels(
  ai: Pick<ResolvedAi, "format" | "baseUrl" | "apiKey">,
): Promise<string[]> {
  if (ai.format === "azure")
    throw new ProviderError(
      "unsupported",
      "Azure does not list deployments here. Type your deployment name as the model.",
    );
  const response = await send(
    `${trimSlash(ai.baseUrl)}/models`,
    { headers: headers(ai) },
    AbortSignal.timeout(10_000),
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
