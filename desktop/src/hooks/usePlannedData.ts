import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { dayBounds, type PlannedFeed, type TodayList } from "@orbyn/core";
import { client } from "../lib/api";
import { onLive } from "../lib/live";
import { deviceTimeZone } from "../lib/planning";
import type { PlannedData } from "../app/planned";

/** How often it looks again while the tab stays open (the day moves on). */
const REFRESH_MS = 5 * 60_000;

/** What changed, leaving out when it was asked (`now` moves every time). */
const stable = (feed: PlannedFeed | null, today: TodayList | null) =>
  JSON.stringify([feed, today && { ...today, now: undefined }]);

/**
 * Loads the planned feed and the Today list for this device's day: after
 * every planner refresh (`revision`), when a session changes on another
 * device ("changed"), when the tab comes back, and every few minutes.
 * Older servers have neither; the apps work without them.
 */
export function usePlannedData(token: string, revision: number): PlannedData {
  const [feed, setFeed] = useState<PlannedFeed | null>(null);
  const [today, setToday] = useState<TodayList | null>(null);
  const [ready, setReady] = useState(false);
  const seq = useRef(0);
  const last = useRef("");
  const kept = useRef<{ feed: PlannedFeed | null; today: TodayList | null }>({
    feed: null,
    today: null,
  });

  const reload = useCallback(async () => {
    if (!token) return;
    const mine = ++seq.current;
    const { from, to } = dayBounds(new Date());
    // A request that fails (a blip, or a server without it) keeps what was
    // shown; one that never answered leaves null.
    const [f, t] = await Promise.all([
      client
        .planned({ from: from.toISOString(), to: to.toISOString() })
        .catch(() => kept.current.feed),
      client.today(deviceTimeZone()).catch(() => kept.current.today),
    ]);
    if (mine !== seq.current) return;
    setReady(true);
    const snapshot = stable(f, t);
    if (snapshot === last.current) return;
    last.current = snapshot;
    kept.current = { feed: f, today: t };
    setFeed(f);
    setToday(t);
  }, [token]);

  useEffect(() => {
    if (!token) {
      seq.current++;
      last.current = "";
      kept.current = { feed: null, today: null };
      setFeed(null);
      setToday(null);
      setReady(false);
      return;
    }
    void reload();
  }, [token, reload, revision]);

  useEffect(() => {
    if (!token) return;
    let pending: ReturnType<typeof setTimeout> | null = null;
    const soon = () => {
      if (pending) clearTimeout(pending);
      pending = setTimeout(() => {
        pending = null;
        if (document.visibilityState === "visible") void reload();
      }, 400);
    };
    const stop = onLive((news) => news.kind === "changed" && soon());
    const every = setInterval(soon, REFRESH_MS);
    const back = () => document.visibilityState === "visible" && soon();
    document.addEventListener("visibilitychange", back);
    return () => {
      stop();
      clearInterval(every);
      document.removeEventListener("visibilitychange", back);
      if (pending) clearTimeout(pending);
    };
  }, [token, reload]);

  return useMemo(
    () => ({
      feed,
      byItem: new Map((feed?.tasks ?? []).map((t) => [t.item_id, t])),
      today,
      ready,
      reload,
    }),
    [feed, today, ready, reload],
  );
}
