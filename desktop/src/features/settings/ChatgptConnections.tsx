import { ManagedAiUsage } from "./ManagedAiUsage";
import { AgendaPrivateSettings } from "./AgendaPrivateSettings";
import { AiProviderChoiceControls } from "./AiProviderChoice";
import { ChatgptUsage } from "./ChatgptUsage";
import { useEffect, useId, useRef, useState } from "react";
import { MoreHorizontal, Plus, RefreshCw, Sparkles } from "lucide-react";
import { CHATGPT_USAGE_URL, type ChatgptDesktopCommand } from "@orbyn/core";
import { Select } from "../../components/Select";
import { chatgptStore, useChatgptConnection } from "../connections/chatgpt";
import { SettingsSection } from "./SettingsSection";
import { ChatgptRemoteModels } from "./ChatgptRemoteModels";
import { Popover } from "../../components/Popover";
import { session as authSession } from "../../lib/session";

/** Personal connections and defaults share the guarded desktop metadata store. */
export function ChatgptConnections(props: { userId?: string }) {
  return (
    <ChatgptConnectionsBody
      key={`${authSession.get()}:${props.userId ?? ""}`}
      {...props}
    />
  );
}

function ChatgptConnectionsBody({ userId = "" }: { userId?: string }) {
  const owner = useRef(authSession.get()).current;
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const state = useChatgptConnection();
  const id = useId();
  const [query, setQuery] = useState("");
  const [accountQuery, setAccountQuery] = useState("");
  const [menu, setMenu] = useState<{
    registrationId: string;
    anchor: DOMRect;
  } | null>(null);
  const [authenticating, setAuthenticating] = useState(false);
  const connection = state.connection;
  const catalog = connection?.catalog;
  const preference = catalog?.preference;
  const selected = connection?.connections.find((value) => value.selected);
  const busy =
    state.status === "loading" || !!connection?.busy || !!catalog?.saving;
  const models = catalog?.models ?? [];
  const available = catalog?.status === "ready";
  const missing =
    preference?.model &&
    !models.some((model) => model.slug === preference.model);
  const filtered = models.filter((model) =>
    `${model.display_name} ${model.slug}`
      .toLowerCase()
      .includes(query.trim().toLowerCase()),
  );
  const accounts = (connection?.connections ?? [])
    .map((account, index) => ({ account, index }))
    .filter(({ account, index }) =>
      `ChatGPT account ${index + 1} ${account.selected ? "Selected" : "Saved"}`
        .toLowerCase()
        .includes(accountQuery.trim().toLowerCase()),
    );
  const managedAccount = connection?.connections.find(
    (account) => account.registration_id === menu?.registrationId,
  );
  const run = (command: ChatgptDesktopCommand) => {
    if (!mounted.current || authSession.get() !== owner) return;
    setMenu(null);
    // The shared store publishes a sanitized error for every failed command.
    const signIn =
      command.action === "connect" || command.action === "reconnect";
    if (signIn) setAuthenticating(true);
    void chatgptStore
      .command(command)
      .catch(() => {})
      .finally(() => {
        if (signIn && mounted.current && authSession.get() === owner)
          setAuthenticating(false);
      });
  };
  return (
    <SettingsSection className="card settings-card">
      <h2>
        <Sparkles size={18} aria-hidden="true" />
        AI connections &amp; models
      </h2>
      {state.status === "unsupported" && (
        <p className="muted">Connect ChatGPT in Orbyn on a phone or desktop.</p>
      )}
      {state.status === "unsupported" ? (
        <ChatgptRemoteModels userId={userId} />
      ) : (
        <>
          <div className="settings-head ai-connection-heading">
            <div>
              <h3>ChatGPT</h3>
            </div>
            <button
              type="button"
              className="primary"
              disabled={busy || authenticating || !connection?.user_id}
              onClick={() => run({ action: "connect" })}
            >
              <Plus size={15} aria-hidden="true" />
              {connection?.connections.length
                ? "Add account"
                : "Connect ChatGPT"}
            </button>
          </div>
          {state.status === "loading" && <p role="status">Loading accounts…</p>}
          {(connection?.connections.length ?? 0) > 4 && (
            <label className="settings-field">
              Find an account
              <input
                type="search"
                value={accountQuery}
                onChange={(event) => setAccountQuery(event.target.value)}
                placeholder="Account number or status"
              />
            </label>
          )}
          {!!connection?.connections.length && (
            <div className="ai-connection-list" aria-label="ChatGPT accounts">
              {accounts.map(({ account, index }) => (
                <div
                  className="ai-connection-row"
                  key={account.registration_id}
                >
                  <div>
                    <strong>ChatGPT account {index + 1}</strong>
                    <p className="muted">
                      {account.selected ? "Selected" : "Saved on this device"}
                      {account.sharing_granted === false
                        ? " · Sign-in only; model access not granted"
                        : ""}
                    </p>
                  </div>
                  <div className="ai-connection-actions">
                    {!account.selected && (
                      <button
                        type="button"
                        className="secondary"
                        disabled={busy}
                        onClick={() =>
                          run({
                            action: "select",
                            registrationId: account.registration_id,
                            selectionRevision:
                              connection.selection?.revision ?? null,
                          })
                        }
                      >
                        Use account
                      </button>
                    )}
                    <button
                      type="button"
                      className="icon-button"
                      aria-label={`Manage ChatGPT account ${index + 1}`}
                      aria-haspopup="dialog"
                      aria-expanded={
                        menu?.registrationId === account.registration_id
                      }
                      disabled={busy}
                      onClick={(event) =>
                        setMenu({
                          registrationId: account.registration_id,
                          anchor: event.currentTarget.getBoundingClientRect(),
                        })
                      }
                    >
                      <MoreHorizontal size={16} aria-hidden="true" />
                    </button>
                  </div>
                </div>
              ))}
              {!accounts.length && <p role="status">No matching accounts.</p>}
            </div>
          )}
          {menu && managedAccount && (
            <Popover
              anchor={menu.anchor}
              label="Manage ChatGPT account"
              onClose={() => setMenu(null)}
              width={240}
            >
              <button
                disabled={busy}
                onClick={() =>
                  run({
                    action: "reconnect",
                    registrationId: managedAccount.registration_id,
                    requestPlanConsent: true,
                  })
                }
              >
                Enable plan access
              </button>
              <button
                disabled={busy}
                onClick={() =>
                  run({
                    action: "reconnect",
                    registrationId: managedAccount.registration_id,
                  })
                }
              >
                Reconnect
              </button>
              <button
                disabled={busy}
                onClick={() =>
                  run({
                    action: "disconnect",
                    registrationId: managedAccount.registration_id,
                  })
                }
              >
                Disconnect
              </button>
            </Popover>
          )}
          {selected && (
            <div className="ai-model-settings">
              <div className="settings-head">
                <div>
                  <h3>Default model</h3>
                </div>
                <button
                  type="button"
                  className="secondary"
                  disabled={busy}
                  onClick={() => run({ action: "refresh" })}
                >
                  <RefreshCw size={14} aria-hidden="true" />
                  Refresh models
                </button>
              </div>
              {!!models.length && (
                <label className="settings-field" htmlFor={`${id}-search`}>
                  Find a model
                  <input
                    id={`${id}-search`}
                    type="search"
                    value={query}
                    placeholder="Search name or model ID"
                    onChange={(event) => setQuery(event.target.value)}
                  />
                </label>
              )}
              <label className="settings-field" htmlFor={`${id}-default`}>
                Selected default
                <Select
                  id={`${id}-default`}
                  value={preference?.model ?? ""}
                  disabled={busy || !preference || !available}
                  onChange={(event) =>
                    run({
                      action: "set-default",
                      model: event.target.value || null,
                      version: preference?.version ?? 0,
                    })
                  }
                >
                  <option value="">No default selected</option>
                  {missing && (
                    <option value={preference!.model!} disabled>
                      {preference!.model!} · unavailable
                    </option>
                  )}
                  {models
                    .filter(
                      (model) =>
                        filtered.includes(model) ||
                        model.slug === preference?.model,
                    )
                    .map((model) => (
                      <option key={model.slug} value={model.slug}>
                        {model.display_name} ({model.slug})
                      </option>
                    ))}
                </Select>
              </label>
              {!available && (
                <p role="status" className="muted">
                  Models unavailable. Refresh or reconnect.
                </p>
              )}
              {available && !models.length && (
                <p role="status">This account returned no selectable models.</p>
              )}
              {available && !!query && !filtered.length && (
                <p role="status">No models match your search.</p>
              )}
            </div>
          )}
          {authenticating && (
            <button
              type="button"
              className="secondary"
              onClick={() => run({ action: "cancel" })}
            >
              Cancel sign-in
            </button>
          )}
          <div className="settings-subform" aria-label="ChatGPT plan and usage">
            <h3>Plan and usage</h3>
            <p>
              {selected?.sharing_granted
                ? "Plan access granted"
                : "Plan access unverified"}
            </p>
            {connection?.verification && (
              <details>
                <summary>Connection details</summary>
                <p>
                  Connection check completed ·{" "}
                  {new Date(
                    connection.verification.verified_at,
                  ).toLocaleString()}
                </p>
                {connection.verification.usage && (
                  <p>
                    Connection check:{" "}
                    {connection.verification.usage.input_tokens} input +{" "}
                    {connection.verification.usage.output_tokens} output ={" "}
                    {connection.verification.usage.total_tokens} tokens
                  </p>
                )}
              </details>
            )}
            <div className="button-row start">
              <button
                type="button"
                className="secondary"
                disabled={
                  busy ||
                  !selected?.sharing_granted ||
                  !available ||
                  !preference?.model
                }
                onClick={() => run({ action: "verify-plan" })}
              >
                Verify plan access
              </button>
              <a
                className="secondary"
                href={CHATGPT_USAGE_URL}
                target="_blank"
                rel="noopener noreferrer"
              >
                View ChatGPT usage
              </a>
            </div>
            <small className="field-hint">
              Verification sends a test request using your plan.
            </small>
          </div>
          {(state.error || connection?.error || catalog?.error) && (
            <p role="alert">
              {state.error || connection?.error || catalog?.error}
            </p>
          )}
          {state.notice && <p role="status">{state.notice}</p>}
          {state.status === "unavailable" && (
            <button
              type="button"
              className="secondary"
              onClick={() => void chatgptStore.retrySession()}
            >
              Retry connection
            </button>
          )}
        </>
      )}
      {state.status !== "unsupported" && (
        <AiProviderChoiceControls
          userId={userId}
          selection={
            connection?.selection?.executor
              ? {
                  connection_id: connection.selection.executor.connection_id,
                  executor_id: connection.selection.executor.executor_id,
                }
              : null
          }
        />
      )}
      <AgendaPrivateSettings userId={userId} />
      {state.status !== "unsupported" && <ChatgptUsage userId={userId} />}
      <ManagedAiUsage userId={userId} />
      <details className="ai-connection-note">
        <summary>Workspace providers</summary>
        <p className="muted">
          Admins manage providers in Admin → AI; keys stay on the server.
        </p>
      </details>
    </SettingsSection>
  );
}
