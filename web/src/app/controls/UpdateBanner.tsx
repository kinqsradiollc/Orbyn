import { useEffect, useRef, useState } from "react";
import { client, getSessionVersion } from "../../lib/session";
import { Button, ErrorNotice } from "../../ui/kit";

type Permit = { allowed: boolean; current(): boolean };
/** Compare service versions during this mounted build; polling never reloads or closes drafts. */
export function UpdateBanner({
  prepareReload,
}: {
  prepareReload: () => Promise<Permit>;
}) {
  const [available, setAvailable] = useState(false),
    [dismissed, setDismissed] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const built: unknown = import.meta.env.VITE_APP_VERSION;
  const baseline = useRef(typeof built === "string" ? built.trim() : ""),
    mutex = useRef(false),
    alive = useRef(true);
  useEffect(() => {
    const generation = getSessionVersion();
    alive.current = true;
    let active = false;
    const check = async () => {
      if (
        active ||
        !alive.current ||
        generation !== getSessionVersion() ||
        document.visibilityState !== "visible"
      )
        return;
      active = true;
      try {
        const info = await client.getVersion();
        if (!alive.current || generation !== getSessionVersion()) return;
        if (!baseline.current) baseline.current = info.version;
        else if (
          info.version !== "dev" &&
          baseline.current !== "dev" &&
          !info.version.startsWith(baseline.current) &&
          !baseline.current.startsWith(info.version)
        )
          setAvailable(true);
      } catch {
        /* A failed optional version check never implies an update is available. */
      } finally {
        active = false;
      }
    };
    void check();
    const timer = setInterval(() => void check(), 300_000);
    return () => {
      alive.current = false;
      clearInterval(timer);
    };
  }, []);
  const reload = async () => {
    if (mutex.current) return;
    mutex.current = true;
    setBusy(true);
    setError("");
    const generation = getSessionVersion();
    try {
      const permit = await prepareReload();
      if (!alive.current || generation !== getSessionVersion()) return;
      if (!permit.allowed || !permit.current()) {
        setError("Resolve open drafts and dialogs before updating.");
        return;
      }
      location.reload();
    } catch {
      if (alive.current && generation === getSessionVersion())
        setError("Couldn't prepare your open views. They remain open.");
    } finally {
      mutex.current = false;
      if (alive.current && generation === getSessionVersion()) setBusy(false);
    }
  };
  if (!available || dismissed) return null;
  return (
    <div className="shell-update" role="status">
      <span>An update is available.</span>
      <Button busy={busy} onClick={() => void reload()}>
        Reload
      </Button>
      <Button disabled={busy} onClick={() => setDismissed(true)}>
        Later
      </Button>
      {error && <ErrorNotice message={error} />}
    </div>
  );
}
