import { useId, useState } from "react";
import { Plus, RefreshCw, Sparkles } from "lucide-react";
import type { ChatgptDesktopCommand } from "@orbyn/core";
import { Select } from "../../components/Select";
import { chatgptStore, useChatgptConnection } from "../../lib/chatgpt";
import { SettingsSection } from "./SettingsSection";

/** Personal connections and defaults share the guarded desktop metadata store. */
export function ChatgptConnections() {
  const state = useChatgptConnection();
  const id = useId();
  const [query, setQuery] = useState("");
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
  const run = (command: ChatgptDesktopCommand) => {
    // The shared store publishes a sanitized error for every failed command.
    const signIn =
      command.action === "connect" || command.action === "reconnect";
    if (signIn) setAuthenticating(true);
    void chatgptStore
      .command(command)
      .catch(() => {})
      .finally(() => {
        if (signIn) setAuthenticating(false);
      });
  };
  return (
    <SettingsSection className="card settings-card" defaultOpen>
      <h2>
        <Sparkles size={18} aria-hidden="true" />
        AI connections &amp; models
      </h2>
      <p className="muted">
        Connect a personal ChatGPT account and choose its default model.
      </p>
      {state.status === "unsupported" ? (
        <div className="ai-connection-note">
          <strong>Connect from the Orbyn desktop app</strong>
          <p>
            The desktop app owns the connection and keeps your ChatGPT
            credentials in encrypted device storage.
          </p>
        </div>
      ) : (
        <>
          <div className="settings-head ai-connection-heading">
            <div>
              <h3>ChatGPT</h3>
              <p className="muted">
                Personal account · catalog read on this device
              </p>
            </div>
            <button
              type="button"
              className="primary"
              disabled={busy || !connection?.user_id}
              onClick={() => run({ action: "connect" })}
            >
              <Plus size={15} aria-hidden="true" />
              {connection?.connections.length
                ? "Add account"
                : "Connect ChatGPT"}
            </button>
          </div>
          {state.status === "loading" && (
            <p role="status">Loading your desktop connections…</p>
          )}
          {!!connection?.connections.length && (
            <div className="ai-connection-list" aria-label="ChatGPT accounts">
              {connection.connections.map((account, index) => (
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
                    <details className="ai-connection-menu">
                      <summary
                        aria-label={`Manage ChatGPT account ${index + 1}`}
                      >
                        ⋯
                      </summary>
                      <div>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            run({
                              action: "reconnect",
                              registrationId: account.registration_id,
                            })
                          }
                        >
                          Reconnect
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            run({
                              action: "disconnect",
                              registrationId: account.registration_id,
                            })
                          }
                        >
                          Disconnect
                        </button>
                      </div>
                    </details>
                  </div>
                </div>
              ))}
            </div>
          )}
          {selected && (
            <div className="ai-model-settings">
              <div className="settings-head">
                <div>
                  <h3>Default model</h3>
                  <p className="muted">
                    Choices come from this account’s live model catalog.
                  </p>
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
                  Models are unavailable. Your saved default is retained;
                  reconnect or refresh to choose a model.
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
      <div className="ai-connection-note">
        <strong>Workspace providers</strong>
        <p className="muted">
          Workspace AI providers are configured by an administrator in Admin →
          AI. Their API keys stay on the server.
        </p>
      </div>
    </SettingsSection>
  );
}
