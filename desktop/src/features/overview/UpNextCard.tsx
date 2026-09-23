import { useEffect, useRef, useState } from "react";
import { Compass, Play } from "lucide-react";
import type { Item, UpNext } from "@orbyn/core";
import { client } from "../../lib/api";
import "./upnext.css";

/** How often "Up next" looks again while the Overview stays open. */
const REFRESH_MS = 5 * 60_000;

const minutesText = (m: number) => {
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return h ? (rest ? `${h} h ${rest} min` : `${h} h`) : `${m} min`;
};

const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

/** The free time from now, in words. */
function windowText(next: UpNext) {
  const w = next.window;
  if (!w) return "No free time right now";
  return w.until
    ? `${minutesText(w.minutes)} free before ${w.until}`
    : `${minutesText(w.minutes)} free until ${clock(w.end_at)}`;
}

/**
 * What to do now: the task most worth starting in the free time before the
 * next event, with the planner's reasons, and two alternatives. It learns
 * from the person's own history (see GET /planner/next).
 */
export function UpNextCard({
  items,
  onOpen,
  onFocus,
}: {
  items: Item[];
  onOpen: (item: Item) => void;
  onFocus: (item: Item) => void;
}) {
  const [next, setNext] = useState<UpNext | null>(null);
  const [failed, setFailed] = useState(false);
  const fetched = useRef(0);

  // Again when tasks change (at most every 15 seconds) and every few minutes.
  useEffect(() => {
    let alive = true;
    const load = () => {
      fetched.current = Date.now();
      client.getUpNext().then(
        (n) => {
          if (!alive) return;
          setNext(n);
          setFailed(false);
        },
        () => alive && setFailed(true),
      );
    };
    const wait = Math.max(0, 15_000 - (Date.now() - fetched.current));
    const soon = setTimeout(load, fetched.current ? wait : 0);
    const every = setInterval(load, REFRESH_MS);
    return () => {
      alive = false;
      clearTimeout(soon);
      clearInterval(every);
    };
  }, [items]);

  // Older servers have no suggestions; the Overview works without them.
  if (failed && !next) return null;

  const byId = new Map(items.map((i) => [i.id, i]));
  const shown = (next?.suggestions ?? []).filter((s) => byId.has(s.item_id));
  const [first, ...rest] = shown;
  const firstItem = first && byId.get(first.item_id)!;

  return (
    <section
      className="card overview-section up-next"
      aria-labelledby="overview-up-next"
    >
      <div className="section-heading">
        <div>
          <h2 id="overview-up-next">
            <Compass size={17} aria-hidden="true" className="heading-icon" />
            Up next
          </h2>
          <p className="section-hint">
            {next ? windowText(next) : "Finding your next step…"}
          </p>
        </div>
      </div>
      {first && firstItem && (
        <div className="up-next-main">
          <button
            type="button"
            className="up-next-title"
            onClick={() => onOpen(firstItem)}
          >
            {first.title}
          </button>
          <ul className="up-next-reasons">
            {first.reasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
          <div className="up-next-actions">
            <button
              type="button"
              className="primary"
              onClick={() => onFocus(firstItem)}
            >
              <Play size={14} aria-hidden="true" />
              Start focus
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() => onOpen(firstItem)}
            >
              Open
            </button>
            <small className="up-next-session">
              {first.planned_now
                ? `${first.minutes} min left of its time`
                : `About ${first.minutes} min is a good start`}
            </small>
          </div>
        </div>
      )}
      {rest.length > 0 && (
        <ul className="up-next-more" aria-label="Also worth doing">
          {rest.map((s) => (
            <li key={s.item_id}>
              <button
                type="button"
                onClick={() => onOpen(byId.get(s.item_id)!)}
              >
                <strong>{s.title}</strong>
                <small>{s.reasons[0]}</small>
              </button>
            </li>
          ))}
        </ul>
      )}
      {next && !first && (
        <p className="section-empty">
          Nothing is waiting on you right now. Enjoy the space, or plan
          something new.
        </p>
      )}
    </section>
  );
}
