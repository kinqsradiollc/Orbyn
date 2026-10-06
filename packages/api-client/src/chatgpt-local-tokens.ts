import { z } from "zod";
import {
  chatgptLoopbackUri,
  chatgptModelBinding,
  parseChatgptModels,
  type ChatgptModel,
} from "@orbyn/core";

const token = z
  .string()
  .min(1)
  .max(65536)
  .regex(/^[^\s\x00-\x1f\x7f]+$/);
const scope = z.string().regex(/^[A-Za-z0-9._:-]{1,128}$/);
const grantSchema = z
  .object({
    clientId: chatgptModelBinding.shape.client_id,
    accessToken: token,
    refreshToken: token.nullable(),
    idToken: token,
    scopes: z.array(scope).max(100),
    expiresAt: z.number().int().positive().safe(),
    savedAt: z.number().int().positive().safe(),
    sharingGranted: z.boolean(),
  })
  .strict();
export type ChatgptLocalGrant = z.output<typeof grantSchema>;
export class ChatgptLocalTokenError extends Error {
  constructor(
    readonly code: "cancelled" | "expired" | "unavailable" | "invalid",
  ) {
    super(
      code === "cancelled"
        ? "ChatGPT sign-in was cancelled."
        : code === "expired"
          ? "Reconnect this ChatGPT account."
          : "ChatGPT sign-in could not be completed. Try again.",
    );
  }
}
/** Untrusted persisted credentials must be parsed before use; scopes alone do not verify identity. */
export function parseChatgptLocalGrant(input: unknown): ChatgptLocalGrant {
  const grant = grantSchema.parse(input);
  if (
    grant.sharingGranted !==
      (grant.scopes.includes("chatgpt.tokens.use.direct") &&
        grant.scopes.includes("resource.invoke")) ||
    grant.expiresAt <= grant.savedAt
  )
    throw new ChatgptLocalTokenError("invalid");
  return grant;
}

type Transport = {
  fetch?: typeof fetch;
  signal?: AbortSignal;
  timeoutMs?: number;
  now?: () => number;
};
async function requestJson(
  url: string,
  init: RequestInit,
  options: Transport,
  maxBytes = 262144,
  unauthorizedIsExpired = false,
  emptySuccess = false,
): Promise<unknown> {
  const timeout = options.timeoutMs ?? 30000;
  if (!Number.isInteger(timeout) || timeout < 1 || timeout > 30000)
    throw new ChatgptLocalTokenError("invalid");
  const controller = new AbortController();
  const abort = () => controller.abort();
  options.signal?.addEventListener("abort", abort, { once: true });
  if (options.signal?.aborted) abort();
  const timer = setTimeout(abort, timeout);
  try {
    if (controller.signal.aborted)
      throw new ChatgptLocalTokenError("cancelled");
    const pending = (options.fetch ?? fetch)(url, {
      ...init,
      redirect: "error",
      credentials: "omit",
      cache: "no-store",
      signal: controller.signal,
    });
    const response = await new Promise<Response>((resolve, reject) => {
      const cancelled = () => reject(new ChatgptLocalTokenError("cancelled"));
      controller.signal.addEventListener("abort", cancelled, { once: true });
      pending
        .then((value) => {
          if (controller.signal.aborted)
            void value.body?.cancel().catch(() => {});
          resolve(value);
        }, reject)
        .finally(() =>
          controller.signal.removeEventListener("abort", cancelled),
        );
      if (controller.signal.aborted) cancelled();
    });
    if (controller.signal.aborted) {
      await response.body?.cancel();
      throw new ChatgptLocalTokenError("cancelled");
    }
    if (emptySuccess) {
      void response.body?.cancel().catch(() => {});
      if (response.status !== 200)
        throw new ChatgptLocalTokenError("unavailable");
      if (controller.signal.aborted)
        throw new ChatgptLocalTokenError("cancelled");
      return null;
    }
    if (!response.body) throw new ChatgptLocalTokenError("unavailable");
    const reader = response.body.getReader();
    const cancelBody = () => {
      void reader.cancel().catch(() => {});
    };
    controller.signal.addEventListener("abort", cancelBody, { once: true });
    if (controller.signal.aborted) cancelBody();
    const decoder = new TextDecoder("utf-8", { fatal: true });
    let text = "",
      size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maxBytes) throw new ChatgptLocalTokenError("unavailable");
        text += decoder.decode(value, { stream: true });
        if (controller.signal.aborted)
          throw new ChatgptLocalTokenError("cancelled");
      }
      text += decoder.decode();
    } finally {
      controller.signal.removeEventListener("abort", cancelBody);
      void reader.cancel().catch(() => {});
      reader.releaseLock();
    }
    const raw = JSON.parse(text);
    if (!response.ok)
      throw new ChatgptLocalTokenError(
        (unauthorizedIsExpired && response.status === 401) ||
          raw?.error === "invalid_grant"
          ? "expired"
          : "unavailable",
      );
    if (controller.signal.aborted)
      throw new ChatgptLocalTokenError("cancelled");
    return raw;
  } catch (error) {
    if (error instanceof ChatgptLocalTokenError) throw error;
    throw new ChatgptLocalTokenError(
      controller.signal.aborted ? "cancelled" : "unavailable",
    );
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", abort);
  }
}
async function requestTokens(
  form: URLSearchParams,
  clientId: string,
  options: Transport,
  previous?: ChatgptLocalGrant,
): Promise<ChatgptLocalGrant> {
  const raw = await requestJson(
    "https://auth.openai.com/api/accounts/oauth/token",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: form,
    },
    options,
  );
  try {
    const tokens = z
      .object({
        access_token: token,
        refresh_token: token.optional(),
        id_token: token.optional(),
        token_type: z
          .string()
          .refine((value) => value.toLowerCase() === "bearer"),
        expires_in: z.number().int().positive().max(315360000),
        scope: z
          .string()
          .max(4096)
          .regex(/^[^\x00-\x1f\x7f]*$/)
          .optional(),
      })
      .parse(raw);
    if (!previous && (!tokens.id_token || tokens.scope === undefined))
      throw new ChatgptLocalTokenError("unavailable");
    const scopes =
      tokens.scope === undefined
        ? previous!.scopes
        : [...new Set(tokens.scope.trim().split(/ +/).filter(Boolean))];
    const savedAt = (options.now ?? Date.now)();
    if (options.signal?.aborted) throw new ChatgptLocalTokenError("cancelled");
    return parseChatgptLocalGrant({
      clientId,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token ?? previous?.refreshToken ?? null,
      idToken: tokens.id_token ?? previous?.idToken,
      scopes,
      savedAt,
      expiresAt: savedAt + tokens.expires_in * 1000,
      sharingGranted:
        scopes.includes("chatgpt.tokens.use.direct") &&
        scopes.includes("resource.invoke"),
    });
  } catch (error) {
    if (error instanceof ChatgptLocalTokenError) throw error;
    throw new ChatgptLocalTokenError("unavailable");
  }
}

/** Discover models using an already identity-verified local grant; no inference or quota probe. */
export async function readChatgptLocalModels(
  input: ChatgptLocalGrant,
  options: Transport = {},
): Promise<ChatgptModel[]> {
  const grant = parseChatgptLocalGrant(input);
  if (!grant.sharingGranted) throw new ChatgptLocalTokenError("unavailable");
  if (grant.expiresAt <= (options.now ?? Date.now)())
    throw new ChatgptLocalTokenError("expired");
  const raw = await requestJson(
    "https://api.openai.com/v1/models",
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${grant.accessToken}`,
        Accept: "application/json",
      },
    },
    options,
    2 * 1024 * 1024,
    true,
  );
  if (grant.expiresAt <= (options.now ?? Date.now)())
    throw new ChatgptLocalTokenError("expired");
  try {
    return parseChatgptModels(raw);
  } catch {
    throw new ChatgptLocalTokenError("unavailable");
  }
}

/** Device-side exchange. Caller must verify the ID token before persisting or enabling the grant. */
export async function exchangeChatgptLocalCode(
  input: {
    clientId: string;
    code: string;
    verifier: string;
    redirectUri: string;
  },
  options: Transport = {},
): Promise<ChatgptLocalGrant> {
  const clientId = chatgptModelBinding.shape.client_id.parse(input.clientId);
  chatgptLoopbackUri(input.redirectUri);
  z.string()
    .min(1)
    .max(4096)
    .regex(/^[^\s\x00-\x1f\x7f]+$/)
    .parse(input.code);
  z.string()
    .regex(/^[A-Za-z0-9._~-]{43,128}$/)
    .parse(input.verifier);
  return requestTokens(
    new URLSearchParams({
      grant_type: "authorization_code",
      client_id: clientId,
      code: input.code,
      code_verifier: input.verifier,
      redirect_uri: input.redirectUri,
      resource: "https://api.openai.com/v1",
    }),
    clientId,
    options,
  );
}

/** Rotate this exact local registration, preserving omitted fields and never broadening scopes. */
export async function refreshChatgptLocalGrant(
  input: ChatgptLocalGrant,
  options: Transport = {},
): Promise<ChatgptLocalGrant> {
  const previous = parseChatgptLocalGrant(input);
  if (!previous.refreshToken) throw new ChatgptLocalTokenError("expired");
  const result = await requestTokens(
    new URLSearchParams({
      grant_type: "refresh_token",
      client_id: previous.clientId,
      refresh_token: previous.refreshToken,
      resource: "https://api.openai.com/v1",
    }),
    previous.clientId,
    options,
    previous,
  );
  if (result.scopes.some((value) => !previous.scopes.includes(value)))
    throw new ChatgptLocalTokenError("invalid");
  return result;
}

/** End this registration's renewable OpenAI session locally; never send credentials to Orbyn. */
export async function revokeChatgptLocalGrant(
  input: ChatgptLocalGrant,
  options: Transport = {},
): Promise<void> {
  const grant = parseChatgptLocalGrant(input);
  if (options.signal?.aborted) throw new ChatgptLocalTokenError("cancelled");
  if (!grant.refreshToken) return;
  for (let attempt = 0; attempt < 3; attempt++) {
    let retryable = false;
    const transport = (async (url, init) => {
      try {
        const response = await (options.fetch ?? fetch)(url, init);
        retryable = response.status >= 500 && response.status <= 599;
        return response;
      } catch (error) {
        retryable = true;
        throw error;
      }
    }) as typeof fetch;
    try {
      await requestJson(
        "https://auth.openai.com/api/accounts/oauth/revoke",
        {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            client_id: grant.clientId,
            token: grant.refreshToken,
            token_type_hint: "refresh_token",
          }),
        },
        { ...options, fetch: transport, timeoutMs: options.timeoutMs ?? 5000 },
        262144,
        false,
        true,
      );
      return;
    } catch (error) {
      if (options.signal?.aborted || !retryable || attempt === 2) throw error;
      await new Promise<void>((resolve, reject) => {
        const abort = () => {
          clearTimeout(timer);
          options.signal?.removeEventListener("abort", abort);
          reject(new ChatgptLocalTokenError("cancelled"));
        };
        const timer = setTimeout(
          () => {
            options.signal?.removeEventListener("abort", abort);
            resolve();
          },
          250 * 2 ** attempt,
        );
        options.signal?.addEventListener("abort", abort, { once: true });
        if (options.signal?.aborted) abort();
      });
    }
  }
}
