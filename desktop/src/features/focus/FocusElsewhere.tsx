import { useCallback, useEffect, useState } from "react";
import { Timer, X } from "lucide-react";
import {
  focusRemaining,
  focusRhythm,
  focusPhaseLabel,
  type FocusCurrent,
  type Item,
} from "@orbyn/core";
import { client } from "../../lib/api";
import { deviceId } from "../../lib/device";
import { onLive } from "../../lib/live";

const clock = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/**
 * A focus session that is running while focus mode is closed: what, where,
 * and how long is left. On another device, "Continue here" picks it up; on
 * this one, "Back to focus" returns to it — leaving focus mode never strands
 * a session with no way back in.
 */
export function FocusElsewhere({
  items,
  hidden,
  onOpen,
}: {
  items: Item[];
  /** Focus mode is already open here. */
  hidden: boolean;
  onOpen: (item: Item) => void;
}) {
  const [current, setCurrent] = useState<FocusCurrent | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const load = useCallback(() => {
    client.currentFocus().then(setCurrent, () => setCurrent(null));
  }, []);
  useEffect(() => {
    load();
    return onLive((news) => {
      if (news.kind === "focus") load();
    });
  }, [load]);
  // Leaving focus mode may have paused, finished or kept the session.
  useEffect(() => {
    if (!hidden) load();
  }, [hidden, load]);
  const running = !!current?.state.ends_at;
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [running]);

  if (!current || hidden) return null;
  const here = current.device_id === deviceId();
  const rhythm = focusRhythm(current.state.rhythm);
  const left = focusRemaining(current.state, now);
  const item = items.find((i) => i.id === current.state.item_id);
  const what = rhythm?.work ? focusPhaseLabel(rhythm, current.state) : "Focus";
  return (
    <div className="app-banner is-focus" role="status">
      <Timer size={15} aria-hidden="true" />
      <p>
        <strong>
          {here ? what : `${what} on ${current.device ?? "another device"}`}
        </strong>
        {current.state.item_title && <span> · {current.state.item_title}</span>}
        <span> · {running ? `${clock(left)} left` : "paused"}</span>
      </p>
      {item && (
        <button className="secondary" onClick={() => onOpen(item)}>
          {here ? "Back to focus" : "Continue here"}
        </button>
      )}
      <button
        className="icon-button"
        aria-label="Hide for now"
        onClick={() => setCurrent(null)}
      >
        <X size={15} />
      </button>
    </div>
  );
}
