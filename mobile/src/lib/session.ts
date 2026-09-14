import * as SecureStore from "expo-secure-store";

const SESSION_KEY = "orbyn-session";
const PUSH_KEY = "orbyn-push";

/** In-memory copy of the session token so API calls never wait on SecureStore. */
export const session: { token: string } = { token: "" };

/** Restore the token from SecureStore into memory. Resolves with "" when signed out. */
export async function loadSession() {
  const token = (await SecureStore.getItemAsync(SESSION_KEY)) || "";
  session.token = token;
  return token;
}

export async function saveSession(token: string) {
  await SecureStore.setItemAsync(SESSION_KEY, token);
  session.token = token;
}

export async function clearSession() {
  await SecureStore.deleteItemAsync(SESSION_KEY);
  session.token = "";
}

export const getPushToken = () => SecureStore.getItemAsync(PUSH_KEY);

export const savePushToken = (token: string) =>
  SecureStore.setItemAsync(PUSH_KEY, token);

export const clearPushToken = () => SecureStore.deleteItemAsync(PUSH_KEY);
