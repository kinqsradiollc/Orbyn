import { useEffect, useRef } from "react";
import { client } from "../lib/api";
import { deviceId, deviceLabel, devicePlatform } from "../lib/device";
import { currentDoc, emitLive, onOpenDoc } from "../lib/live";

/** A check-in about once a minute keeps this device "online". */
const BEAT_MS = 60_000;

/**
 * While signed in: tell the server this device is here (and which page is
 * open), and follow its news. "changed" refreshes the planner — a change made
 * on the phone shows here without waiting for the next poll.
 */
export function usePresence(token: string, onChanged: () => void) {
  const changed = useRef(onChanged);
  changed.current = onChanged;

  useEffect(() => {
    if (!token) return;
    let alive = true;
    const beat = () => {
      if (!alive) return;
      void client
        .heartbeat({
          device_id: deviceId(),
          platform: devicePlatform(),
          label: deviceLabel(),
          active: document.visibilityState === "visible",
          doc_id: currentDoc(),
          synced_at: new Date().toISOString(),
        })
        .catch(() => {});
    };
    beat();
    const id = setInterval(beat, BEAT_MS);
    document.addEventListener("visibilitychange", beat);
    const stopDoc = onOpenDoc(beat);

    // Many changes can land together (a plan applied): refresh once.
    let pending: ReturnType<typeof setTimeout> | null = null;
    let connected = false;
    const stop = client.watchEvents(
      (news) => {
        emitLive(news);
        if (news.kind !== "changed") return;
        if (pending) clearTimeout(pending);
        pending = setTimeout(() => {
          pending = null;
          if (document.visibilityState === "visible") changed.current();
        }, 400);
      },
      // Back after a gap: catch up on whatever was missed.
      () => {
        emitLive({ kind: "presence" });
        // Initial data already loads on sign-in; only reconnects need catch-up.
        if (connected) {
          emitLive({ kind: "changed" });
          if (pending) clearTimeout(pending);
          pending = setTimeout(() => {
            pending = null;
            changed.current();
          }, 400);
        }
        connected = true;
      },
    );
    return () => {
      alive = false;
      clearInterval(id);
      document.removeEventListener("visibilitychange", beat);
      stopDoc();
      stop();
      if (pending) clearTimeout(pending);
    };
  }, [token]);
}
