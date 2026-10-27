import React, { useCallback, useEffect, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import {
  TEAM_AGENT_ACCESS,
  TEAM_AGENT_ACCESS_LABELS,
  type TeamAgentAccess,
  type TeamAgentsView,
} from "@orbyn/core";
import { InlineDetails } from "../../components/InlineDetails";
import { Segmented } from "../../components/Segmented";
import { Button } from "../../components/Button";
import { session } from "../../lib/session";
import { errorText } from "../../lib/errors";
import { client } from "../../lib/api";
import { timeAgo } from "../progress/progress";
import { colors, fonts, radii, themed } from "../../theme";
import { shared } from "../../styles";

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
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const alive = useRef(true);
  const owner = useRef(session.token).current;
  const request = useRef(0);
  const current = () => alive.current && session.token === owner;
  const load = useCallback(async () => {
    const ticket = ++request.current;
    setLoading(true);
    setError("");
    try {
      const next = await client.teamAgents(teamId);
      if (current() && ticket === request.current) setData(next);
    } catch (e) {
      if (current() && ticket === request.current) setError(errorText(e));
    } finally {
      if (current() && ticket === request.current) setLoading(false);
    }
  }, [teamId]);
  useEffect(() => {
    alive.current = true;
    setData(null);
    void load();
    return () => {
      alive.current = false;
      request.current++;
    };
  }, [load]);
  if (!data)
    return (
      <View style={s.wrap}>
        <Text style={shared.small}>{error || "Loading agent access…"}</Text>
        {!!error && (
          <Button secondary title="Retry" onPress={() => void load()} />
        )}
      </View>
    );
  const label = TEAM_AGENT_ACCESS_LABELS[data.agent_access];
  const change = (agent_access: TeamAgentAccess) => {
    if (
      !canManage ||
      busy ||
      loading ||
      !current() ||
      agent_access === data.agent_access
    )
      return;
    void act(async () => {
      await client.setTeamAgentAccess(teamId, agent_access);
      if (!current()) return;
      request.current++;
      setData((previous) =>
        previous ? { ...previous, agent_access } : previous,
      );
      await load();
    });
  };

  return (
    <View style={s.wrap}>
      <Text style={shared.sectionTitle}>Outside agents</Text>
      {!!error && (
        <View>
          <Text accessibilityRole="alert" style={shared.small}>
            {error}
          </Text>
          <Button
            secondary
            title="Retry"
            disabled={busy || loading}
            onPress={() => void load()}
          />
        </View>
      )}
      {canManage && (
        <Segmented
          accessibilityLabel={`Outside agents in ${teamName}`}
          options={TEAM_AGENT_ACCESS}
          labels={NAMES}
          wrap
          disabled={busy || loading || !!error}
          value={data.agent_access}
          onChange={change}
        />
      )}
      <Text style={[shared.small, s.lead]}>
        {canManage ? "" : `${label.name}. `}
        {label.blurb}
      </Text>
      <InlineDetails title="Agent access details">
        <Text style={shared.small}>
          Agents never see more than the member who connected them.
        </Text>
        {data.first_used_at && (
          <Text style={shared.small}>
            First used {timeAgo(data.first_used_at)}.
          </Text>
        )}
      </InlineDetails>
      {data.connections &&
        (data.connections.length ? (
          <View style={s.list}>
            {data.connections.map((c, n) => (
              <View
                key={`${c.member}-${c.app}-${n}`}
                style={[s.row, n > 0 && s.divider]}
              >
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={s.member}>{c.member}</Text>
                  <Text style={shared.small}>{c.app}</Text>
                </View>
                <Text style={[shared.small, { flexShrink: 1 }]}>
                  {c.last_used_at
                    ? `Used ${timeAgo(c.last_used_at)}`
                    : "Not used yet"}
                </Text>
              </View>
            ))}
          </View>
        ) : (
          <Text style={[shared.small, s.lead]}>
            No connected agents can access this team.
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
