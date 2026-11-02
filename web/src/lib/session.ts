import { OrbynClient } from "@orbyn/api-client";

/** The same key the old client uses, so a sign-in survives the move. */
const KEY = "orbyn-session";
const listeners = new Set<() => void>();

function read() {
  try {
    return localStorage.getItem(KEY) ?? "";
  } catch {
    return "";
  }
}

let token = read();
let version = 0;

const streamFetch: typeof fetch = (input, init) => {
  const request = input instanceof Request;
  const url = new URL(
    request ? input.url : String(input),
    window.location.href,
  );
  if (/\/(?:events\/docs\/[^/]+|docs\/[^/]+\/live)$/.test(url.pathname)) {
    // This client preserves drafts before closing a trashed editor. Legacy
    // clients retain their existing stream behavior until they opt in too.
    url.searchParams.set("terminal", "preserve-drafts-v1");
    return fetch(request ? new Request(url, input) : url, init);
  }
  return fetch(input, init);
};

export const client = new OrbynClient({
  baseUrl: import.meta.env.VITE_API_URL || "/api",
  getToken: () => token,
  streamFetch,
});

/** Fired after this device changes a notification, so the bell's unread count follows at once. */
export const NOTICES_CHANGED = "orbyn:notices-changed";
const markNoticeRead = client.markNotificationRead.bind(client);
client.markNotificationRead = async (id: string) => {
  const done = await markNoticeRead(id);
  window.dispatchEvent(new Event(NOTICES_CHANGED));
  return done;
};

export const getToken = () => token;
export const getSessionVersion = () => version;

export function setToken(next: string) {
  if (next === token) return;
  version++;
  token = next;
  client.noteExternalMutation();
  try {
    if (next) localStorage.setItem(KEY, next);
    else localStorage.removeItem(KEY);
  } catch {
    // The session lasts for this page without storage.
  }
  listeners.forEach((listener) => listener());
}

export function onToken(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

window.addEventListener("storage", (event) => {
  if (event.key !== KEY || (event.newValue ?? "") === token) return;
  version++;
  token = event.newValue ?? "";
  client.noteExternalMutation();
  listeners.forEach((listener) => listener());
});
