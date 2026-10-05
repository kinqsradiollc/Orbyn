import { AiProviderChoiceControls } from "./AiProviderChoice";
import { ChatgptUsage } from "./ChatgptUsage";
import { useEffect, useId, useRef, useState } from "react";
import { client } from "../../lib/api";
import { session } from "../../lib/session";
import { errorText } from "../../lib/errors";
import { CHATGPT_USAGE_URL } from "@orbyn/core";
import { Select } from "../../components/Select";
import { useChatgptRemote } from "../../hooks/useChatgptRemote";

/** Manage a verified catalog from an owned device without transferring its credentials. */
export function ChatgptRemoteModels({ userId }: { userId: string }) {
  const { state, refresh, select, save } = useChatgptRemote(userId);
  const id = useId();
  const [query, setQuery] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const lifetime = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      lifetime.current?.abort();
    },
    [userId],
  );
  const connect = async () => {
    const controller = new AbortController();
    lifetime.current?.abort();
    lifetime.current = controller;
    const token = session.get();
    setConnecting(true);
    setConnectError(null);
    try {
      const request = await client.startChatgptConnectRequest(
        controller.signal,
      );
      if (controller.signal.aborted || token !== session.get()) return;
      window.location.href = request.launch_url;
      while (
        !controller.signal.aborted &&
        Date.now() < Date.parse(request.expires_at)
      ) {
        await new Promise<void>((resolve) => {
          const cancel = () => {
            clearTimeout(timer);
            resolve();
          };
          const timer = setTimeout(() => {
            controller.signal.removeEventListener("abort", cancel);
            resolve();
          }, 3000);
          controller.signal.addEventListener("abort", cancel, { once: true });
          if (controller.signal.aborted) cancel();
        });
        if (controller.signal.aborted || token !== session.get()) return;
        const next = await client.chatgptConnectRequest(
          request.id,
          controller.signal,
        );
        if (controller.signal.aborted || token !== session.get()) return;
        if (next.state === "completed") {
          refresh();
          return;
        }
        if (next.state === "failed" || next.state === "expired")
          throw new Error(
            "ChatGPT sign-in did not finish. Try connecting again.",
          );
      }
      if (!controller.signal.aborted)
        throw new Error("ChatGPT sign-in expired. Try connecting again.");
    } catch (error) {
      if (!controller.signal.aborted && token === session.get())
        setConnectError(errorText(error));
    } finally {
      if (lifetime.current === controller) setConnecting(false);
    }
  };
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
      <AiProviderChoiceControls
        userId={userId}
        selection={
          state.selection
            ? {
                connection_id: state.selection.connection_id,
                executor_id: state.selection.executor_id,
              }
            : null
        }
      />
      <ChatgptUsage userId={userId} />
      <div className="settings-head">
        <div>
          <h3>ChatGPT</h3>
          <p className="muted">
            Connect your ChatGPT account and choose its default model.
          </p>
        </div>
        <div className="ai-connection-actions">
          <button
            type="button"
            className="primary"
            disabled={connecting || !userId}
            onClick={() => void connect()}
          >
            {connecting ? "Waiting for ChatGPT…" : "Connect to ChatGPT"}
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
        <p role="status">
          Finish ChatGPT sign-in and consent in the browser opened by your Orbyn
          runtime.
        </p>
      )}
      {connectError && <p role="alert">{connectError}</p>}
      <a
        className="text-button"
        href={CHATGPT_USAGE_URL}
        target="_blank"
        rel="noopener noreferrer"
      >
        Manage ChatGPT usage
      </a>
      <small className="field-hint">
        Choose the same ChatGPT account to view its current allowance and app
        limits.
      </small>
      {state.status === "loading" && (
        <p role="status">Loading ChatGPT devices and models…</p>
      )}
      {state.error && <p role="alert">{state.error}</p>}
      {state.status === "ready" && !state.devices.length && (
        <p>No ChatGPT model catalog is available yet.</p>
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
