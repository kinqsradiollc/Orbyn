import { SlackChannelStore, TeamsChannelStore } from "@orbyn/api-client";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useAccount } from "../../../app/account";
import { client, getSessionVersion, getToken } from "../../../lib/session";
import { Button, ErrorNotice } from "../../../ui/kit";
import { SettingsSection, useSettingsExit, useSettingsOwner } from "../shared";

const binding = () => (getToken() ? `session:${getSessionVersion()}` : "");
function useChannel(kind: "slack" | "teams") {
  const user = useAccount().user?.id,
    owned = useSettingsOwner(),
    generation = getSessionVersion();
  const key = `orbyn-${kind}-installation:${user ?? "none"}`;
  const store = useMemo(() => {
    const remember = (id: string | null) => {
      if (!owned()) return;
      try {
        if (id) sessionStorage.setItem(key, id);
        else sessionStorage.removeItem(key);
      } catch {
        /* UUID restoration is optional; refresh remains available. */
      }
    };
    return kind === "slack"
      ? new SlackChannelStore(client, binding, remember)
      : new TeamsChannelStore(client, binding, remember);
  }, [kind, key, generation, owned]);
  const state = useSyncExternalStore<
      | ReturnType<SlackChannelStore["getSnapshot"]>
      | ReturnType<TeamsChannelStore["getSnapshot"]>
    >(store.subscribe, store.getSnapshot),
    lock = useRef(false),
    unconfirmed = useRef(false);
  const [unknown, setUnknown] = useState(false);
  useSettingsExit({
    pending: state.busy || unknown,
    sensitive: "challenge" in state && !!state.challenge,
    message:
      "Review the connection outcome or finish the personal-chat link before leaving.",
  });
  useEffect(() => {
    let saved: string | null = null;
    try {
      saved = sessionStorage.getItem(key);
    } catch {
      /* Optional metadata storage. */
    }
    void store.restore(saved);
    return store.dispose;
  }, [store, key]);
  useEffect(() => {
    if (unknown || state.busy) return;
    const p = state.installation;
    const challenge = "challenge" in state ? state.challenge : null;
    const deadline =
      challenge?.expiresAt ??
      (p && ["pending", "exchanging"].includes(p.state) ? p.expires_at : null);
    if (!deadline) return;
    if (Date.parse(deadline) <= Date.now()) {
      if (store instanceof TeamsChannelStore) store.expireChallenge();
      return;
    }
    const timer = setTimeout(
      () => {
        if (store instanceof TeamsChannelStore) store.expireChallenge();
        void store.refresh();
      },
      Math.max(100, Math.min(10000, Date.parse(deadline) - Date.now())),
    );
    return () => clearTimeout(timer);
  }, [store, state.installation, state.busy, unknown, state]);
  async function change(work: () => Promise<void>) {
    if (lock.current || unconfirmed.current || state.busy || !owned()) return;
    lock.current = true;
    try {
      await work();
      const result = store.getSnapshot();
      if (
        owned() &&
        result.error &&
        result.failureKind !== "refused" &&
        result.failureKind !== "read"
      ) {
        unconfirmed.current = true;
        setUnknown(true);
      }
    } finally {
      lock.current = false;
    }
  }
  const start = () => {
    if (lock.current || unconfirmed.current || state.busy || !owned()) return;
    const popup = window.open("about:blank", "_blank");
    if (popup) popup.opener = null;
    void change(() =>
      store.start((url) => {
        if (owned() && popup) popup.location.replace(url);
      }),
    ).finally(() => {
      if (popup && !store.getSnapshot().authorizationUrl) popup.close();
    });
  };
  return { store, state, unknown, change, start, owned };
}
function Slack() {
  const { store, state, unknown, change, start } = useChannel("slack");
  const [dm, setDm] = useState(false);
  if (!(store instanceof SlackChannelStore)) return null;
  const s = store.getSnapshot(),
    c = s.status?.connection,
    p = s.installation;
  const blocked = s.busy || unknown;
  return (
    <div className="settings-connections-channel">
      <h4>Slack</h4>
      <p>
        {c && !c.disconnected
          ? `${c.workspace_name} · ${c.external_user_id} · ${c.token_state}`
          : "Not connected"}
      </p>
      {s.status && !s.status.configured && (
        <p className="muted">
          Slack setup unavailable. Existing permissions can still be turned off.
        </p>
      )}
      {c && !c.disconnected && (
        <>
          <p className="small">
            Workspace {c.workspace_id} · token expiry{" "}
            {c.token_expires_at ?? "Not reported"}
          </p>
          <label className="check">
            <input
              type="checkbox"
              checked={c.dm_enabled}
              disabled={
                blocked ||
                (!c.dm_enabled &&
                  (!s.status?.configured || c.token_state !== "ready"))
              }
              onChange={(e) =>
                void change(() => store.permission(e.target.checked))
              }
            />
            Send agent DMs to me
          </label>
          <Button
            disabled={blocked}
            onClick={() => void change(() => store.disconnect())}
          >
            Disconnect Slack
          </Button>
        </>
      )}
      {p?.state === "ready" && p.identity && (
        <>
          <p>
            Review {p.identity.workspace_name} · {p.identity.workspace_id} ·{" "}
            {p.identity.external_user_id}
          </p>
          <p className="small">Scopes: {p.identity.bot_scopes.join(", ")}</p>
          <label className="check">
            <input
              type="checkbox"
              checked={dm}
              disabled={blocked}
              onChange={(e) => setDm(e.target.checked)}
            />
            Allow Background and Overnight DMs
          </label>
          <Button
            disabled={blocked || Date.parse(p.expires_at) <= Date.now()}
            onClick={() => void change(() => store.confirm(dm))}
          >
            Confirm connection
          </Button>
        </>
      )}
      {p && (
        <p role="status">
          Request: {p.state} · expires {new Date(p.expires_at).toLocaleString()}
        </p>
      )}
      {s.authorizationUrl && (
        <a href={s.authorizationUrl} target="_blank" rel="noopener noreferrer">
          Open Slack authorization
        </a>
      )}
      <div className="settings-actions">
        <Button
          disabled={
            blocked ||
            !s.status?.configured ||
            (!!p && ["pending", "exchanging", "ready"].includes(p.state))
          }
          onClick={start}
        >
          {c ? "Reconnect Slack" : "Connect Slack"}
        </Button>
        <Button disabled={s.busy} onClick={() => void store.refresh()}>
          Refresh
        </Button>
        {p && (
          <Button disabled={blocked} onClick={store.cancel}>
            Cancel review
          </Button>
        )}
      </div>
      {state.error && <ErrorNotice message={state.error} />}
      {unknown && (
        <p role="alert">
          Connection receipt unconfirmed. Refresh reads saved state only; this
          action will not be repeated.
        </p>
      )}
    </div>
  );
}
function Teams() {
  const { store, state, unknown, change, start } = useChannel("teams");
  if (!(store instanceof TeamsChannelStore)) return null;
  const s = store.getSnapshot(),
    c = s.status?.connection,
    p = s.installation;
  const blocked = s.busy || unknown;
  return (
    <div className="settings-connections-channel">
      <h4>Microsoft Teams</h4>
      <p>
        {c && c.state !== "disconnected"
          ? `${c.display_name} · ${c.state}`
          : "Not connected"}
      </p>
      {s.status && !s.status.configured && (
        <p className="muted">Teams setup unavailable.</p>
      )}
      {c && c.state !== "disconnected" && (
        <>
          <p className="small">
            Personal chat: {c.state === "linked" ? "Linked" : "Not linked"}
          </p>
          {c.state === "linked" && (
            <label className="check">
              <input
                type="checkbox"
                checked={c.dm_enabled}
                disabled={
                  blocked || (!c.dm_enabled && !s.status?.delivery_available)
                }
                onChange={(e) =>
                  void change(() => store.permission(e.target.checked))
                }
              />
              Send agent DMs to me
            </label>
          )}
          {s.status && !s.status.delivery_available && (
            <p className="muted">Teams messaging is not configured.</p>
          )}
          <Button
            disabled={blocked}
            onClick={() => void change(() => store.disconnect())}
          >
            Disconnect Teams
          </Button>
          {s.status?.configured &&
            c.state === "awaiting_conversation" &&
            !s.challenge && (
              <Button
                disabled={blocked}
                onClick={() => void change(() => store.renewLink())}
              >
                Get linking command
              </Button>
            )}
        </>
      )}
      {p?.state === "ready" && p.identity && (
        <>
          <p>
            Review {p.identity.displayName} · tenant {p.identity.tenantId} ·
            account {p.identity.objectId}
          </p>
          <Button
            disabled={blocked || Date.parse(p.expires_at) <= Date.now()}
            onClick={() => void change(() => store.confirm())}
          >
            Use this account
          </Button>
        </>
      )}
      {s.challenge && (
        <div className="settings-secret">
          <p>
            Send this command to Orbyn in your personal Teams chat. Messaging
            stays off until enabled.
          </p>
          <pre tabIndex={0}>{s.challenge.command}</pre>
          <p>Expires {new Date(s.challenge.expiresAt).toLocaleString()}</p>
        </div>
      )}
      {p && (
        <p role="status">
          Request: {p.state} · expires {new Date(p.expires_at).toLocaleString()}
        </p>
      )}
      {s.authorizationUrl && (
        <a href={s.authorizationUrl} target="_blank" rel="noopener noreferrer">
          Open Microsoft sign-in
        </a>
      )}
      <div className="settings-actions">
        <Button
          disabled={
            blocked ||
            !s.status?.configured ||
            (!!p && ["pending", "exchanging", "ready"].includes(p.state)) ||
            (!!c && !["disconnected", "reconnect"].includes(c.state))
          }
          onClick={start}
        >
          Connect Teams
        </Button>
        <Button disabled={s.busy} onClick={() => void store.refresh()}>
          Refresh
        </Button>
        {p && (
          <Button disabled={blocked} onClick={store.cancel}>
            Cancel review
          </Button>
        )}
      </div>
      {state.error && <ErrorNotice message={state.error} />}
      {unknown && (
        <p role="alert">
          Connection receipt unconfirmed. Refresh reads saved state only; this
          action will not be repeated.
        </p>
      )}
    </div>
  );
}
export function Channels() {
  return (
    <SettingsSection
      title="Agent channels"
      description="Background updates and Overnight notices. Decisions open in Orbyn."
    >
      <Slack />
      <Teams />
    </SettingsSection>
  );
}
