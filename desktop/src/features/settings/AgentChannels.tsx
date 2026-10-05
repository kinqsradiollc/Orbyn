import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Unplug } from "lucide-react";
import { SlackChannelStore } from "@orbyn/api-client";
import { client } from "../../lib/api";
import { session, onSessionChange } from "../../lib/session";
import { SettingsSection } from "./SettingsSection";
import "./agent-channels.css";
import { TeamsChannelSettings } from "./TeamsChannel";
const KEY = "orbyn-slack-installation";
function remember(id: string | null) {
  try {
    if (id) sessionStorage.setItem(KEY, id);
    else sessionStorage.removeItem(KEY);
  } catch {
    /* Review still works without browser storage. */
  }
}
/** Agent DM connections are separate from inference providers and MCP access. */
export function AgentChannels() {
  const [token, setToken] = useState(session.get);
  useEffect(() => onSessionChange(setToken), []);
  const store = useMemo(
    () => new SlackChannelStore(client, session.get, remember),
    [token],
  );
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const [dm, setDm] = useState(false);
  useEffect(() => {
    let saved: string | null = null;
    try {
      saved = sessionStorage.getItem(KEY);
    } catch {
      /* Optional storage. */
    }
    void store.restore(saved);
    return store.dispose;
  }, [store]);
  const pending = state.installation;
  useEffect(() => {
    setDm(false);
  }, [pending?.id]);
  useEffect(() => {
    if (
      !pending ||
      !["pending", "exchanging"].includes(pending.state) ||
      state.busy ||
      Date.parse(pending.expires_at) <= Date.now()
    )
      return;
    const timer = setTimeout(() => void store.refresh(), 10_000);
    return () => clearTimeout(timer);
  }, [store, pending, state.busy]);
  const connection = state.status?.connection;
  const connected = connection && !connection.disconnected;
  const start = () => {
    const popup = window.open("about:blank", "_blank");
    if (popup) popup.opener = null;
    void store
      .start((url) => {
        if (popup) popup.location.replace(url);
      })
      .then(() => {
        if (popup && !store.getSnapshot().authorizationUrl) popup.close();
      });
  };
  return (
    <SettingsSection className="card settings-card">
      <h2>Agent channels</h2>
      <div className="agent-channel-body">
        <div className="agent-channel-row">
          <strong>Slack</strong>
          <span className="muted">
            {connected ? connection.workspace_name : "Not connected"}
          </span>
          {connected && (
            <button
              type="button"
              className="icon-button secondary"
              aria-label="Disconnect Slack"
              title="Disconnect Slack"
              disabled={state.busy}
              onClick={() => void store.disconnect()}
            >
              <Unplug size={16} aria-hidden="true" />
            </button>
          )}
        </div>
        <p className="muted">
          Background updates and one Overnight morning notice. Decisions open in
          Orbyn.
        </p>
        {!state.status && !state.error && (
          <p role="status">Loading connection…</p>
        )}
        {state.status && !state.status.configured && (
          <p className="muted">
            Slack connection setup is unavailable. Existing permissions can
            still be turned off.
          </p>
        )}
        {connected && (
          <>
            <dl className="agent-channel-identity">
              <dt>Slack account</dt>
              <dd>{connection.external_user_id}</dd>
              <dt>Workspace</dt>
              <dd>{connection.workspace_id}</dd>
              <dt>Token</dt>
              <dd>
                {connection.token_state === "unknown" ||
                connection.token_state === "reconnect"
                  ? "Reconnect required"
                  : connection.token_state === "refreshing"
                    ? "Refreshing token…"
                    : connection.token_expires_at
                      ? `Expires ${new Date(connection.token_expires_at).toLocaleString()}`
                      : "No expiry reported"}
              </dd>
            </dl>
            <label className="check-line">
              <input
                type="checkbox"
                role="switch"
                className="ai-switch"
                checked={connection.dm_enabled}
                disabled={
                  state.busy ||
                  (!state.status?.configured && !connection.dm_enabled) ||
                  (connection.token_state !== "ready" && !connection.dm_enabled)
                }
                onChange={(e) => void store.permission(e.target.checked)}
              />
              Send agent DMs to me
            </label>
          </>
        )}
        {pending?.state === "ready" && pending.identity && (
          <section
            className="agent-channel-review"
            aria-label="Review Slack connection"
          >
            <strong>Review connection</strong>
            <dl className="agent-channel-identity">
              <dt>Workspace</dt>
              <dd>
                {pending.identity.workspace_name} ·{" "}
                {pending.identity.workspace_id}
              </dd>
              <dt>Slack account</dt>
              <dd>{pending.identity.external_user_id}</dd>
              <dt>Granted scopes</dt>
              <dd>{pending.identity.bot_scopes.join(", ")}</dd>
            </dl>
            <label className="check-line">
              <input
                type="checkbox"
                checked={dm}
                disabled={state.busy}
                onChange={(e) => setDm(e.target.checked)}
              />
              Allow Background and Overnight DMs
            </label>
            <div className="agent-channel-actions">
              <button
                type="button"
                disabled={
                  state.busy || Date.parse(pending.expires_at) <= Date.now()
                }
                onClick={() => void store.confirm(dm)}
              >
                Confirm connection
              </button>
              <button
                type="button"
                className="secondary"
                disabled={state.busy}
                onClick={store.cancel}
              >
                Cancel
              </button>
            </div>
          </section>
        )}
        {pending && pending.state !== "ready" && (
          <div role="status">
            <p>
              {pending.state === "pending" || pending.state === "exchanging"
                ? "Finish in Slack, then return here."
                : "Connection request ended. Start again to reconnect."}
            </p>
            {state.authorizationUrl && (
              <a
                href={state.authorizationUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                Open Slack authorization
              </a>
            )}
          </div>
        )}
        <div className="agent-channel-actions">
          {state.status?.configured &&
            !["pending", "exchanging", "ready"].includes(
              pending?.state ?? "",
            ) && (
              <button type="button" disabled={state.busy} onClick={start}>
                {connected ? "Reconnect Slack" : "Connect Slack"}
              </button>
            )}
          <button
            type="button"
            className="secondary"
            disabled={state.busy}
            onClick={() => void store.refresh()}
          >
            Refresh
          </button>
          {pending && ["pending", "exchanging"].includes(pending.state) && (
            <button
              type="button"
              className="link-button"
              disabled={state.busy}
              onClick={store.cancel}
            >
              Cancel request
            </button>
          )}
        </div>
        {state.error && <p role="alert">{state.error}</p>}
      </div>
      <TeamsChannelSettings />
    </SettingsSection>
  );
}
