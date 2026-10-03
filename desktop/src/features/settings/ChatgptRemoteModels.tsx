import { useId, useState } from "react";
import { Select } from "../../components/Select";
import { useChatgptRemote } from "../../hooks/useChatgptRemote";

/** Manage a verified catalog from an owned device without transferring its credentials. */
export function ChatgptRemoteModels({ userId }: { userId: string }) {
  const { state, refresh, select, save } = useChatgptRemote(userId);
  const id = useId();
  const [query, setQuery] = useState("");
  const [connecting, setConnecting] = useState(false);
  const busy = state.status === "loading" || state.saving;
  const catalog = state.catalog;
  const models = catalog?.models ?? [];
  const filtered = models.filter((m) =>
    `${m.display_name} ${m.slug}`
      .toLowerCase()
      .includes(query.trim().toLowerCase()),
  );
  const available = state.status === "ready" && catalog?.status === "ready";
  const missing =
    catalog?.preference.model &&
    !models.some((m) => m.slug === catalog.preference.model);
  return (
    <div className="ai-model-settings">
      <div className="settings-head">
        <div>
          <h3>ChatGPT</h3>
          <p className="muted">
            Add an account on your computer, then choose its default model here.
          </p>
        </div>
        <div className="ai-connection-actions">
          <button
            type="button"
            className="primary"
            onClick={() => setConnecting(!connecting)}
            aria-expanded={connecting}
            aria-controls={`${id}-connect`}
          >
            Connect on desktop
          </button>
          <button
            type="button"
            className="secondary"
            disabled={busy || !userId}
            onClick={refresh}
          >
            Refresh
          </button>
        </div>
      </div>
      {connecting && (
        <div
          id={`${id}-connect`}
          className="settings-subform"
          role="region"
          aria-label="Connect a ChatGPT account"
        >
          <ol>
            <li>Open Orbyn desktop and sign in to this Orbyn account.</li>
            <li>Go to Settings → Account → AI connections &amp; models.</li>
            <li>Choose Connect ChatGPT and finish the sign-in there.</li>
          </ol>
          <a className="secondary" href="orbyn://assistant">
            Open Orbyn desktop
          </a>
          <p className="muted">
            The desktop app must be installed. Direct sign-in on web is not
            available yet.
          </p>
        </div>
      )}
      {state.status === "loading" && (
        <p role="status">Loading ChatGPT devices and models…</p>
      )}
      {state.error && <p role="alert">{state.error}</p>}
      {state.status === "ready" && !state.devices.length && (
        <p>No ChatGPT accounts connected yet.</p>
      )}
      {!!state.devices.length && (
        <label className="settings-field" htmlFor={`${id}-device`}>
          Connected device
          <Select
            id={`${id}-device`}
            disabled={busy}
            value={state.selection?.executor_id ?? ""}
            onChange={(e) => {
              const device = state.devices.find(
                (d) => d.executor_id === e.target.value,
              );
              if (device) {
                setQuery("");
                select({
                  connection_id: device.connection_id,
                  executor_id: device.executor_id,
                });
              }
            }}
          >
            <option value="" disabled>
              Choose a device
            </option>
            {state.devices.map((d, i) => (
              <option key={d.executor_id} value={d.executor_id}>
                Device {i + 1} · {d.host_id.slice(0, 8)}
              </option>
            ))}
          </Select>
        </label>
      )}
      {catalog && (
        <>
          <p role="status">
            {catalog.status === "ready"
              ? `${models.length} models available.`
              : catalog.status === "offline"
                ? "This device is offline. Reconnect it before choosing a model."
                : catalog.status === "stale"
                  ? "This device’s catalog needs refreshing from its desktop app."
                  : "This device has not published a model catalog."}
          </p>
          <label className="settings-field" htmlFor={`${id}-search`}>
            Find a model
            <input
              id={`${id}-search`}
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search name or model ID"
            />
          </label>
          <label className="settings-field" htmlFor={`${id}-model`}>
            Default model
            <Select
              id={`${id}-model`}
              value={catalog.preference.model ?? ""}
              disabled={busy || !available}
              onChange={(e) => save(e.target.value || null)}
            >
              <option value="">No default selected</option>
              {missing && (
                <option value={catalog.preference.model!} disabled>
                  {catalog.preference.model} · unavailable
                </option>
              )}
              {!missing &&
                catalog.preference.model &&
                !filtered.some((m) => m.slug === catalog.preference.model) && (
                  <option value={catalog.preference.model}>
                    {models.find((m) => m.slug === catalog.preference.model)
                      ?.display_name ?? catalog.preference.model}{" "}
                    · current default
                  </option>
                )}
              {filtered.map((m) => (
                <option key={m.slug} value={m.slug}>
                  {m.display_name} · {m.slug}
                </option>
              ))}
            </Select>
          </label>
          {!filtered.length && (
            <p className="muted">No models match your search.</p>
          )}
          {state.saving && <p role="status">Saving default model…</p>}
          {catalog.published_at && (
            <p className="muted">
              Catalog updated {new Date(catalog.published_at).toLocaleString()}.
            </p>
          )}
        </>
      )}
    </div>
  );
}
