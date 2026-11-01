import {
  agentExpiryText,
  AGENT_ACCESS_LABELS,
  type AgentGrant,
} from "@orbyn/core";
import { useContext, useRef, useState } from "react";
import { client } from "../../../lib/session";
import { Button, Input, SelectBox } from "../../../ui/kit";
import {
  SettingsExitContext,
  SettingsSection,
  useSettingsRead,
  type SettingsExit,
} from "../shared";
import {
  ActionError,
  ReadState,
  RetainedDetails,
  useConnectionAction,
} from "./common";
import { AgentConnect } from "./AgentConnect";
import { AgentAccess } from "./AgentAccess";
import { AgentActivity } from "./AgentActivity";
import { AgentInbox } from "./AgentInbox";
import { PluginAi } from "./PluginAi";
export function Agents() {
  const read = useSettingsRead(() => client.agents()),
    action = useConnectionAction();
  const [query, setQuery] = useState(""),
    [group, setGroup] = useState("outside"),
    [limit, setLimit] = useState(10);
  const registered = useRef(new Set<() => SettingsExit>()),
    forward = useContext(SettingsExitContext);
  const register = (reader: () => SettingsExit) => {
    registered.current.add(reader);
    const remove = forward(reader);
    return () => {
      registered.current.delete(reader);
      remove();
    };
  };
  const canRemove = () =>
    ![...registered.current].some((read) => {
      const state = read();
      return state.pending || state.sensitive || state.dirty;
    });
  const [guardError, setGuardError] = useState("");
  const update = (saved: AgentGrant) => {
    if (read.data)
      read.commit({
        ...read.data,
        grants: read.data.grants.map((g) => (g.id === saved.id ? saved : g)),
      });
  };
  const matches = (g: AgentGrant) =>
    (group === "orbyn" ? g.kind === "assistant" : g.kind !== "assistant") &&
    `${g.name} ${g.client_name} ${g.client_host ?? ""} ${g.teams.map((t) => t.name).join(" ")}`
      .toLocaleLowerCase()
      .includes(query.toLocaleLowerCase());
  const visibleIds = new Set(
    (read.data?.grants ?? [])
      .filter(matches)
      .slice(0, limit)
      .map((g) => g.id),
  );
  // Keep editor owners mounted when filtering, so hidden drafts still guard exit.
  return (
    <SettingsExitContext.Provider value={register}>
      <SettingsSection
        title="Connected agents"
        description="Choose what each agent can see, suggest or change."
      >
        <ReadState {...read}>
          {read.data && (
            <>
              <p className="small">
                MCP address: <code>{read.data.mcp_url}</code>
              </p>
              {read.data.legacy_keys_until && (
                <p className="small">
                  Old API keys work with MCP until{" "}
                  {new Date(read.data.legacy_keys_until).toLocaleString()}.
                  Replace them with agent keys.
                </p>
              )}
              <div className="settings-actions">
                <Input
                  aria-label="Find connected agents"
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
                <SelectBox
                  aria-label="Connection group"
                  value={group}
                  onChange={(e) => {
                    setGroup(e.target.value);
                    setLimit(10);
                  }}
                >
                  <option value="outside">Outside agents</option>
                  <option value="orbyn">Orbyn agents</option>
                </SelectBox>
              </div>
              {read.data.grants.map((g) => (
                <div
                  key={g.id}
                  hidden={!visibleIds.has(g.id)}
                  className="settings-connections-grant"
                >
                  <h4 dir="auto">{g.client_name || g.name}</h4>
                  <p className="small muted">
                    {g.name} · {g.kind} · {g.prefix} ·{" "}
                    {AGENT_ACCESS_LABELS[g.access].name} ·{" "}
                    {agentExpiryText(g.expires_at)}
                    {g.reconnect_required && " · Reconnect required"}
                    {g.suspended_at && " · Paused"}
                  </p>
                  <p className="small">
                    {[
                      g.personal ? "Personal" : "",
                      ...g.teams.map((t) => t.name),
                    ]
                      .filter(Boolean)
                      .join(", ")}{" "}
                    · last used{" "}
                    {g.last_used_at
                      ? new Date(g.last_used_at).toLocaleString()
                      : "Never"}
                    {g.hide_outside_content && " · Outside content hidden"}
                  </p>
                  <RetainedDetails title="Trust and tools">
                    <AgentAccess grant={g} onSaved={update} />
                  </RetainedDetails>
                  <RetainedDetails title="Activity and undo">
                    <AgentActivity grant={g} />
                  </RetainedDetails>
                  {g.kind !== "assistant" && (
                    <RetainedDetails title="Inbox and wake-up">
                      <AgentInbox id={g.id} />
                    </RetainedDetails>
                  )}
                  {g.kind === "oauth" && (
                    <RetainedDetails title="Workspace AI permission">
                      <PluginAi id={g.id} />
                    </RetainedDetails>
                  )}
                  <div className="settings-actions">
                    {g.suspended_at && !g.reconnect_required && (
                      <Button
                        disabled={!read.fresh || action.blocked}
                        onClick={() =>
                          void action.run(
                            () => client.restoreAgent(g.id),
                            () => void read.reload(),
                            {
                              title: "Restore this connection?",
                              body: "The connection can use its existing permissions again.",
                              action: "Restore",
                            },
                          )
                        }
                      >
                        Restore connection
                      </Button>
                    )}
                    {g.kind !== "assistant" && (
                      <Button
                        variant="danger"
                        disabled={!read.fresh || action.blocked}
                        onClick={() => {
                          if (!canRemove()) {
                            setGuardError(
                              "Finish or cancel open agent edits before revoking a connection.",
                            );
                            return;
                          }
                          void action.run(
                            () => client.revokeAgent(g.id),
                            () => {
                              read.commit({
                                ...read.data!,
                                grants: read.data!.grants.filter(
                                  (x) => x.id !== g.id,
                                ),
                              });
                            },
                            {
                              title:
                                g.kind === "legacy"
                                  ? "Disconnect MCP access?"
                                  : "Revoke connection?",
                              body:
                                g.kind === "legacy"
                                  ? "This key will continue working with the API and CalDAV."
                                  : "The connection stops working immediately.",
                              action: "Revoke",
                              danger: true,
                            },
                          );
                        }}
                      >
                        Revoke connection
                      </Button>
                    )}
                  </div>
                </div>
              ))}
              {read.data.grants.filter(matches).length > limit && (
                <Button onClick={() => setLimit((old) => old + 10)}>
                  Show more connections
                </Button>
              )}
              {!read.data.grants.filter(matches).length && (
                <p className="muted">No matching connections.</p>
              )}
              <RetainedDetails title="Connect another agent">
                <AgentConnect
                  url={read.data.mcp_url}
                  onCreated={() => void read.reload()}
                />
              </RetainedDetails>
            </>
          )}
        </ReadState>
        <ActionError action={action} />
        {guardError && <p role="alert">{guardError}</p>}
      </SettingsSection>
    </SettingsExitContext.Provider>
  );
}
