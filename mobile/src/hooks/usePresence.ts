import { useEffect, useRef } from "react";
import { AppState } from "react-native";
import { client } from "../lib/api";
import { deviceId, deviceLabel, devicePlatform } from "../lib/device";
import { currentDoc, emitLive, onOpenDoc } from "../lib/live";
import { outboxState, subscribeOutbox } from "../lib/outbox";

const BEAT_MS = 60_000;

/**
 * While signed in: tell the server this phone is here — which page is open,
 * and how many changes it's still holding — and follow the server's news.
 * "changed" refreshes the lists, so an edit made on the laptop shows here
 * without waiting for the next check.
 */
export function usePresence(token: string, onChanged: () => void) {
  const changed = useRef(onChanged);
  changed.current = onChanged;

  useEffect(() => {
    if (!token) return;
    let alive = true;
    let last = "";
    const beat = (force = false) => {
      if (!alive) return;
      const box = outboxState();
      const body = {
        device_id: deviceId(),
        platform: devicePlatform(),
        label: deviceLabel(),
        active: AppState.currentState === "active",
        doc_id: currentDoc(),
        pending_changes: box.entries.filter((e) => e.state === "pending")
          .length,
        failed_changes: box.entries.filter((e) => e.state === "failed").length,
        synced_at: box.syncedAt,
      };
      // Between beats, only a change worth telling goes out.
      const now = JSON.stringify({ ...body, synced_at: null });
      if (!force && now === last) return;
      last = now;
      void client.heartbeat(body).catch(() => {
        last = "";
      });
    };
    beat(true);
    const id = setInterval(() => beat(true), BEAT_MS);
    const app = AppState.addEventListener("change", () => beat());
    const stopDoc = onOpenDoc(() => beat());
    const stopBox = subscribeOutbox(() => beat());

    let pending: ReturnType<typeof setTimeout> | null = null;
    const stop = client.watchEvents(
      (news) => {
        emitLive(news);
        if (news.kind !== "changed") return;
        if (pending) clearTimeout(pending);
        pending = setTimeout(() => {
          pending = null;
          if (AppState.currentState === "active") changed.current();
        }, 400);
      },
      () => emitLive({ kind: "presence" }),
    );
    return () => {
      alive = false;
      clearInterval(id);
      app.remove();
      stopDoc();
      stopBox();
      stop();
      if (pending) clearTimeout(pending);
    };
  }, [token]);
}
