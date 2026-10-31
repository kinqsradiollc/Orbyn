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

export const client = new OrbynClient({
  baseUrl: import.meta.env.VITE_API_URL || "/api",
  getToken: () => token,
});

export const getToken = () => token;

export function setToken(next: string) {
  token = next;
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
  if (event.key !== KEY) return;
  token = event.newValue ?? "";
  listeners.forEach((listener) => listener());
});
