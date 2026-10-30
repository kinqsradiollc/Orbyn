import { useEffect, useMemo, useSyncExternalStore } from "react";
import { AssistantControlsStore } from "@orbyn/api-client";
import { client } from "../../lib/api";
import { onSessionChange, session } from "../../lib/session";

const binding = () => {
  const value = session.binding();
  return `${value.generation}:${value.token}`;
};

/** Admission pause is independent of cancellation and notification preferences. */
export function LaneWorkControls({
  lane,
}: {
  lane: "background" | "overnight";
}) {
  const owner = useSyncExternalStore(onSessionChange, binding);
  const store = useMemo(
    () => new AssistantControlsStore(client, binding, false),
    [owner],
  );
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  useEffect(() => {
    void store.refresh();
    return () => store.reset();
  }, [store]);
  const key = lane === "background" ? "background_paused" : "overnight_paused";
  const name = lane === "background" ? "Background" : "Overnight";
  return (
    <div className="lane-work-controls">
      {state.error ? (
        <p role="alert">
          Couldn’t load work controls.{" "}
          <button className="text-button" onClick={() => void store.refresh()}>
            Retry controls
          </button>
        </p>
      ) : !state.data ? (
        <p role="status">Loading work controls…</p>
      ) : (
        <>
          <label>
            <input
              type="checkbox"
              checked={state.data[key]}
              disabled={state.busy}
              onChange={(event) => {
                if (binding() === owner)
                  void store.set(key, event.target.checked);
              }}
            />
            Pause new {name} work
          </label>
          <p className="muted">
            Running work continues. Stop a run separately.
          </p>
        </>
      )}
    </div>
  );
}
