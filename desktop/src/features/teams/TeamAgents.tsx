import { useRef, useState } from "react";
import { Bot } from "lucide-react";
import {
  TEAM_AGENT_ACCESS,
  TEAM_AGENT_ACCESS_LABELS,
  type TeamAgentAccess,
  type TeamAgentsView,
} from "@orbyn/core";
import { client } from "../../lib/api";
import { timeAgo } from "../../lib/tasks";
import { Select } from "../../components/Select";
import "./team-agents.css";
import { useSettingsRead } from "../settings/useSettingsRead";
import { usePaneLeaveGuard } from "../../app/page-commands";
import { errorText } from "../../lib/errors";

/**
 * Team settings → Outside agents: how members' AI agents may use the team's
 * data. Owners and admins choose (off, read, suggest, or each member's
 * role) and see whose agents can reach the team, by name and app only.
 * Everyone else sees the policy.
 */
export function TeamAgents({
  teamId,
  teamName,
  canManage,
  report,
}: {
  teamId: string;
  teamName: string;
  canManage: boolean;
  report: (e: unknown) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const mutation = useRef(false);
  const read = useSettingsRead<TeamAgentsView>(
    () => client.teamAgents(teamId),
    report,
  );
  const data = read.data;
  usePaneLeaveGuard(async () => !mutation.current);
  const change = async (agent_access: TeamAgentAccess) => {
    if (!canManage || !read.current() || mutation.current) return;
    mutation.current = true;
    setSaving(true);
    setError("");
    try {
      await client.setTeamAgentAccess(teamId, agent_access);
      if (read.current()) {
        read.commit((previous) =>
          previous ? { ...previous, agent_access } : previous,
        );
        await read.reload();
      }
    } catch (e) {
      if (read.current()) setError(errorText(e));
    } finally {
      mutation.current = false;
      if (read.current()) setSaving(false);
    }
  };
  if (!data)
    return read.failed ? (
      <p role="alert">
        Agent access couldn’t be loaded.{" "}
        <button className="text-button" onClick={() => void read.reload()}>
          Retry
        </button>
      </p>
    ) : (
      <p className="muted" role="status">
        Loading agent access…
      </p>
    );
  const label = TEAM_AGENT_ACCESS_LABELS[data.agent_access];
  return (
    <div className="team-agents">
      <div className="subheading">
        <h3>
          <Bot size={15} aria-hidden="true" /> Outside agents
        </h3>
        {canManage && (
          <Select
            aria-label={`Outside agents in ${teamName}`}
            value={data.agent_access}
            disabled={saving || read.loading || read.failed}
            onChange={(e) => change(e.target.value as TeamAgentAccess)}
          >
            {TEAM_AGENT_ACCESS.map((a) => (
              <option key={a} value={a}>
                {TEAM_AGENT_ACCESS_LABELS[a].name}
              </option>
            ))}
          </Select>
        )}
      </div>
      {saving && (
        <p className="muted" role="status">
          Saving…
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      {read.failed && (
        <p role="alert">
          Agent access couldn’t be refreshed.{" "}
          <button className="text-button" onClick={() => void read.reload()}>
            Retry
          </button>
        </p>
      )}
      <p className="muted team-agents-lead">
        {canManage ? "" : `${label.name}. `}
        {label.blurb}
      </p>
      <details className="team-agents-help">
        <summary>Agent access details</summary>
        <p className="muted">
          Agents never see more than the member who connected them.
        </p>
        {data.first_used_at && (
          <p className="muted">First used {timeAgo(data.first_used_at)}.</p>
        )}
      </details>
      {data.connections &&
        (data.connections.length ? (
          <ul className="team-agents-list">
            {data.connections.map((c, i) => (
              <li key={`${c.member}-${c.app}-${i}`}>
                <strong>{c.member}</strong>
                <span>{c.app}</span>
                <span className="muted">
                  {c.last_used_at
                    ? `Used ${timeAgo(c.last_used_at)}`
                    : "Not used yet"}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted team-agents-lead">
            No connected agents can access this team.
          </p>
        ))}
    </div>
  );
}
