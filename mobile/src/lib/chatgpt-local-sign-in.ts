import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import * as WebBrowser from "expo-web-browser";
import { fetch as expoFetch } from "expo/fetch";
import { Platform } from "react-native";
import { z } from "zod";
import {
  chatgptConnection,
  chatgptLocalAuthorizationUrl,
  parseChatgptLocalCallback,
  type ChatgptConnection,
  type ChatgptModel,
} from "@orbyn/core";
import {
  exchangeChatgptLocalCode,
  parseChatgptLocalGrant,
  readChatgptLocalModels,
  type ChatgptLocalGrant,
} from "@orbyn/api-client";
import {
  cancelNativeChatgptCallback,
  nativeChatgptCallbackAvailable,
  startNativeChatgptCallback,
  waitNativeChatgptCallback,
} from "../../modules/orbyn-chatgpt";
import { client } from "./api";
import { session } from "./session";

const protectedOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};
const registration = z
  .object({
    version: z.literal(1),
    revision: z.uuid(),
    connection: chatgptConnection,
    grant: z.unknown(),
  })
  .strict();
let current: {
  id: string;
  controller: AbortController;
  finished: Promise<void>;
} | null = null;
let disconnecting = false;
let hostPromise: Promise<string> | null = null;
let browserOwner: string | null = null;

function base64url(bytes: Uint8Array): string {
  const alphabet =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  let result = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const a = bytes[index],
      b = bytes[index + 1],
      c = bytes[index + 2];
    result += alphabet[a >> 2] + alphabet[((a & 3) << 4) | ((b ?? 0) >> 4)];
    if (b !== undefined) result += alphabet[((b & 15) << 2) | ((c ?? 0) >> 6)];
    if (c !== undefined) result += alphabet[c & 63];
  }
  return result;
}
async function hostId(): Promise<string> {
  hostPromise ??= (async () => {
    const key = "orbyn.chatgpt.host.v1";
    const saved = await SecureStore.getItemAsync(key, protectedOptions);
    if (saved) return `urn:uuid:${z.uuid().parse(saved)}`;
    const id = Crypto.randomUUID();
    await SecureStore.setItemAsync(key, id, protectedOptions);
    return `urn:uuid:${id}`;
  })().catch((error) => {
    hostPromise = null;
    throw error;
  });
  return hostPromise;
}
async function accountKey(userId: string): Promise<string> {
  z.uuid().parse(userId);
  const digest = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    JSON.stringify([client.baseUrl, userId]),
  );
  return `orbyn.chatgpt.account.${digest}`;
}
function decodeRegistration(value: string | null) {
  if (!value) return null;
  try {
    const saved = registration.parse(JSON.parse(value));
    const grant = parseChatgptLocalGrant(saved.grant);
    if (grant.clientId !== saved.connection.client_id)
      throw new Error("Invalid registration binding.");
    return { ...saved, grant };
  } catch {
    throw new Error(
      "The saved ChatGPT connection is unavailable. Reconnect it.",
    );
  }
}

/** Native-only authorization; access/refresh credentials stay in this device's protected store. */
export async function signInNativeChatgpt(
  userId: string,
  options: { signal?: AbortSignal } = {},
): Promise<{ connection: ChatgptConnection; sharingGranted: boolean }> {
  if (Platform.OS === "web" || !nativeChatgptCallbackAvailable())
    throw new Error(
      "This build does not include native ChatGPT authorization.",
    );
  if (current || disconnecting)
    throw new Error("Finish or cancel the current ChatGPT action first.");
  const id = Crypto.randomUUID(),
    controller = new AbortController();
  const token = session.token;
  if (!token) throw new Error("Sign in to Orbyn before connecting ChatGPT.");
  let finish!: () => void;
  const finished = new Promise<void>((resolve) => {
    finish = resolve;
  });
  current = { id, controller, finished };
  const abort = () => controller.abort();
  options.signal?.addEventListener("abort", abort, { once: true });
  if (options.signal?.aborted) abort();
  let callbackFinished = false;
  const check = () => {
    if (
      controller.signal.aborted ||
      session.token !== token ||
      current?.id !== id
    )
      throw new Error(
        "ChatGPT sign-in was cancelled or the Orbyn session changed.",
      );
  };
  const stop = () => {
    void cancelNativeChatgptCallback(id).catch(() => {});
  };
  controller.signal.addEventListener("abort", stop, { once: true });
  try {
    check();
    const user = await client.me({ fresh: true, signal: controller.signal });
    check();
    if (user.id !== userId)
      throw new Error("The signed-in Orbyn account changed.");
    const key = await accountKey(userId),
      host = await hostId();
    check();
    const original = await SecureStore.getItemAsync(key, protectedOptions);
    const saved = decodeRegistration(original);
    const returning = saved;
    check();
    const challenge = await client.startChatgptConnection(
      returning ? { client_id: returning.connection.client_id } : {},
      controller.signal,
    );
    check();
    const timeout = Math.min(
      600000,
      Date.parse(challenge.expires_at) - Date.now(),
    );
    if (timeout <= 0) throw new Error("ChatGPT sign-in expired.");
    const state = base64url(await Crypto.getRandomBytesAsync(32));
    const verifier = base64url(await Crypto.getRandomBytesAsync(32));
    const hash = await Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA256,
      verifier,
      { encoding: Crypto.CryptoEncoding.BASE64 },
    );
    const redirectUri = await startNativeChatgptCallback(
      id,
      state,
      Math.floor(timeout),
    );
    check();
    const attempt = {
      redirectUri,
      state,
      nonce: challenge.nonce,
      challenge: hash
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, ""),
      hostId: host,
      ...(returning
        ? {
            clientId: returning.connection.client_id,
            idTokenHint: returning.grant.idToken,
          }
        : {}),
    };
    const authorization = chatgptLocalAuthorizationUrl(attempt);
    if (browserOwner !== null)
      throw new Error("Finish the current authorization browser first.");
    browserOwner = id;
    // iOS uses a Safari controller inside this app, keeping the callback runtime foreground.
    // Android opens a browser/custom tab; "opened" is not authorization success.
    void WebBrowser.openBrowserAsync(authorization)
      .then((result) => {
        if (
          !callbackFinished &&
          browserOwner === id &&
          result.type !== WebBrowser.WebBrowserResultType.OPENED
        )
          controller.abort();
      })
      .catch(() => {
        if (browserOwner === id) {
          browserOwner = null;
          controller.abort();
        }
      });
    const returned = await waitNativeChatgptCallback(id);
    callbackFinished = true;
    check();
    const callback = parseChatgptLocalCallback(returned, attempt);
    const grant: ChatgptLocalGrant = await exchangeChatgptLocalCode(
      { ...callback, verifier, redirectUri },
      {
        fetch: expoFetch as unknown as typeof fetch,
        signal: controller.signal,
      },
    );
    check();
    // This endpoint verifies signature, issuer, audience, expiry and the exact
    // session-owned nonce. Only the short-lived ID proof goes to Orbyn's backend.
    const connection = await client.finishChatgptConnection(
      {
        challenge_id: challenge.id,
        client_id: callback.clientId,
        id_token: grant.idToken,
      },
      controller.signal,
    );
    check();
    if (
      connection.client_id !== grant.clientId ||
      connection.issuer !== "https://auth.openai.com" ||
      (returning &&
        (connection.subject !== returning.connection.subject ||
          connection.id !== returning.connection.id))
    )
      throw new Error("The selected ChatGPT account changed. Start again.");
    if (grant.expiresAt <= Date.now())
      throw new Error("ChatGPT sign-in expired. Reconnect this account.");
    if (!grant.sharingGranted)
      throw new Error(
        "Enable ChatGPT plan usage before connecting this provider.",
      );
    // A competing write cannot silently replace the selected registration.
    if ((await SecureStore.getItemAsync(key, protectedOptions)) !== original)
      throw new Error("ChatGPT account changed during sign-in. Try again.");
    check();
    const installed = JSON.stringify({
      version: 1,
      revision: id,
      connection,
      grant,
    });
    await SecureStore.setItemAsync(key, installed, protectedOptions);
    if (
      session.token !== token ||
      controller.signal.aborted ||
      current?.id !== id
    ) {
      // Remove only this attempt's record; preserve any newer replacement.
      if (
        (await SecureStore.getItemAsync(key, protectedOptions)) === installed
      ) {
        if (original === null)
          await SecureStore.deleteItemAsync(key, protectedOptions);
        else await SecureStore.setItemAsync(key, original, protectedOptions);
      }
      check();
    }
    return { connection, sharingGranted: grant.sharingGranted };
  } finally {
    callbackFinished = true;
    options.signal?.removeEventListener("abort", abort);
    controller.signal.removeEventListener("abort", stop);
    await cancelNativeChatgptCallback(id).catch(() => {});
    if (browserOwner === id) {
      browserOwner = null;
      try {
        WebBrowser.dismissBrowser();
      } catch {
        /* Native browser may already be dismissed. */
      }
    }
    if (current?.id === id) current = null;
    finish();
  }
}

/** Account changes/unmounts cancel the exact native attempt without touching a future one. */
export function cancelNativeChatgptSignIn() {
  current?.controller.abort();
}

/** Read only this native account's current catalog; never publish credentials or silently switch accounts. */
export async function readNativeChatgptModels(
  userId: string,
  options: { signal?: AbortSignal } = {},
): Promise<{ connection: ChatgptConnection; models: ChatgptModel[] }> {
  if (Platform.OS === "web" || !nativeChatgptCallbackAvailable())
    throw new Error(
      "This build does not include native ChatGPT authorization.",
    );
  const token = session.token;
  if (!token) throw new Error("Sign in to Orbyn before connecting ChatGPT.");
  const check = () => {
    if (
      options.signal?.aborted ||
      session.token !== token ||
      current ||
      disconnecting
    )
      throw new Error(
        "The Orbyn session or ChatGPT connection changed. Try again.",
      );
  };
  check();
  const user = await client.me({ fresh: true, signal: options.signal });
  check();
  if (user.id !== userId)
    throw new Error("The signed-in Orbyn account changed.");
  const key = await accountKey(userId);
  const original = await SecureStore.getItemAsync(key, protectedOptions);
  check();
  const saved = decodeRegistration(original);
  if (!saved) throw new Error("Connect ChatGPT before loading models.");
  // Revoked or replaced server identity cannot authorize a stored local token.
  const connections = await client.chatgptConnections(options.signal);
  check();
  if (
    !connections.some(
      (connection) =>
        connection.id === saved.connection.id &&
        connection.client_id === saved.connection.client_id &&
        connection.subject === saved.connection.subject &&
        connection.issuer === saved.connection.issuer,
    )
  )
    throw new Error("Reconnect this ChatGPT account before loading models.");
  if ((await SecureStore.getItemAsync(key, protectedOptions)) !== original)
    throw new Error("ChatGPT account changed. Try again.");
  check();
  const models = await readChatgptLocalModels(saved.grant, {
    fetch: expoFetch as unknown as typeof fetch,
    signal: options.signal,
  });
  check();
  if ((await SecureStore.getItemAsync(key, protectedOptions)) !== original)
    throw new Error("ChatGPT account changed. Try again.");
  check();
  return { connection: saved.connection, models };
}

/** Disconnect this native account: cancel sign-in, erase local credentials and revoke server metadata. */
export async function disconnectNativeChatgpt(userId: string): Promise<void> {
  if (Platform.OS === "web" || !nativeChatgptCallbackAvailable())
    throw new Error(
      "This build does not include native ChatGPT authorization.",
    );
  if (disconnecting)
    throw new Error("ChatGPT disconnect is already in progress.");
  const token = session.token;
  if (!token) throw new Error("Sign in to Orbyn before disconnecting ChatGPT.");
  disconnecting = true;
  try {
    const attempt = current;
    attempt?.controller.abort();
    await attempt?.finished;
    const check = () => {
      if (session.token !== token)
        throw new Error("The signed-in Orbyn account changed.");
    };
    check();
    const user = await client.me({ fresh: true });
    check();
    if (user.id !== userId)
      throw new Error("The signed-in Orbyn account changed.");
    const key = await accountKey(userId);
    const original = await SecureStore.getItemAsync(key, protectedOptions);
    check();
    if (original === null) return;
    // Corrupt local credentials must still be erasable; do not guess a remote connection ID.
    let saved: ReturnType<typeof decodeRegistration> = null;
    try {
      saved = decodeRegistration(original);
    } catch {}
    if ((await SecureStore.getItemAsync(key, protectedOptions)) !== original)
      throw new Error("ChatGPT account changed. Try again.");
    check();
    // Once ownership is checked, a revocation failure must not retain local tokens.
    await SecureStore.deleteItemAsync(key, protectedOptions);
    check();
    if (saved) {
      try {
        await client.revokeChatgptConnection(saved.connection.id);
      } catch {
        throw new Error(
          "ChatGPT was removed from this device. Server disconnect could not be confirmed; retry from connected accounts.",
        );
      }
      check();
    }
  } finally {
    disconnecting = false;
  }
}
