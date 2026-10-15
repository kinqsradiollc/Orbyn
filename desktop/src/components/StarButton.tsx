import { useEffect, useRef, useState } from "react";
import { Star } from "lucide-react";
import { favouriteKey, type FavouriteKind } from "@orbyn/core";
import { session } from "../lib/session";
import { useToast } from "./Toast";
import { client } from "../lib/api";
import { announceStars, STARS_CHANGED } from "../app/prefs";

/** Stars known to this tab, read once and kept in step with changes. */
let cache: { account: string; value: Set<string> } | null = null;
let loading: { account: string; promise: Promise<Set<string>> } | null = null;
let cacheEpoch = 0;
const readStars = () => {
  const account = session.get();
  if (cache?.account === account) return Promise.resolve(cache.value);
  if (loading?.account === account) return loading.promise;
  const epoch = cacheEpoch;
  const promise = client
    .listFavourites()
    .then((all) => {
      const value = new Set(
        all.map((f) => favouriteKey(f.kind, f.target_id, f.block_id ?? "")),
      );
      if (session.get() === account && epoch === cacheEpoch)
        cache = { account, value };
      return value;
    })
    .finally(() => {
      if (loading?.promise === promise) loading = null;
    });
  loading = { account, promise };
  return promise;
};
if (typeof window !== "undefined")
  window.addEventListener(STARS_CHANGED, () => {
    cache = null;
    loading = null;
    cacheEpoch++;
  });

/**
 * A star for a task, a project or a saved view (NAV-07). Starred things are
 * listed in the sidebar's Starred group and first in an empty ⌘K.
 */
export function StarButton({
  kind,
  id,
  name,
  className = "icon-button",
  size = 15,
}: {
  kind: Exclude<FavouriteKind, "heading" | "doc"> | "doc";
  id: string;
  name: string;
  className?: string;
  size?: number;
}) {
  const [on, setOn] = useState(false);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const mutation = useRef(false);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const binding = useRef({ kind, id });
  binding.current = { kind, id };
  const [retry, setRetry] = useState(0);
  const toast = useToast();
  useEffect(() => {
    let live = true;
    let request = 0;
    setReady(false);
    setFailed(false);
    setOn(false);
    const load = () => {
      const epoch = ++request;
      const account = session.get();
      return readStars().then(
        (s) => {
          if (live && epoch === request && session.get() === account) {
            setOn(s.has(favouriteKey(kind, id)));
            setReady(true);
            setFailed(false);
          }
        },
        () => {
          if (live && epoch === request) setFailed(true);
        },
      );
    };
    void load();
    window.addEventListener(STARS_CHANGED, load);
    return () => {
      live = false;
      window.removeEventListener(STARS_CHANGED, load);
    };
  }, [kind, id, retry]);
  return (
    <button
      type="button"
      className={className + (on ? " is-starred" : "")}
      disabled={busy || (!ready && !failed)}
      aria-pressed={ready ? on : undefined}
      aria-label={
        failed
          ? `Retry star status for ${name}`
          : on
            ? `Unstar ${name}`
            : `Star ${name}`
      }
      title={failed ? "Retry star status" : on ? "Unstar" : "Star"}
      onClick={() => {
        if (failed) {
          setRetry((value) => value + 1);
          return;
        }
        if (mutation.current || !ready) return;
        mutation.current = true;
        setBusy(true);
        const next = !on;
        const account = session.get();
        setOn(next);
        client
          .setFavourite(kind, id, next)
          .then(
            () => {
              if (session.get() === account) announceStars();
            },
            () => {
              if (
                session.get() === account &&
                binding.current.kind === kind &&
                binding.current.id === id
              ) {
                setOn(!next);
                toast({ text: "Couldn't save star. Retry.", tone: "warn" });
              }
            },
          )
          .finally(() => {
            mutation.current = false;
            if (mounted.current) setBusy(false);
          });
      }}
    >
      <Star size={size} fill={on ? "currentColor" : "none"} />
    </button>
  );
}
