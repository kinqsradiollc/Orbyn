import { z } from "zod";
import { chatgptModelBinding } from "./chatgpt-models.js";

const opaque = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const attemptSchema = z
  .object({
    redirectUri: z.string().max(2048),
    state: opaque,
    nonce: opaque,
    challenge: opaque,
    hostId: z
      .string()
      .min(1)
      .max(512)
      .regex(/^[^\s\x00-\x1f\x7f]+$/),
    clientId: chatgptModelBinding.shape.client_id.optional(),
    idTokenHint: z
      .string()
      .min(1)
      .max(65536)
      .regex(/^[^\s\x00-\x1f\x7f]+$/)
      .optional(),
  })
  .strict();
export type ChatgptLocalOAuthAttempt = z.input<typeof attemptSchema>;

/** OSS registration uses a device-local HTTP listener, never a custom app scheme or hosted callback. */
export function chatgptLoopbackUri(value: string): URL {
  const uri = new URL(value);
  if (
    uri.protocol !== "http:" ||
    uri.hostname !== "127.0.0.1" ||
    !uri.port ||
    uri.username ||
    uri.password ||
    uri.pathname !== "/auth/callback" ||
    uri.search ||
    uri.hash
  )
    throw new Error("Invalid ChatGPT callback address.");
  return uri;
}

/** Shared native/local authorization contract: no pre-issued application client or API key. */
export function chatgptLocalAuthorizationUrl(
  value: ChatgptLocalOAuthAttempt,
): string {
  const attempt = attemptSchema.parse(value);
  chatgptLoopbackUri(attempt.redirectUri);
  if (attempt.idTokenHint && !attempt.clientId)
    throw new Error(
      "Select the saved ChatGPT registration before reconnecting.",
    );
  const url = new URL("https://auth.openai.com/api/accounts/authorize");
  url.search = new URLSearchParams({
    client_id: attempt.clientId ?? "dynamic_agent_client",
    ext_agent_host_id: attempt.hostId,
    response_type: "code",
    redirect_uri: attempt.redirectUri,
    scope:
      "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct",
    resource: "https://api.openai.com/v1",
    state: attempt.state,
    nonce: attempt.nonce,
    code_challenge: attempt.challenge,
    code_challenge_method: "S256",
  }).toString();
  if (!attempt.clientId) url.searchParams.set("agent_name_hint", "Orbyn");
  if (attempt.idTokenHint)
    url.searchParams.set("id_token_hint", attempt.idTokenHint);
  return url.href;
}

/** Validate the exact, one-attempt callback before exchanging its code. Callback scopes confer no authority. */
export function parseChatgptLocalCallback(
  value: string,
  expected: Pick<
    ChatgptLocalOAuthAttempt,
    "redirectUri" | "state" | "clientId"
  >,
): { code: string; clientId: string } {
  opaque.parse(expected.state);
  const redirect = chatgptLoopbackUri(expected.redirectUri);
  if (typeof value !== "string" || value.length > 8192)
    throw new Error("Invalid ChatGPT callback.");
  const callback = new URL(value);
  if (
    callback.origin !== redirect.origin ||
    callback.pathname !== redirect.pathname ||
    callback.hash ||
    callback.username ||
    callback.password
  )
    throw new Error("Invalid ChatGPT callback.");
  const keys = [...callback.searchParams.keys()];
  if (
    new Set(keys).size !== keys.length ||
    callback.searchParams.get("state") !== expected.state
  )
    throw new Error("ChatGPT callback does not match this attempt.");
  if (callback.searchParams.has("error"))
    throw new Error("ChatGPT authorization was not completed.");
  if (expected.clientId !== undefined)
    chatgptModelBinding.shape.client_id.parse(expected.clientId);
  const clientId = chatgptModelBinding.shape.client_id.parse(
    callback.searchParams.get("client_id") ?? expected.clientId,
  );
  if (expected.clientId && clientId !== expected.clientId)
    throw new Error("ChatGPT registration changed during sign-in.");
  const code = z
    .string()
    .min(1)
    .max(4096)
    .regex(/^[^\s\x00-\x1f\x7f]+$/)
    .parse(callback.searchParams.get("code"));
  return { code, clientId };
}
