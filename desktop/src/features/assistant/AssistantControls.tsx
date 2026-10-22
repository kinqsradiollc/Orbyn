import { useEffect, useMemo, useSyncExternalStore } from "react";
import { AssistantControlsStore } from "@orbyn/api-client";
import { client } from "../../lib/api";
import { session } from "../../lib/session";

export function AssistantControls({
  deliveryEnabled,
}: {
  deliveryEnabled: boolean;
}) {
  const store = useMemo(
    () => new AssistantControlsStore(client, session.get, deliveryEnabled),
    [deliveryEnabled],
  );
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  useEffect(() => {
    void store.refresh();
    return () => store.reset();
  }, [store]);
  return (
    <details className="ai-controls">
      <summary>Assistant controls</summary>
      {state.error ? (
        <p role="alert">
          Couldn't load controls.{" "}
          <button
            type="button"
            className="text-button"
            onClick={() => void store.refresh()}
          >
            Retry
          </button>
        </p>
      ) : !state.data ? (
        <p role="status">Loading controls…</p>
      ) : (
        <>
          {(
            [
              ["muted", "Mute update alerts"],
              ["background_paused", "Pause new Background work"],
              ["overnight_paused", "Pause new Overnight work"],
            ] as const
          )
            .filter(([key]) => key !== "muted" || deliveryEnabled)
            .map(([key, label]) => (
              <label className="ai-control-row" key={key}>
                <span>{label}</span>
                <input
                  type="checkbox"
                  checked={state.data![key]}
                  disabled={state.busy}
                  onChange={(event) =>
                    void store.set(key, event.target.checked)
                  }
                />
              </label>
            ))}
          <p className="muted">
            Admitted work continues. Stop individual jobs in Activity.
          </p>
        </>
      )}
    </details>
  );
}
