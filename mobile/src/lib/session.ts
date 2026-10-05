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

/** Browser storage can be unavailable or full; neither should sign someone out. */
function safeRead(key: string): string | null {
  try {
    return globalThis.localStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}
function safeWrite(key: string, value: string | null): void {
  try {
    if (value === null) globalThis.localStorage?.removeItem(key);
    else globalThis.localStorage?.setItem(key, value);
  } catch {
    // Nothing to do; the in-memory token still works for this session.
  }
}

/** In-memory copy of the session token so API calls never wait on storage. */
export const session: { token: string } = { token: "" };

/** Restore the token into memory. Resolves with "" when signed out. */
export async function loadSession() {
  const token = (await store.get(SESSION_KEY)) || "";
  session.token = token;
  return token;
}

export async function saveSession(token: string) {
  await store.set(SESSION_KEY, token);
  session.token = token;
}

export async function clearSession() {
  await store.remove(SESSION_KEY);
  await store.remove(ASSISTANT_CHAT_KEY).catch(() => undefined);
  await store.remove("orbyn-assistant-view-open").catch(() => undefined);
  await saveSlackInstallation(null);
  session.token = "";
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
