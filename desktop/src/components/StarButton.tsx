import { useEffect, useState } from "react";
import { Star } from "lucide-react";
import { favouriteKey, type FavouriteKind } from "@orbyn/core";
import { client } from "../lib/api";
import { announceStars, STARS_CHANGED } from "../app/prefs";

/** Stars known to this tab, read once and kept in step with changes. */
let known: Set<string> | null = null;
let loading: Promise<Set<string>> | null = null;
const readStars = () => {
  if (known) return Promise.resolve(known);
  loading ??= client
    .listFavourites()
    .then((all) => {
      known = new Set(
        all.map((f) => favouriteKey(f.kind, f.target_id, f.block_id ?? "")),
      );
      return known;
    })
    .finally(() => {
      loading = null;
    });
  return loading;
};
if (typeof window !== "undefined")
  window.addEventListener(STARS_CHANGED, () => {
    known = null;
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
  useEffect(() => {
    let live = true;
    const load = () =>
      readStars().then(
        (s) => live && setOn(s.has(favouriteKey(kind, id))),
        () => {},
      );
    void load();
    window.addEventListener(STARS_CHANGED, load);
    return () => {
      live = false;
      window.removeEventListener(STARS_CHANGED, load);
    };
  }, [kind, id]);
  return (
    <button
      type="button"
      className={className + (on ? " is-starred" : "")}
      aria-pressed={on}
      aria-label={on ? `Unstar ${name}` : `Star ${name}`}
      title={on ? "Unstar" : "Star"}
      onClick={() => {
        const next = !on;
        setOn(next);
        client
          .setFavourite(kind, id, next)
          .then(announceStars, () => setOn(!next));
      }}
    >
      <Star size={size} fill={on ? "currentColor" : "none"} />
    </button>
  );
}
