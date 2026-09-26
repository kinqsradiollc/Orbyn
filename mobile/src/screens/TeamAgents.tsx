import React, { useCallback, useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import {
  TEAM_AGENT_ACCESS,
  TEAM_AGENT_ACCESS_LABELS,
  type TeamAgentAccess,
  type TeamAgentsView,
} from "@orbyn/core";
import { Segmented } from "../components/Segmented";
import { client } from "../lib/api";
import { timeAgo } from "../lib/progress";
import { colors, fonts, radii, themed } from "../theme";
import { shared } from "../styles";

type Act = (fn: () => Promise<void>) => Promise<void>;

const NAMES = Object.fromEntries(
  TEAM_AGENT_ACCESS.map((a) => [a, TEAM_AGENT_ACCESS_LABELS[a].name]),
) as Record<TeamAgentAccess, string>;

/**
 * Team settings → Outside agents, as on the web: how members' AI agents may
 * use the team's data. Owners and admins choose (each member's role, read
 * and suggest, read only, or off) and see whose agents can reach the team,
 * by name and app only. Everyone else sees the policy.
 */
export function TeamAgents({
  teamId,
  teamName,
  canManage,
  busy,
  act,
}: {
  teamId: string;
  teamName: string;
  canManage: boolean;
  busy: boolean;
  act: Act;
}) {
  const [data, setData] = useState<TeamAgentsView | null>(null);
  const load = useCallback(
    () => act(async () => setData(await client.teamAgents(teamId))),
    [act, teamId],
  );
  useEffect(() => {
    void load();
    // Once per team; `act` is recreated every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamId]);

  if (!data) return null;
  const label = TEAM_AGENT_ACCESS_LABELS[data.agent_access];
  const change = (agent_access: TeamAgentAccess) => {
    if (agent_access === data.agent_access) return;
    void act(async () => {
      await client.setTeamAgentAccess(teamId, agent_access);
      setData(await client.teamAgents(teamId));
    });
  };

  return (
    <View style={s.wrap}>
      <Text style={shared.sectionTitle}>Outside agents</Text>
      {canManage && (
        <Segmented
          accessibilityLabel={`Outside agents in ${teamName}`}
          options={TEAM_AGENT_ACCESS}
          labels={NAMES}
          wrap
          disabled={busy}
          value={data.agent_access}
          onChange={change}
        />
      )}
      <Text style={[shared.small, s.lead]}>
        {canManage ? "" : `${label.name}. `}
        {label.blurb} AI agents members connect (like Claude or ChatGPT) never
        see more than their person.
        {data.first_used_at
          ? ` An agent first used ${teamName} ${timeAgo(data.first_used_at)}.`
          : ""}
      </Text>
      {data.connections &&
        (data.connections.length ? (
          <View style={s.list}>
            {data.connections.map((c, n) => (
              <View
                key={`${c.member}-${c.app}-${n}`}
                style={[s.row, n > 0 && s.divider]}
              >
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={s.member} numberOfLines={1}>
                    {c.member}
                  </Text>
                  <Text style={shared.small} numberOfLines={1}>
                    {c.app}
                  </Text>
                </View>
                <Text style={shared.small}>
                  {c.last_used_at
                    ? `Used ${timeAgo(c.last_used_at)}`
                    : "Not used yet"}
                </Text>
              </View>
            ))}
          </View>
        ) : (
          <Text style={[shared.small, s.lead]}>
            No member has connected an agent that can reach this team.
          </Text>
        ))}
    </View>
  );
}

const s = themed(() =>
  StyleSheet.create({
    wrap: { gap: 10, marginTop: 8, marginBottom: 16 },
    lead: { lineHeight: 19 },
    list: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radii.card,
      overflow: "hidden",
    },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      paddingVertical: 12,
      paddingHorizontal: 16,
    },
    divider: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
    },
    member: {
      fontFamily: fonts.semibold,
      fontSize: 15,
      color: colors.text,
    },
  }),
);
