import { useCallback, useEffect, useState } from "react";
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
  const [data, setData] = useState<TeamAgentsView | null>(null);
  const [saving, setSaving] = useState(false);
  const load = useCallback(() => {
    client.teamAgents(teamId).then(setData, report);
  }, [teamId, report]);
  useEffect(load, [load]);

  const change = (agent_access: TeamAgentAccess) => {
    setSaving(true);
    client
      .setTeamAgentAccess(teamId, agent_access)
      .then(load, report)
      .finally(() => setSaving(false));
  };

  if (!data) return null;
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
            disabled={saving}
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
      <p className="muted team-agents-lead">
        {canManage ? "" : `${label.name}. `}
        {label.blurb} AI agents members connect (like Claude or ChatGPT) never
        see more than their person.
        {data.first_used_at
          ? ` An agent first used ${teamName} ${timeAgo(data.first_used_at)}.`
          : ""}
      </p>
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
            No member has connected an agent that can reach this team.
          </p>
        ))}
    </div>
  );
}
