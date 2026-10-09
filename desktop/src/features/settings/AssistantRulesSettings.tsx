import { useEffect, useState } from "react";
import {
  ASSISTANT_RULE_ACTIONS,
  type AssistantActionRule,
  type Team,
} from "@orbyn/core";
import { client } from "../../lib/api";
import { Select } from "../../components/Select";
import { SettingsSection } from "./SettingsSection";
import "./assistant-rules.css";

const ACTION_LABELS: Record<AssistantActionRule["action"], string> = {
  read: "Read",
  any_change: "Any change",
  create: "Create",
  edit: "Edit",
  delete_move_restore: "Delete or move",
  email: "Email",
  notify: "Notify",
  publish: "Publish",
  fetch: "Fetch",
  handoff: "Handoff",
};
const LANE_LABELS = {
  interactive: "Chat",
  background: "Background",
  overnight: "Overnight",
} as const;

function summary(rule: AssistantActionRule, teams: Team[]) {
  const space = rule.scope;
  const scope =
    space.kind === "all"
      ? "Every space"
      : space.kind === "personal"
        ? "Personal"
        : (teams.find((team) => team.id === space.id)?.name ?? "Team");
  return `${LANE_LABELS[rule.lane]} · ${ACTION_LABELS[rule.action]} · ${scope} · ${rule.decision}`;
}

/** First-party assistant restrictions, separate from MCP connected agents. */
export function AssistantRulesSettings({
  userId,
  teams,
}: {
  userId: string;
  teams: Team[];
}) {
  const [revision, setRevision] = useState<number | null>(null);
  const [rules, setRules] = useState<AssistantActionRule[]>([]);
  const [saved, setSaved] = useState<AssistantActionRule[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = async () => {
    const value = await client.assistantRules();
    setRevision(value.revision);
    setRules(value.rules);
    setSaved(value.rules);
    setEditing(null);
    setError("");
  };
  useEffect(() => {
    let live = true;
    setRevision(null);
    setRules([]);
    setSaved([]);
    setEditing(null);
    if (!userId) return;
    void client.assistantRules().then(
      (value) => {
        if (!live) return;
        setRevision(value.revision);
        setRules(value.rules);
        setSaved(value.rules);
      },
      () => {
        if (live) setError("Couldn't load rules. Retry.");
      },
    );
    return () => {
      live = false;
    };
  }, [userId]);

  const change = (id: string, next: AssistantActionRule) =>
    setRules((list) => list.map((rule) => (rule.id === id ? next : rule)));
  const add = () => {
    const id = crypto.randomUUID();
    setRules((list) => [
      ...list,
      {
        id,
        lane: "background",
        action: "any_change",
        scope: { kind: "all" },
        decision: "ask",
      },
    ]);
    setEditing(id);
    setError("");
    setNotice("");
  };
  const save = async () => {
    if (revision === null || pending) return;
    setPending(true);
    setError("");
    try {
      const value = await client.replaceAssistantRules(revision, rules);
      setRevision(value.revision);
      setRules(value.rules);
      setSaved(value.rules);
      setEditing(null);
      setNotice("Rules saved");
    } catch {
      setError("Couldn't save rules. Reload if they changed elsewhere.");
    } finally {
      setPending(false);
    }
  };

  return (
    <SettingsSection className="card settings-card assistant-rules-settings">
      <h2>Assistant rules</h2>
      <p className="muted">
        Limits for Orbyn's own Chat, Background and Overnight agents.
      </p>
      {revision === null ? (
        <div>
          <p className="muted" role={error ? "alert" : undefined}>
            {error || "Loading rules…"}
          </p>
          {error && (
            <button
              type="button"
              className="secondary"
              onClick={() =>
                void load().catch(() => setError("Couldn't load rules. Retry."))
              }
            >
              Retry
            </button>
          )}
        </div>
      ) : rules.length ? (
        <ul className="assistant-rule-list">
          {rules.map((rule) => (
            <li key={rule.id}>
              {editing === rule.id ? (
                <div className="assistant-rule-editor">
                  <label>
                    Agent
                    <Select
                      value={rule.lane}
                      onChange={(event) =>
                        change(rule.id, {
                          ...rule,
                          lane: event.target
                            .value as AssistantActionRule["lane"],
                        })
                      }
                    >
                      {Object.entries(LANE_LABELS).map(([id, label]) => (
                        <option key={id} value={id}>
                          {label}
                        </option>
                      ))}
                    </Select>
                  </label>
                  <label>
                    Action
                    <Select
                      value={rule.action}
                      onChange={(event) =>
                        change(rule.id, {
                          ...rule,
                          action: event.target
                            .value as AssistantActionRule["action"],
                        })
                      }
                    >
                      {ASSISTANT_RULE_ACTIONS.map((action) => (
                        <option key={action} value={action}>
                          {ACTION_LABELS[action]}
                        </option>
                      ))}
                    </Select>
                  </label>
                  <label>
                    Space
                    <Select
                      value={
                        rule.scope.kind === "team"
                          ? rule.scope.id
                          : rule.scope.kind
                      }
                      onChange={(event) =>
                        change(rule.id, {
                          ...rule,
                          scope:
                            event.target.value === "all"
                              ? { kind: "all" }
                              : event.target.value === "personal"
                                ? { kind: "personal" }
                                : { kind: "team", id: event.target.value },
                        })
                      }
                    >
                      <option value="all">Every space</option>
                      <option value="personal">Personal</option>
                      {teams.map((team) => (
                        <option key={team.id} value={team.id}>
                          {team.name}
                        </option>
                      ))}
                    </Select>
                  </label>
                  <label>
                    Rule
                    <Select
                      value={rule.decision}
                      onChange={(event) =>
                        change(rule.id, {
                          ...rule,
                          decision: event.target
                            .value as AssistantActionRule["decision"],
                        })
                      }
                    >
                      <option value="allow">Allow</option>
                      <option value="ask">Ask first</option>
                      <option value="deny">Block</option>
                    </Select>
                  </label>
                  {rule.action === "read" && rule.decision !== "allow" && (
                    <p className="muted">Agents skip this space.</p>
                  )}
                </div>
              ) : (
                <span>{summary(rule, teams)}</span>
              )}
              <div className="assistant-rule-actions">
                <button
                  type="button"
                  className="secondary"
                  disabled={pending}
                  onClick={() =>
                    setEditing(editing === rule.id ? null : rule.id)
                  }
                >
                  {editing === rule.id ? "Done" : "Edit"}
                </button>
                <button
                  type="button"
                  className="secondary"
                  disabled={pending}
                  onClick={() => {
                    setRules((list) =>
                      list.filter((item) => item.id !== rule.id),
                    );
                    setEditing(null);
                  }}
                >
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">No extra rules.</p>
      )}
      {revision !== null && (
        <div className="assistant-rule-actions">
          <button
            type="button"
            className="secondary"
            disabled={pending || rules.length >= 100}
            onClick={add}
          >
            Add rule
          </button>
          <button
            type="button"
            className="primary"
            disabled={
              pending || JSON.stringify(rules) === JSON.stringify(saved)
            }
            onClick={() => void save()}
          >
            {pending ? "Saving…" : "Save rules"}
          </button>
          <button
            type="button"
            className="link-button"
            disabled={pending}
            onClick={() =>
              void load().catch(() => setError("Couldn't reload rules. Retry."))
            }
          >
            Reload
          </button>
        </div>
      )}
      {error && revision !== null && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="muted">
          {notice}
        </p>
      )}
      <details>
        <summary>How rules work</summary>
        <p>Rules restrict existing access. Block wins.</p>
      </details>
    </SettingsSection>
  );
}
