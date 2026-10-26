const KEY = "orbyn-session";
let current: string | undefined;
let generation = 0;
let memoryOnly = false;
const adopt = (token: string) => {
  if (current !== token) {
    current = token;
    generation++;
  }
  return token;
};

/**
 * The auth token, kept in localStorage so a sign-in survives closing the tab,
 * restarting the browser and opening the app in another tab. Signing out in one
 * tab signs every tab out (see `onSessionChange`).
 */
export const session = {
  get: () => {
    if (memoryOnly) return current ?? "";
    try {
      const saved = localStorage.getItem(KEY);
      if (saved) return adopt(saved);
      // Carry over a sign-in from when the token lived in sessionStorage.
      const legacy = sessionStorage.getItem(KEY);
      if (legacy) {
        localStorage.setItem(KEY, legacy);
        sessionStorage.removeItem(KEY);
      }
      return adopt(legacy || "");
    } catch {
      return current ?? "";
    }
  },
  binding: () => {
    const token = session.get();
    return { token, generation };
  },
  set: (token: string) => {
    adopt(token);
    try {
      localStorage.setItem(KEY, token);
      memoryOnly = false;
    } catch {
      // Storage blocked: retain this tab's authoritative live session.
      memoryOnly = true;
    }
  },
  clear: () => {
    adopt("");
    try {
      localStorage.removeItem(KEY);
      sessionStorage.removeItem(KEY);
      sessionStorage.removeItem("orbyn-slack-installation");
      memoryOnly = false;
    } catch {
      // Never reactivate the old credential after a failed local removal.
      memoryOnly = true;
    }
  },
};

/** Call `listener` with the new token when another tab signs in or out. */
export function onSessionChange(listener: (token: string) => void) {
  const handle = (e: StorageEvent) => {
    if (e.key === KEY || e.key === null) {
      memoryOnly = false;
      listener(adopt(e.newValue ?? ""));
    }
  };
  window.addEventListener("storage", handle);
  return () => window.removeEventListener("storage", handle);
}
