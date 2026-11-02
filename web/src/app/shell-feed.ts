import { useEffect, useState, useRef } from "react";
import type { SavedView, StarredItem } from "@orbyn/core";
import { watchAccount } from "../lib/account-events";
import { client, getSessionVersion } from "../lib/session";
import { messageOf } from "../lib/resource";
type Data = {
  starred: StarredItem[];
  pinned: SavedView[];
  unread: number;
  error: string;
};
const initial: Data = { starred: [], pinned: [], unread: 0, error: "" };
/** One Shell per account: routing never refetches all sidebar facets. */
export function useShellData() {
  const [data, setData] = useState<Data>(initial);
  const retry = useRef<() => void>(() => {});
  useEffect(() => {
    const generation = getSessionVersion();
    let live = true,
      epoch = 0,
      active = false,
      queued = false,
      urgentQueued = false,
      firstConnection = true;
    let timer: ReturnType<typeof setTimeout> | null = null,
      lastStart = 0;
    const current = () => live && generation === getSessionVersion();
    const schedule = (explicit = false) => {
      if (!current()) return;
      queued = true;
      urgentQueued ||= explicit;
      if (active) return;
      if (timer) {
        if (!explicit) return;
        clearTimeout(timer);
        timer = null;
      }
      const delay =
        urgentQueued || !lastStart
          ? 160
          : Math.max(160, 5000 - (Date.now() - lastStart));
      timer = setTimeout(() => {
        timer = null;
        void read();
      }, delay);
    };
    const read = async () => {
      if (!current() || active) return;
      active = true;
      queued = false;
      urgentQueued = false;
      lastStart = Date.now();
      const mine = epoch;
      const [stars, views, notices] = await Promise.allSettled([
        client.listStarred(),
        client.listViews(),
        client.listNotifications(),
      ]);
      if (current() && mine === epoch) {
        const failures = [stars, views, notices].filter(
          (one) => one.status === "rejected",
        );
        setData((old) => ({
          starred: stars.status === "fulfilled" ? stars.value : old.starred,
          pinned:
            views.status === "fulfilled"
              ? views.value.filter((one) => one.pinned)
              : old.pinned,
          unread:
            notices.status === "fulfilled"
              ? notices.value.filter((one) => !one.read).length
              : old.unread,
          error: failures.length
            ? messageOf(
                (failures[0] as PromiseRejectedResult).reason,
                "Couldn't refresh navigation. Your current items remain visible.",
              )
            : "",
        }));
      }
      active = false;
      if (current() && (queued || mine !== epoch)) schedule();
    };
    // Invalidate publication immediately; keep the earliest queued deadline under continuous writes.
    const invalidate = (urgent = false) => {
      epoch++;
      schedule(urgent);
    };
    const stop = watchAccount(
      (news) => {
        if (news.kind === "changed") invalidate();
      },
      () => {
        // The initial stream opens during the first read; catch up without a five-second empty sidebar.
        const initial = firstConnection;
        firstConnection = false;
        invalidate(initial);
      },
    );
    retry.current = () => {
      epoch++;
      schedule(true);
    };
    void read();
    return () => {
      live = false;
      retry.current = () => {};
      stop();
      if (timer) clearTimeout(timer);
    };
  }, []);
  return { ...data, reload: () => retry.current() };
}
