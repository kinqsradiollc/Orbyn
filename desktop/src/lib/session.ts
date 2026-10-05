const KEY = "orbyn-session";

/**
 * The auth token, kept in localStorage so a sign-in survives closing the tab,
 * restarting the browser and opening the app in another tab. Signing out in one
 * tab signs every tab out (see `onSessionChange`).
 */
export const session = {
  get: () => {
    try {
      const saved = localStorage.getItem(KEY);
      if (saved) return saved;
      // Carry over a sign-in from when the token lived in sessionStorage.
      const legacy = sessionStorage.getItem(KEY);
      if (legacy) {
        localStorage.setItem(KEY, legacy);
        sessionStorage.removeItem(KEY);
      }
      return legacy || "";
    } catch {
      return "";
    }
  },
  set: (token: string) => {
    try {
      localStorage.setItem(KEY, token);
    } catch {
      // Storage blocked: the token still works until this tab closes.
    }
  },
  clear: () => {
    try {
      localStorage.removeItem(KEY);
      sessionStorage.removeItem(KEY);
      sessionStorage.removeItem("orbyn-slack-installation");
    } catch {
      // Nothing stored to clear.
    }
  },
};

/** Call `listener` with the new token when another tab signs in or out. */
export function onSessionChange(listener: (token: string) => void) {
  const handle = (e: StorageEvent) => {
    if (e.key === KEY || e.key === null) listener(e.newValue ?? "");
  };
  window.addEventListener("storage", handle);
  return () => window.removeEventListener("storage", handle);
}
