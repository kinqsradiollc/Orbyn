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
  refreshChatgptLocalGrant,
  revokeChatgptLocalGrant,
  createChatgptExecutorSigner,
  createChatgptExecutorLifecycle,
  ChatgptPlanClient,
  ChatgptPlanError,
  ChatgptLocalTokenError,
  type ChatgptLocalGrant,
} from "@orbyn/api-client";
import {
  cancelNativeChatgptCallback,
  nativeChatgptCallbackAvailable,
  startNativeChatgptCallback,
  waitNativeChatgptCallback,
  nativeChatgptSigningAvailable,
  nativeChatgptKeyMetadata,
  signNativeChatgptProof,
  removeNativeChatgptKey,
} from "../../modules/orbyn-chatgpt";
import { client } from "./api";
import { session } from "./session";
import { createNativeChatgptProtectedStore } from "./chatgpt-protected-store";
import { createNativeChatgptAccountDirectory } from "./chatgpt-account-directory";
import { migrateNativeChatgptSingleton } from "./chatgpt-account-migration";

const protectedOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};
const registration = z
  .object({
    version: z.literal(1),
    revision: z.uuid(),
    connection: chatgptConnection,
    grant: z.unknown(),
    signingAlias: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
  })
  .strict();
// A confirmed unusable grant retains only the verified registration mapping.
const retiredRegistration = registration.extend({
  version: z.literal(2),
  grant: z.null(),
});
function decodeRetiredRegistration(value: string | null) {
  if (!value) return null;
  try {
    const parsed = retiredRegistration.safeParse(JSON.parse(value));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
let current: {
  id: string;
  controller: AbortController;
  finished: Promise<void>;
  mode: "sign-in" | "refresh" | "migration";
  key?: string;
  sessionToken?: string;
} | null = null;
let disconnecting = false;
const executorRequests = new Map<string, symbol>();
const executors = new Set<{ userId: string; close: () => void }>();
function stopExecutors(userId: string) {
  executorRequests.delete(userId);
  for (const executor of executors)
    if (executor.userId === userId) executor.close();
}
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
async function accountStorage(
  userId: string,
  checkOwner: () => void | Promise<void>,
) {
  const owner = { apiBaseUrl: client.baseUrl, userId };
  const storage = await createNativeChatgptProtectedStore({
    owner,
    checkOwner,
  });
  const directory = createNativeChatgptAccountDirectory({
    owner,
    checkOwner,
    storage,
    revision: Crypto.randomUUID,
    digest: (value) =>
      Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, value),
  });
  return { storage, directory };
}
async function accountKey(userId: string): Promise<string> {
  const token = session.token;
  const check = () => {
    if (!token || session.token !== token)
      throw new Error("The Orbyn session changed. Try again.");
  };
  const { storage, directory } = await accountStorage(userId, check);
  const state = await directory.read();
  check();
  if (state === null) return storage.legacyKey;
  // A published-but-unfinished migration must never authorize a second credential copy.
  if ((await storage.read(storage.legacyKey)) !== null)
    throw new Error(
      "Finish migrating the saved ChatGPT account before using it.",
    );
  check();
  const entry = state.selected
    ? state.accounts.find(
        (entry) =>
          entry.connection.id === state.selected &&
          entry.status === "connected",
      )
    : state.accounts.length === 1 && state.accounts[0].status !== "connected"
      ? state.accounts[0]
      : null;
  if (!entry) throw new Error("Choose a saved ChatGPT account first.");
  return storage.slotKey(entry.connection.id);
}
/** Explicit protected migration; caller can refresh Settings after completion. Never starts OAuth or inference. */
export async function prepareNativeChatgptAccounts(
  userId: string,
  options: { signal?: AbortSignal } = {},
) {
  if (Platform.OS === "web" || !nativeChatgptCallbackAvailable())
    throw new Error(
      "This build does not include native ChatGPT authorization.",
    );
  if (current || disconnecting)
    throw new Error("Finish or cancel the current ChatGPT action first.");
  const token = session.token,
    id = Crypto.randomUUID(),
    controller = new AbortController();
  if (!token) throw new Error("Sign in to Orbyn before managing ChatGPT.");
  let finish!: () => void;
  const finished = new Promise<void>((resolve) => {
    finish = resolve;
  });
  current = { id, controller, finished, mode: "migration" };
  stopExecutors(userId);
  const abort = () => controller.abort();
  options.signal?.addEventListener("abort", abort, { once: true });
  if (options.signal?.aborted) abort();
  const check = () => {
    if (
      session.token !== token ||
      controller.signal.aborted ||
      current?.id !== id
    )
      throw new Error(
        "The Orbyn session changed or account migration was cancelled.",
      );
  };
  try {
    check();
    const user = await client.me({ fresh: true, signal: controller.signal });
    check();
    if (user.id !== userId)
      throw new Error("The signed-in Orbyn account changed.");
    const context = await accountStorage(userId, check);
    check();
    return await migrateNativeChatgptSingleton({
      ...context,
      checkOwner: check,
    });
  } finally {
    options.signal?.removeEventListener("abort", abort);
    if (current?.id === id) current = null;
    finish();
  }
}
async function updateDirectoryStatus(
  userId: string,
  key: string,
  next: "connected" | "reconnect" | "disconnected",
  check: () => void,
) {
  if (!key.includes(".slot.")) return;
  const { storage, directory } = await accountStorage(userId, check);
  const state = await directory.read();
  check();
  const entry = state?.accounts.find(
    (entry) => storage.slotKey(entry.connection.id) === key,
  );
  if (!state || !entry)
    throw new Error("The saved ChatGPT account changed. Try again.");
  if (next === "connected") {
    if (state.selected === entry.connection.id && entry.status === "connected")
      return;
    if (state.selected !== null && state.selected !== entry.connection.id)
      throw new Error("The selected ChatGPT account changed. Try again.");
    const updated = await directory.add(entry.connection, state.revision);
    check();
    await directory.select(entry.connection.id, updated.revision);
  } else
    await directory.markUnavailable(entry.connection.id, next, state.revision);
  check();
}
function mappingKey(key: string) {
  return key.includes(".slot.")
    ? key.replace(".slot.", ".slot-registration.")
    : key.replace(".account.", ".registration.");
}
function decodeRegistration(value: string | null) {
  if (!value || decodeRetiredRegistration(value)) return null;
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
  stopExecutors(userId);
  current = { id, controller, finished, mode: "sign-in" };
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
    const originalMapping = await SecureStore.getItemAsync(
      mappingKey(key),
      protectedOptions,
    );
    check();
    const returning =
      saved ??
      decodeRetiredRegistration(original) ??
      decodeRetiredRegistration(originalMapping);
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
            ...(saved ? { idTokenHint: saved.grant.idToken } : {}),
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
    if (
      (await SecureStore.getItemAsync(mappingKey(key), protectedOptions)) !==
      originalMapping
    )
      throw new Error(
        "ChatGPT registration changed during sign-in. Try again.",
      );
    check();
    if ((await SecureStore.getItemAsync(key, protectedOptions)) !== original)
      throw new Error("ChatGPT account changed during sign-in. Try again.");
    check();
    const installed = JSON.stringify({
      version: 1,
      revision: id,
      connection,
      grant,
      ...(returning?.signingAlias
        ? { signingAlias: returning.signingAlias }
        : {}),
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
    try {
      await updateDirectoryStatus(userId, key, "connected", check);
    } catch (error) {
      // Metadata publication is also an awaited ownership boundary.
      if (
        session.token !== token ||
        controller.signal.aborted ||
        current?.id !== id
      ) {
        if (
          (await SecureStore.getItemAsync(key, protectedOptions)) === installed
        ) {
          if (original === null)
            await SecureStore.deleteItemAsync(key, protectedOptions);
          else await SecureStore.setItemAsync(key, original, protectedOptions);
        }
      }
      throw error;
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

async function renewNativeRegistration(
  userId: string,
  key: string,
  original: string,
  saved: NonNullable<ReturnType<typeof decodeRegistration>>,
  sessionToken: string,
  signal?: AbortSignal,
) {
  if (current || disconnecting)
    throw new Error("Finish the current ChatGPT action first.");
  const id = Crypto.randomUUID(),
    controller = new AbortController();
  let finish!: () => void;
  const finished = new Promise<void>((resolve) => {
    finish = resolve;
  });
  current = { id, controller, finished, mode: "refresh", key, sessionToken };
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) abort();
  const check = () => {
    if (
      controller.signal.aborted ||
      session.token !== sessionToken ||
      current?.id !== id
    )
      throw new Error(
        "The Orbyn session or ChatGPT connection changed. Try again.",
      );
  };
  try {
    check();
    const grant = await refreshChatgptLocalGrant(saved.grant, {
      fetch: expoFetch as unknown as typeof fetch,
      signal: controller.signal,
    });
    check();
    if (grant.idToken !== saved.grant.idToken) {
      const identity = await client.verifyChatgptRefreshIdentity(
        {
          connection_id: saved.connection.id,
          id_token: grant.idToken,
        },
        controller.signal,
      );
      check();
      if (
        identity.id !== saved.connection.id ||
        identity.client_id !== saved.connection.client_id ||
        identity.subject !== saved.connection.subject ||
        identity.issuer !== saved.connection.issuer
      )
        throw new Error("The refreshed ChatGPT account changed. Reconnect.");
    }
    // Even omitted identity tokens require a still-live owned server connection.
    const live = await client.chatgptConnections(controller.signal);
    check();
    if (
      !live.some(
        (row) =>
          row.id === saved.connection.id &&
          row.client_id === saved.connection.client_id &&
          row.subject === saved.connection.subject &&
          row.issuer === saved.connection.issuer,
      )
    )
      throw new Error("Reconnect this ChatGPT account.");
    if ((await SecureStore.getItemAsync(key, protectedOptions)) !== original)
      throw new Error("ChatGPT account changed. Try again.");
    check();
    const installed = JSON.stringify({
      version: 1,
      revision: id,
      connection: saved.connection,
      grant,
      ...(saved.signingAlias ? { signingAlias: saved.signingAlias } : {}),
    });
    await SecureStore.setItemAsync(key, installed, protectedOptions);
    if (
      controller.signal.aborted ||
      session.token !== sessionToken ||
      current?.id !== id
    ) {
      if ((await SecureStore.getItemAsync(key, protectedOptions)) === installed)
        await SecureStore.setItemAsync(key, original, protectedOptions);
      check();
    }
    return { original: installed, saved: { ...saved, revision: id, grant } };
  } catch (error) {
    if (
      error instanceof ChatgptLocalTokenError &&
      error.code === "invalid_refresh"
    ) {
      check();
      if ((await SecureStore.getItemAsync(key, protectedOptions)) !== original)
        throw new Error("ChatGPT account changed. Try again.");
      check();
      await SecureStore.setItemAsync(
        key,
        JSON.stringify({
          version: 2,
          revision: id,
          connection: saved.connection,
          grant: null,
          ...(saved.signingAlias ? { signingAlias: saved.signingAlias } : {}),
        }),
        protectedOptions,
      );
      // Never restore confirmed unusable credentials, including after cancellation.
      stopExecutors(userId);
      await updateDirectoryStatus(userId, key, "reconnect", check);
    }
    throw error;
  } finally {
    signal?.removeEventListener("abort", abort);
    if (current?.id === id) current = null;
    finish();
  }
}

let modelReads: Promise<unknown> = Promise.resolve();
/** Serialize local credential renewal; queued calls retain their original session and cancellation fence. */
export function readNativeChatgptModels(
  userId: string,
  options: { signal?: AbortSignal } = {},
): Promise<{ connection: ChatgptConnection; models: ChatgptModel[] }> {
  const token = session.token;
  const result = modelReads
    .catch(() => {})
    .then(() => {
      if (options.signal?.aborted || session.token !== token)
        throw new Error(
          "The Orbyn session or ChatGPT connection changed. Try again.",
        );
      return readNativeChatgptModelsOwned(userId, options);
    });
  modelReads = result.catch(() => {});
  return result;
}

/** Read only this native account's current catalog; never publish credentials or silently switch accounts. */
async function readNativeChatgptModelsOwned(
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
  let original = await SecureStore.getItemAsync(key, protectedOptions);
  check();
  const decoded = decodeRegistration(original);
  if (!decoded) throw new Error("Connect ChatGPT before loading models.");
  let saved = decoded;
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
  if (saved.grant.expiresAt <= Date.now() + 60000) {
    const renewed = await renewNativeRegistration(
      userId,
      key,
      original!,
      saved,
      token,
      options.signal,
    );
    original = renewed.original;
    saved = renewed.saved;
    check();
  }
  if ((await accountKey(userId)) !== key)
    throw new Error("The selected ChatGPT account changed.");
  check();
  const models = await readChatgptLocalModels(saved.grant, {
    fetch: expoFetch as unknown as typeof fetch,
    signal: options.signal,
  });
  check();
  if ((await SecureStore.getItemAsync(key, protectedOptions)) !== original)
    throw new Error("ChatGPT account changed. Try again.");
  check();
  if ((await accountKey(userId)) !== key)
    throw new Error("The selected ChatGPT account changed.");
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
  stopExecutors(userId);
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
    if (original === null) {
      const mapping = decodeRetiredRegistration(
        await SecureStore.getItemAsync(mappingKey(key), protectedOptions),
      );
      check();
      if (nativeChatgptSigningAvailable())
        await removeNativeChatgptKey(
          mapping?.signingAlias ?? key.split(".").at(-1)!,
        );
      await updateDirectoryStatus(userId, key, "disconnected", check);
      return;
    }
    // Corrupt local credentials must still be erasable; do not guess a remote connection ID.
    let saved: ReturnType<typeof decodeRegistration> = null;
    try {
      saved = decodeRegistration(original);
    } catch {}
    if ((await SecureStore.getItemAsync(key, protectedOptions)) !== original)
      throw new Error("ChatGPT account changed. Try again.");
    check();
    let remoteRevocationFailed = false;
    if (saved) {
      try {
        await revokeChatgptLocalGrant(saved.grant, {
          fetch: (async (url, init) => {
            check();
            return expoFetch(url, init);
          }) as typeof fetch,
        });
      } catch {
        remoteRevocationFailed = true;
      }
      check();
      if ((await SecureStore.getItemAsync(key, protectedOptions)) !== original)
        throw new Error("ChatGPT account changed. Try again.");
      check();
    }
    const ownedRegistration = saved ?? decodeRetiredRegistration(original);
    const ownedConnection = ownedRegistration?.connection;
    let mappingSaveFailed = false;
    if (ownedConnection) {
      try {
        await SecureStore.setItemAsync(
          mappingKey(key),
          JSON.stringify({
            version: 2,
            revision: Crypto.randomUUID(),
            connection: ownedConnection,
            grant: null,
            ...(ownedRegistration?.signingAlias
              ? { signingAlias: ownedRegistration.signingAlias }
              : {}),
          }),
          protectedOptions,
        );
      } catch {
        mappingSaveFailed = true;
      }
      check();
      if ((await SecureStore.getItemAsync(key, protectedOptions)) !== original)
        throw new Error("ChatGPT account changed. Try again.");
      check();
    }
    // A provider or server revocation failure must not retain owned local tokens.
    await SecureStore.deleteItemAsync(key, protectedOptions);
    check();
    let keyRemovalFailed = false;
    if (nativeChatgptSigningAvailable()) {
      try {
        await removeNativeChatgptKey(
          ownedRegistration?.signingAlias ?? key.split(".").at(-1)!,
        );
      } catch {
        keyRemovalFailed = true;
      }
      check();
    }
    let directoryCleanupFailed = false;
    try {
      await updateDirectoryStatus(userId, key, "disconnected", check);
    } catch {
      directoryCleanupFailed = true;
    }
    check();
    let serverDisconnectFailed = false;
    if (ownedConnection) {
      try {
        await client.revokeChatgptConnection(ownedConnection.id);
      } catch {
        serverDisconnectFailed = true;
      }
      check();
    }
    const warnings = [
      directoryCleanupFailed
        ? "Saved account status could not be updated; retry cleanup."
        : null,
      mappingSaveFailed
        ? "The registration could not be saved for reconnect; a new registration may be required."
        : null,
      remoteRevocationFailed
        ? "OpenAI session revocation could not be confirmed; disconnect Orbyn in ChatGPT Settings → Usage."
        : null,
      serverDisconnectFailed
        ? "Server disconnect could not be confirmed; retry from connected accounts."
        : null,
      keyRemovalFailed
        ? "This device's signing key could not be erased; retry disconnect."
        : null,
    ].filter(Boolean);
    if (warnings.length)
      throw new Error(
        "ChatGPT was removed from this device. " + warnings.join(" "),
      );
  } finally {
    disconnecting = false;
  }
}

/** Private native executor: OAuth credentials and provider requests stay on this device. */
export async function createNativeChatgptExecutor(userId: string) {
  if (Platform.OS === "web" || !nativeChatgptSigningAvailable())
    throw new Error(
      "This build does not include native ChatGPT executor signing.",
    );
  const token = session.token;
  if (!token) throw new Error("Sign in to Orbyn before connecting ChatGPT.");
  stopExecutors(userId);
  const request = Symbol();
  executorRequests.set(userId, request);
  let ownedKey: string | undefined;
  const check = () => {
    if (
      session.token !== token ||
      (current &&
        !(
          current.mode === "refresh" &&
          ownedKey &&
          current.key === ownedKey &&
          current.sessionToken === token
        )) ||
      disconnecting ||
      executorRequests.get(userId) !== request
    )
      throw new Error(
        "The Orbyn session or ChatGPT connection changed. Try again.",
      );
  };
  check();
  const user = await client.me({ fresh: true });
  check();
  if (user.id !== userId)
    throw new Error("The signed-in Orbyn account changed.");
  const key = await accountKey(userId);
  ownedKey = key;
  const saved = decodeRegistration(
    await SecureStore.getItemAsync(key, protectedOptions),
  );
  check();
  if (!saved || !saved.grant.sharingGranted)
    throw new Error("Connect ChatGPT plan usage first.");
  const connection = saved.connection;
  const host = (await hostId()).replace(/^urn:uuid:/, "");
  check();
  const binding = {
    user_id: userId,
    connection_id: connection.id,
    issuer: connection.issuer,
    subject: connection.subject,
    client_id: connection.client_id,
  };
  const live = async () => {
    check();
    if ((await accountKey(userId)) !== key)
      throw new Error("The selected ChatGPT account changed.");
    check();
    const record = decodeRegistration(
      await SecureStore.getItemAsync(key, protectedOptions),
    );
    check();
    if (
      !record ||
      !record.grant.sharingGranted ||
      record.connection.id !== connection.id ||
      record.connection.client_id !== connection.client_id ||
      record.connection.subject !== connection.subject ||
      record.connection.issuer !== connection.issuer ||
      record.signingAlias !== saved.signingAlias
    )
      throw new Error("The ChatGPT account changed. Reconnect it.");
    const rows = await client.chatgptConnections();
    check();
    if (
      !rows.some(
        (row) =>
          row.id === connection.id &&
          row.client_id === connection.client_id &&
          row.subject === connection.subject &&
          row.issuer === connection.issuer,
      )
    )
      throw new Error("The ChatGPT connection is no longer available.");
  };
  await live();
  const alias = saved.signingAlias ?? key.split(".").at(-1)!;
  const signer = createChatgptExecutorSigner({
    binding,
    hostId: host,
    requireLiveConnection: live,
    keys: {
      metadata: () => nativeChatgptKeyMetadata(alias),
      sign: (fingerprint, message) =>
        signNativeChatgptProof(alias, fingerprint, message),
      remove: () => removeNativeChatgptKey(alias),
    },
    digest: async (message) =>
      (
        await Crypto.digestStringAsync(
          Crypto.CryptoDigestAlgorithm.SHA256,
          message,
          { encoding: Crypto.CryptoEncoding.BASE64 },
        )
      )
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, ""),
  });
  const plan = new ChatgptPlanClient({
    binding,
    credential: async () => {
      await live();
      const record = decodeRegistration(
        await SecureStore.getItemAsync(key, protectedOptions),
      );
      await live();
      if (
        !record ||
        !record.grant.sharingGranted ||
        record.grant.expiresAt <= Date.now() ||
        record.connection.id !== connection.id ||
        record.grant.clientId !== connection.client_id
      )
        throw new Error("Reconnect this ChatGPT account before continuing.");
      return { binding, accessToken: record.grant.accessToken };
    },
    fetch: (async (url, init) => {
      await live();
      init?.signal?.throwIfAborted();
      const response = await expoFetch(url, init);
      try {
        await live();
        init?.signal?.throwIfAborted();
      } catch (error) {
        await response.body?.cancel().catch(() => {});
        throw error;
      }
      return response;
    }) as typeof fetch,
  });
  const runtime = createChatgptExecutorLifecycle({
    binding,
    client,
    signer,
    requireLiveConnection: live,
    models: async (signal) =>
      (await readNativeChatgptModels(userId, { signal })).models,
    inference: {
      client,
      digest: (message) =>
        Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, message),
      complete: async (assignment, signal) => {
        // Refresh locally and verify identity/scopes before the provider receives any prompt.
        await readNativeChatgptModels(userId, { signal });
        await live();
        let usage: import("@orbyn/core").ChatgptPlanUsage | null = null;
        try {
          const text = await plan.complete(
            { model: assignment.model, ...assignment.payload },
            {
              signal,
              onUsage: (value) => {
                usage = value;
              },
            },
          );
          return { status: "completed", text, usage };
        } catch (error) {
          if (!(error instanceof ChatgptPlanError)) throw error;
          return {
            status: "failed",
            reason:
              error.providerCode === "subscription_sharing_user_not_eligible"
                ? "eligibility"
                : error.providerCode ===
                    "subscription_sharing_usage_limit_exceeded"
                  ? "usage_limit"
                  : error.providerCode ===
                      "subscription_sharing_usage_unavailable"
                    ? "unavailable"
                    : error.status === 401 || error.status === 403
                      ? "permission"
                      : "unknown",
            phase: error.status === 200 ? "stream" : "admission",
            http_status: error.status,
            provider_code: error.providerCode,
          };
        }
      },
    },
  });
  const handle = {
    userId,
    close: () => {
      runtime.close();
      executors.delete(handle);
      if (executorRequests.get(userId) === request)
        executorRequests.delete(userId);
    },
  };
  executors.add(handle);
  return {
    start: runtime.start,
    heartbeat: runtime.heartbeat,
    refreshCatalog: runtime.refreshCatalog,
    executeNext: runtime.executeNext,
    close: handle.close,
  };
}

/** Local presence only; executor creation separately verifies the live server identity. */
export async function hasNativeChatgptRegistration(userId: string) {
  if (Platform.OS === "web" || !nativeChatgptSigningAvailable()) return false;
  const saved = decodeRegistration(
    await SecureStore.getItemAsync(await accountKey(userId), protectedOptions),
  );
  return Boolean(saved?.grant.sharingGranted);
}

export type NativeChatgptAccountState =
  | { status: "missing" | "unsupported" | "unreadable" | "reconnect" }
  | { status: "saved"; planUseAllowed: boolean };

/** Settings presence is independent of executor eligibility; never return protected credentials. */
export async function readNativeChatgptAccountState(
  userId: string,
  options: { signal?: AbortSignal } = {},
): Promise<NativeChatgptAccountState> {
  const token = session.token;
  const check = () => {
    if (!token || session.token !== token || options.signal?.aborted)
      throw new Error(
        "The signed-in Orbyn account changed or the request was cancelled.",
      );
  };
  check();
  if (Platform.OS === "web" || !nativeChatgptCallbackAvailable())
    return { status: "unsupported" };
  const user = await client.me({ fresh: true, signal: options.signal });
  check();
  if (user.id !== userId)
    throw new Error("The signed-in Orbyn account changed.");
  const key = await accountKey(userId);
  check();
  const value = await SecureStore.getItemAsync(key, protectedOptions);
  check();
  if (value === null) return { status: "missing" };
  if (decodeRetiredRegistration(value)) return { status: "reconnect" };
  try {
    const saved = decodeRegistration(value);
    return saved
      ? { status: "saved", planUseAllowed: saved.grant.sharingGranted }
      : { status: "unreadable" };
  } catch {
    return { status: "unreadable" };
  }
}
