import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";

const SESSION_KEY = "orbyn-session";
const PUSH_KEY = "orbyn-push";
const ASSISTANT_CHAT_KEY = "orbyn-assistant-chat";

/**
 * Where the session token is kept. On a phone that is the keychain, through
 * expo-secure-store. The web build has no keychain, so it uses the browser's
 * own storage instead — the same place the web app keeps its token.
 */
const store = {
  get: (key: string): Promise<string | null> =>
    Platform.OS === "web"
      ? Promise.resolve(safeRead(key))
      : SecureStore.getItemAsync(key),
  set: (key: string, value: string): Promise<void> =>
    Platform.OS === "web"
      ? Promise.resolve(safeWrite(key, value))
      : SecureStore.setItemAsync(key, value),
  remove: (key: string): Promise<void> =>
    Platform.OS === "web"
      ? Promise.resolve(safeWrite(key, null))
      : SecureStore.deleteItemAsync(key),
};

/** Unavailable browser reads never establish an account identity. */
function safeRead(key: string): string | null {
  try {
    return globalThis.localStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}
function safeWrite(key: string, value: string | null): void {
  try {
    const storage = globalThis.localStorage;
    if (!storage) {
      if (key === SESSION_KEY)
        throw new Error("Session storage is unavailable.");
      return;
    }
    if (value === null) storage.removeItem(key);
    else storage.setItem(key, value);
  } catch (error) {
    // Credential persistence/removal must report failure. Auxiliary preferences
    // remain best effort, as before.
    if (key === SESSION_KEY) throw error;
  }
}

/** A recoverable device-storage failure, bound to its own identity transition. */
export class SessionStorageError extends Error {
  constructor(
    readonly generation: number,
    operation: "save" | "clear",
  ) {
    super(
      operation === "save"
        ? "Couldn't save your sign-in on this device. Try signing in again before closing Orbyn."
        : "Couldn't remove your sign-in from this device. Try signing out again before closing Orbyn.",
    );
    this.name = "SessionStorageError";
  }
}

/** Live identity is confirmed only by login/register or an authenticated profile. */
export const session = { token: "", userId: "", generation: 0 };
const sessionListeners = new Set<() => void>();
export function subscribeSession(listener: () => void) {
  sessionListeners.add(listener);
  return () => void sessionListeners.delete(listener);
}

function adopt(token: string, userId: string) {
  session.token = token;
  session.userId = userId;
  const generation = ++session.generation;
  for (const listener of sessionListeners) listener();
  return generation;
}

// A started native write cannot be cancelled. Serialize later writes after it,
// and skip queued work belonging to a session that has already been replaced.
let sessionWrite: Promise<void> = Promise.resolve();
function persistSession(epoch: number, value: string | null) {
  const write = sessionWrite.then(async () => {
    if (session.generation !== epoch) return;
    if (value === null) await store.remove(SESSION_KEY);
    else await store.set(SESSION_KEY, value);
  });
  sessionWrite = write.catch(() => undefined);
  return write;
}
function encodedSession() {
  return JSON.stringify({
    version: 1,
    token: session.token,
    userId: session.userId,
  });
}
function decodeSession(raw: string | null): { token: string; userId: string } {
  if (!raw) return { token: "", userId: "" };
  // Old installations stored the opaque token directly. Its account stays
  // unidentified until /me succeeds; cached profile data is never identity proof.
  if (!raw.trimStart().startsWith("{")) return { token: raw, userId: "" };
  try {
    const value: unknown = JSON.parse(raw);
    if (
      value &&
      typeof value === "object" &&
      "version" in value &&
      value.version === 1 &&
      "token" in value &&
      typeof value.token === "string" &&
      value.token &&
      "userId" in value &&
      typeof value.userId === "string" &&
      value.userId
    )
      return { token: value.token, userId: value.userId };
  } catch {
    // Corrupt or unsupported envelopes must not become opaque session tokens.
  }
  return { token: "", userId: "" };
}

/** Restore a session without overwriting a login/clear that happened while reading. */
export async function loadSession() {
  const epoch = session.generation;
  await sessionWrite;
  if (epoch !== session.generation) return session.token;
  const restored = decodeSession(await store.get(SESSION_KEY));
  if (
    epoch === session.generation &&
    (restored.token !== session.token || restored.userId !== session.userId)
  )
    adopt(restored.token, restored.userId);
  return session.token;
}

/** The caller supplies the server-confirmed identity from login/register. */
export async function saveSession(token: string, userId: string) {
  if (!token || !userId) throw new Error("A confirmed account is required.");
  const epoch = adopt(token, userId);
  await persistSession(epoch, encodedSession()).catch(() => {
    throw new SessionStorageError(epoch, "save");
  });
}

/** Bind a restored legacy token only while that authenticated request still owns it. */
export async function setSessionUser(userId: string, expectedToken: string) {
  if (!userId || !expectedToken || session.token !== expectedToken)
    return false;
  if (session.userId) return session.userId === userId;
  const epoch = adopt(expectedToken, userId);
  await persistSession(epoch, encodedSession()).catch(() => {
    throw new SessionStorageError(epoch, "save");
  });
  return session.generation === epoch;
}

/** Clear identity immediately; a late 401 must never clear a newer login. */
export async function clearSession(expectedToken?: string) {
  if (expectedToken !== undefined && session.token !== expectedToken)
    return false;
  const epoch = adopt("", "");
  const removed = persistSession(epoch, null);
  // Keep auxiliary cleanup in the same order as session persistence. Recheck
  // ownership before each effect so an old clear cannot clean a new account.
  const cleanup = sessionWrite.then(async () => {
    for (const remove of [
      () => store.remove(ASSISTANT_CHAT_KEY),
      () => store.remove("orbyn-assistant-view-open"),
      () => saveSlackInstallation(null),
      () => saveTeamsInstallation(null),
    ]) {
      if (session.generation !== epoch) return;
      await remove().catch(() => undefined);
    }
  });
  sessionWrite = cleanup.catch(() => undefined);
  try {
    await removed;
    await cleanup;
  } catch {
    throw new SessionStorageError(epoch, "clear");
  }
  return session.generation === epoch;
}

/** Remember the chat to reattach to after the app restarts. */
export const saveAssistantChat = (id: string | null) =>
  (id
    ? store.set(ASSISTANT_CHAT_KEY, id)
    : store.remove(ASSISTANT_CHAT_KEY)
  ).catch(() => undefined);

/** Unavailable storage must not prevent opening the assistant. */
export const loadAssistantChat = () =>
  store.get(ASSISTANT_CHAT_KEY).catch(() => null);

export const getPushToken = () => store.get(PUSH_KEY);

export const savePushToken = (token: string) => store.set(PUSH_KEY, token);

export const clearPushToken = () => store.remove(PUSH_KEY);

/** Only a pending request UUID; no channel token or authorization code is stored on the device. */
export const loadSlackInstallation = () =>
  store.get("orbyn-slack-installation").catch(() => null);
let slackInstallationWrite: Promise<void> = Promise.resolve();
export const saveSlackInstallation = (id: string | null) => {
  slackInstallationWrite = slackInstallationWrite
    .then(() =>
      id
        ? store.set("orbyn-slack-installation", id)
        : store.remove("orbyn-slack-installation"),
    )
    .catch(() => undefined);
  return slackInstallationWrite;
};

/** Persist only the pending Teams request UUID; private linking commands stay in memory. */
export const loadTeamsInstallation = () =>
  store.get("orbyn-teams-installation").catch(() => null);
let teamsInstallationWrite: Promise<void> = Promise.resolve();
export const saveTeamsInstallation = (id: string | null) => {
  teamsInstallationWrite = teamsInstallationWrite
    .then(() =>
      id
        ? store.set("orbyn-teams-installation", id)
        : store.remove("orbyn-teams-installation"),
    )
    .catch(() => undefined);
  return teamsInstallationWrite;
};
