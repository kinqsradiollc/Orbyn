import {
  TEAM_AGENT_ACCESS,
  TEAM_AGENT_ACCESS_LABELS,
  TEAM_POLICY_TEXT,
  type TeamAgentAccess,
  type TeamPolicies,
} from "@orbyn/core";
import { client } from "../../lib/session";
import { SelectBox } from "../../ui/kit";
import {
  ActionState,
  ReadState,
  useCommand,
  useRead,
  useTeamsExit,
} from "./state";
import type { PermissionCheck } from "./Workspace";
export function Policies({
  teamId,
  check,
}: {
  teamId: string;
  check: PermissionCheck;
}) {
  const policies = useRead(() => client.getTeamPolicies(teamId), [teamId]),
    agents = useRead(() => client.teamAgents(teamId), [teamId]),
    command = useCommand();
  useTeamsExit({
    live: command.live,
    pending: command.pending,
    uncertain: command.unknown,
  });
  const change = (
    key: "publishing" | "assistant" | "booking",
    value: boolean,
  ) => {
    if (
      !policies.fresh ||
      !policies.data?.can_change ||
      policies.data[key] === value
    )
      return;
    void command.run<TeamPolicies>({
      label: `${TEAM_POLICY_TEXT[key].label}: ${value ? "on" : "off"}`,
      prepare: () => check("team:update", true),
      perform: () => client.setTeamPolicies(teamId, { [key]: value }),
      validate: (r) => r[key] === value,
      check: async () => {
        const r = await client.getTeamPolicies(teamId);
        return { done: r[key] === value, value: r };
      },
      saved: (r) => {
        if (r) policies.commit(r);
        else void policies.reload();
      },
    });
  };
  const access = (value: TeamAgentAccess) => {
    if (
      !agents.fresh ||
      !policies.data?.can_change ||
      agents.data?.agent_access === value
    )
      return;
    void command.run<{ id: string; agent_access: TeamAgentAccess }>({
      label: `Outside agents: ${TEAM_AGENT_ACCESS_LABELS[value].name}`,
      prepare: () => check("team:update", true),
      perform: () => client.setTeamAgentAccess(teamId, value),
      validate: (r) => r.id === teamId && r.agent_access === value,
      check: async () => {
        const r = await client.teamAgents(teamId);
        return {
          done: r.agent_access === value,
          value: { id: teamId, agent_access: r.agent_access },
        };
      },
      saved: () => void agents.reload(),
    });
  };
  return (
    <>
      <section className="teams-section">
        <h3>Team permissions</h3>
        <ReadState read={policies} label="team permissions" />
        <ActionState command={command} />
        {policies.data &&
          (["publishing", "assistant", "booking"] as const).map((key) => (
            <label className="teams-switch" key={key}>
              <input
                type="checkbox"
                role="switch"
                checked={policies.data![key]}
                disabled={
                  !policies.fresh ||
                  !policies.data!.can_change ||
                  command.blocked
                }
                onChange={(e) => change(key, e.target.checked)}
              />
              <span>
                <strong>{TEAM_POLICY_TEXT[key].label}</strong>
                <span className="small">{TEAM_POLICY_TEXT[key].hint}</span>
              </span>
            </label>
          ))}
        {policies.data && !policies.data.can_change && (
          <p className="small">
            Only team owners and admins can change these settings.
          </p>
        )}
      </section>
      <section className="teams-section">
        <h3>Outside agents</h3>
        <ReadState read={agents} label="agent access" />
        {agents.data && (
          <>
            <label className="field">
              Team access
              <SelectBox
                value={agents.data.agent_access}
                disabled={
                  !agents.fresh ||
                  !policies.fresh ||
                  !policies.data?.can_change ||
                  command.blocked
                }
                onChange={(e) => access(e.target.value as TeamAgentAccess)}
              >
                {TEAM_AGENT_ACCESS.map((a) => (
                  <option value={a} key={a}>
                    {TEAM_AGENT_ACCESS_LABELS[a].name}
                  </option>
                ))}
              </SelectBox>
            </label>
            <p>{TEAM_AGENT_ACCESS_LABELS[agents.data.agent_access].blurb}</p>
            <p className="small">
              An agent cannot exceed the access of the person who connected it.
            </p>
            {agents.data.first_used_at && (
              <p className="small">
                First used{" "}
                {new Date(agents.data.first_used_at).toLocaleString()}
              </p>
            )}
            {agents.data.connections !== null &&
              (agents.data.connections.length ? (
                <ul className="teams-records">
                  {agents.data.connections.map((c, i) => (
                    <li key={`${c.member}-${c.app}-${i}`}>
                      <strong dir="auto">{c.member}</strong>
                      <span dir="auto">
                        {c.app} · {c.kind}
                      </span>
                      <span className="small">
                        {c.last_used_at
                          ? `Last used ${new Date(c.last_used_at).toLocaleString()}`
                          : "Not used yet"}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p>No connected agents can access this team.</p>
              ))}
          </>
        )}
      </section>
    </>
  );
}
