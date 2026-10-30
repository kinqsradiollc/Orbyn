import React, { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { AGENT_ACCESS_LABELS, AGENT_TRUST_LABELS } from "@orbyn/core";
import { client } from "../../lib/api";
import { session } from "../../lib/session";
import { SmallAction } from "../../components/SmallAction";
import { ManagedAiUsage } from "./ManagedAiUsage";
import { ChatgptUsage } from "./ChatgptUsage";
import { shared } from "../../styles";
import { colors, themed } from "../../theme";

type Overview = {
  identity: string;
  capability?: Awaited<ReturnType<typeof client.aiCapabilities>>;
  provider?: Awaited<ReturnType<typeof client.aiProviderChoice>>;
  profiles?: Awaited<ReturnType<typeof client.assistantProfiles>>;
  grants?: Awaited<ReturnType<typeof client.agents>>["grants"];
  failed: string[];
};

/** Route, permissions and recorded runtime evidence remain separate settings owners. */
export function AiConnectionsOverview({
  userId,
  visible = true,
  onProviders,
  onAccess,
  onRules,
  onLimits,
  onOpenActivity,
}: {
  userId: string;
  visible?: boolean;
  onProviders: () => void;
  onAccess: () => void;
  onRules: () => void;
  onLimits: () => void;
  onOpenActivity?: (lane: "background" | "overnight") => void;
}) {
  const token = session.token;
  const generation = session.generation;
  const identity = `${generation}:${userId}:${token}`;
  const [read, setRead] = useState<Overview | null>(null);
  const [retry, setRetry] = useState(0);
  const data = read?.identity === identity ? read : null;
  useEffect(() => {
    if (!visible || !token || !userId) return;
    let live = true;
    const abort = new AbortController();
    setRead(null);
    void Promise.allSettled([
      client.aiCapabilities(),
      client.aiProviderChoice(abort.signal),
      client.assistantProfiles(abort.signal),
      client.agents(),
    ]).then(([capability, provider, profiles, agents]) => {
      if (!live || session.token !== token || session.generation !== generation)
        return;
      setRead({
        identity,
        ...(capability.status === "fulfilled"
          ? { capability: capability.value }
          : {}),
        ...(provider.status === "fulfilled"
          ? { provider: provider.value }
          : {}),
        ...(profiles.status === "fulfilled"
          ? { profiles: profiles.value }
          : {}),
        ...(agents.status === "fulfilled"
          ? { grants: agents.value.grants }
          : {}),
        failed: [
          capability.status === "rejected" && "request configuration",
          provider.status === "rejected" && "provider choice",
          profiles.status === "rejected" && "agent activity",
          agents.status === "rejected" && "connection permissions",
        ].filter((value): value is string => !!value),
      });
    });
    return () => {
      live = false;
      abort.abort();
    };
  }, [identity, retry, visible]);
  const external = data?.grants?.filter((grant) => grant.kind !== "assistant");
  const route = data?.provider
    ? data.provider.primary === "chatgpt"
      ? "Personal ChatGPT"
      : "Orbyn default"
    : data
      ? "Provider choice unavailable"
      : "Loading…";
  return (
    <View style={s.overview}>
      <View style={s.row}>
        <Text style={shared.sectionTitle} accessibilityRole="header">
          AI &amp; connections
        </Text>
        <SmallAction
          quiet
          label={data?.failed.length ? "Retry overview" : "Refresh overview"}
          disabled={!data}
          onPress={() => setRetry((value) => value + 1)}
        />
      </View>
      {!data && (
        <Text style={shared.body} accessibilityLiveRegion="polite">
          Loading AI and connections…
        </Text>
      )}
      {!!data?.failed.length && (
        <Text style={shared.body} accessibilityRole="alert">
          Couldn’t load {data.failed.join(", ")}. Retry to refresh.
        </Text>
      )}
      <View style={s.group}>
        <Text style={shared.body}>Selected provider route</Text>
        <Text style={shared.body}>{route}</Text>
        {data?.capability && (
          <Text style={shared.small}>
            {data.capability.enabled
              ? "Configured for requests"
              : "Setup needed"}
          </Text>
        )}
        {data?.provider?.primary === "chatgpt" && (
          <Text style={shared.small}>
            Default fallback{" "}
            {data.provider.fallback_to_default ? "enabled" : "off"}
          </Text>
        )}
        <Text style={shared.small}>
          Live availability is checked when a run starts.
        </Text>
        <SmallAction
          quiet
          label="Providers & models"
          disabled={false}
          onPress={onProviders}
        />
      </View>
      <View style={s.group}>
        <Text style={shared.body}>External access</Text>
        <Text style={shared.small}>
          Saved grants remain subject to team limits and action rules.
        </Text>
        <Text style={shared.small}>
          {external
            ? `${external.length} saved ${external.length === 1 ? "connection" : "connections"}`
            : data
              ? "Connection permissions unavailable"
              : "Loading…"}
        </Text>
        {external?.slice(0, 3).map((grant) => (
          <View key={grant.id} style={{ gap: 4 }}>
            <Text style={shared.body}>
              {grant.name || grant.client_name || "Connected agent"}
            </Text>
            <Text style={shared.small}>
              {AGENT_ACCESS_LABELS[grant.access].name} ·{" "}
              {AGENT_TRUST_LABELS[grant.trust].name}
              {grant.suspended_at
                ? " · Paused"
                : grant.reconnect_required
                  ? " · Reconnect required"
                  : grant.expires_at &&
                      Date.parse(grant.expires_at) <= Date.now()
                    ? " · Expired"
                    : ""}
            </Text>
            <Text style={shared.small}>
              {[
                grant.personal && "Personal",
                ...(grant.team_ids === null
                  ? ["Teams you can access"]
                  : grant.teams.map((team) => team.name)),
              ]
                .filter(Boolean)
                .join(" · ") || "No spaces selected"}
            </Text>
          </View>
        ))}
        <SmallAction
          quiet
          label="Manage access"
          disabled={false}
          onPress={onAccess}
        />
      </View>
      <View style={s.group}>
        <Text style={shared.body}>Background &amp; Overnight</Text>
        {data?.profiles ? (
          <>
            {data.profiles.profiles.map((profile) => (
              <View key={profile.lane} style={{ gap: 4 }}>
                <Text style={shared.body}>
                  {profile.lane === "background" ? "Background" : "Overnight"}
                </Text>
                <Text style={shared.small}>
                  {profile.counts.working} running · {profile.counts.waiting}{" "}
                  waiting · {profile.counts.queued} queued
                  {profile.counts.recovering
                    ? ` · ${profile.counts.recovering} recovering`
                    : ""}
                </Text>
                {!profile.runtime.reporting && (
                  <Text style={shared.small}>Worker heartbeat unavailable</Text>
                )}
                {onOpenActivity && (
                  <SmallAction
                    quiet
                    label={`View ${profile.lane === "background" ? "Background" : "Overnight"} activity`}
                    disabled={false}
                    onPress={() => onOpenActivity(profile.lane)}
                  />
                )}
              </View>
            ))}
            <Text style={shared.small}>
              Observed {new Date(data.profiles.observed_at).toLocaleString()}
            </Text>
          </>
        ) : (
          <Text style={shared.small}>
            {data ? "Agent activity unavailable" : "Loading…"}
          </Text>
        )}
        <View style={s.row}>
          <SmallAction
            quiet
            label="Action permissions"
            disabled={false}
            onPress={onRules}
          />
          <SmallAction
            quiet
            label="Work limits"
            disabled={false}
            onPress={onLimits}
          />
        </View>
      </View>
      <View style={s.group}>
        <Text style={shared.body}>Usage recorded by Orbyn</Text>
        <ManagedAiUsage userId={userId} />
        <ChatgptUsage userId={userId} />
      </View>
    </View>
  );
}
const s = themed(() =>
  StyleSheet.create({
    overview: { gap: 12, marginBottom: 16 },
    group: {
      gap: 8,
      paddingVertical: 12,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    row: {
      flexDirection: "row",
      flexWrap: "wrap",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 8,
    },
  }),
);
