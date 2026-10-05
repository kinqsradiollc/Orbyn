import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Unplug } from "lucide-react";
import { TeamsChannelStore } from "@orbyn/api-client";
import { client } from "../../lib/api";
import { session, onSessionChange } from "../../lib/session";
const KEY = "orbyn-teams-installation";
function remember(id: string | null) {
  try {
    if (id) sessionStorage.setItem(KEY, id);
    else sessionStorage.removeItem(KEY);
  } catch {
    /* Optional UUID-only restoration. */
  }
}
/** Account review, personal-chat proof and messaging consent are distinct steps. */
export function TeamsChannelSettings() {
  const [token, setToken] = useState(session.get);
  useEffect(() => onSessionChange(setToken), []);
  const store = useMemo(
    () => new TeamsChannelStore(client, session.get, remember),
    [token],
  );
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
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
  const pending = state.installation,
    connection = state.status?.connection;
  useEffect(() => {
    const deadline =
      state.challenge?.expiresAt ??
      (pending && ["pending", "exchanging"].includes(pending.state)
        ? pending.expires_at
        : null);
    if (!deadline || state.busy) return;
    const remaining = Date.parse(deadline) - Date.now();
    if (remaining <= 0) {
      store.expireChallenge();
      return;
    }
    const timer = setTimeout(
      () => void store.refresh(),
      Math.min(10000, remaining),
    );
    return () => clearTimeout(timer);
  }, [store, pending, state.challenge, state.busy]);
  const active = connection && connection.state !== "disconnected";
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
    <section
      className="agent-channel-body agent-channel-teams"
      aria-label="Teams connection"
    >
      <div className="agent-channel-row">
        <strong>Microsoft Teams</strong>
        <span className="muted">
          {active ? connection.display_name : "Not connected"}
        </span>
        {active && (
          <button
            type="button"
            className="icon-button secondary"
            aria-label="Disconnect Teams"
            title="Disconnect Teams"
            disabled={state.busy}
            onClick={() => void store.disconnect()}
          >
            <Unplug size={16} aria-hidden="true" />
          </button>
        )}
      </div>
      {!state.status && !state.error && (
        <p role="status">Loading connection…</p>
      )}
      {state.status && !state.status.configured && (
        <p className="muted">Teams setup is unavailable.</p>
      )}
      {active && (
        <>
          <span className="muted" role="status">
            {connection.state === "linked"
              ? "Personal chat linked"
              : connection.state === "reconnect"
                ? "Reconnect required"
                : "Link your personal chat"}
          </span>
          {connection.state === "linked" && (
            <label className="check-line">
              <input
                type="checkbox"
                role="switch"
                className="ai-switch"
                checked={connection.dm_enabled}
                disabled={
                  state.busy ||
                  (!state.status?.delivery_available && !connection.dm_enabled)
                }
                onChange={(e) => void store.permission(e.target.checked)}
              />
              Send agent DMs to me
            </label>
          )}
          {state.status && !state.status.delivery_available && (
            <p className="muted">
              Messaging is unavailable until your administrator configures the
              Teams bot.
            </p>
          )}
        </>
      )}
      {pending?.state === "ready" && pending.identity && (
        <section
          className="agent-channel-review"
          aria-label="Review Microsoft account"
        >
          <strong>{pending.identity.displayName}</strong>
          <dl className="agent-channel-identity">
            <dt>Tenant</dt>
            <dd>{pending.identity.tenantId}</dd>
            <dt>Account</dt>
            <dd>{pending.identity.objectId}</dd>
          </dl>
          <div className="agent-channel-actions">
            <button
              type="button"
              disabled={
                state.busy || Date.parse(pending.expires_at) <= Date.now()
              }
              onClick={() => void store.confirm()}
            >
              Use this account
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
      {state.challenge && (
        <section
          className="agent-channel-review"
          aria-label="Link personal Teams chat"
        >
          <p>Send this command in your personal chat with the Orbyn bot.</p>
          <code className="agent-channel-command">
            {state.challenge.command}
          </code>
          <span className="muted">
            Expires {new Date(state.challenge.expiresAt).toLocaleTimeString()}.
            Messaging stays off until you enable it.
          </span>
        </section>
      )}
      {pending && pending.state !== "ready" && (
        <p role="status">
          {["pending", "exchanging"].includes(pending.state)
            ? "Finish Microsoft sign-in, then return here."
            : pending.state === "confirmed"
              ? "Account reviewed. Link your personal chat."
              : "Request ended. Connect again to continue."}
        </p>
      )}
      {state.authorizationUrl && (
        <a
          href={state.authorizationUrl}
          target="_blank"
          rel="noopener noreferrer"
        >
          Open Microsoft sign-in
        </a>
      )}
      <div className="agent-channel-actions">
        {state.status?.configured &&
          !["pending", "exchanging", "ready"].includes(pending?.state ?? "") &&
          (!active || connection.state === "reconnect") && (
            <button type="button" disabled={state.busy} onClick={start}>
              Connect Teams
            </button>
          )}
        {state.status?.configured &&
          active &&
          connection.state === "awaiting_conversation" &&
          !state.challenge && (
            <button
              type="button"
              disabled={state.busy}
              onClick={() => void store.renewLink()}
            >
              Get linking command
            </button>
          )}
        <button
          type="button"
          className="secondary"
          disabled={state.busy}
          onClick={() => void store.refresh()}
        >
          Refresh Teams
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
    </section>
  );
}
