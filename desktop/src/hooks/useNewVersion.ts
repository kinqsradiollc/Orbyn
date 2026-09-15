import { useEffect, useState } from "react";
import { client } from "../lib/api";

/** This build's version, baked in at Docker build time (undefined locally). */
const BUILT = import.meta.env.VITE_APP_VERSION?.trim() || "";
const CHECK_MS = 5 * 60_000;

/** Versions can be short or full commits, so a prefix match counts as the same. */
const differs = (a: string, b: string) => !a.startsWith(b) && !b.startsWith(a);

/**
 * Whether the server runs a newer build than this page. Checks on load and
 * every few minutes while the tab is visible, silently; stops once it finds one.
 */
export function useNewVersion() {
  const [available, setAvailable] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!BUILT || BUILT === "dev") return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const check = async () => {
      try {
        if (document.visibilityState === "visible") {
          const { version } = await client.getVersion();
          const running = version?.trim();
          if (
            alive &&
            running &&
            running !== "dev" &&
            differs(running, BUILT)
          ) {
            setAvailable(true);
            return;
          }
        }
      } catch {
        // Silent: the next check tries again.
      }
      if (alive) timer = setTimeout(check, CHECK_MS);
    };
    void check();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, []);

  return {
    available: available && !dismissed,
    dismiss: () => setDismissed(true),
  };
}
