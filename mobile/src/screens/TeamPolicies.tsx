import React, { useCallback, useEffect, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { TEAM_POLICY_TEXT, type TeamPolicies as Policies } from "@orbyn/core";
import { Switch } from "../components/Switch";
import { Button } from "../components/Button";
import { session } from "../lib/session";
import { client } from "../lib/api";
import { errorText } from "../lib/errors";
import { shared } from "../styles";
import { colors, fonts, themed } from "../theme";

/**
 * A team's switches (OTH-04) on the phone: publishing its pages to the web,
 * the assistant on its pages, and its booking pages for people outside.
 * Everyone in the team sees them; owners and admins change them.
 */
export function TeamPolicies({
  teamId,
  busy,
  act,
}: {
  teamId: string;
  busy: boolean;
  act: (fn: () => Promise<void>) => Promise<void>;
}) {
  const [state, setState] = useState<Policies | null>(null);
  const [error, setError] = useState("");
  const alive = useRef(true);
  const owner = useRef(session.token).current;
  const request = useRef(0);
  const current = () => alive.current && session.token === owner;
  const load = useCallback(async () => {
    const ticket = ++request.current;
    setError("");
    try {
      const next = await client.getTeamPolicies(teamId);
      if (current() && ticket === request.current) setState(next);
    } catch (e) {
      if (current() && ticket === request.current) setError(errorText(e));
    }
  }, [teamId]);
  useEffect(() => {
    alive.current = true;
    setState(null);
    void load();
    return () => {
      alive.current = false;
      request.current++;
    };
  }, [load]);
  if (!state)
    return (
      <View style={s.section}>
        <Text style={shared.small}>{error || "Loading team permissions…"}</Text>
        {!!error && (
          <Button secondary title="Retry" onPress={() => void load()} />
        )}
      </View>
    );
  const change = (key: "publishing" | "assistant" | "booking", on: boolean) => {
    if (busy || !state.can_change || !current()) return;
    void act(async () => {
      const next = await client.setTeamPolicies(teamId, { [key]: on });
      if (current()) {
        request.current++;
        setError("");
        setState(next);
      }
    });
  };
  return (
    <View style={s.section}>
      <Text style={shared.sectionTitle}>Team permissions</Text>
      {(["publishing", "assistant", "booking"] as const).map((key) => (
        <View key={key} style={s.row}>
          <View style={s.text}>
            <Text style={s.title}>{TEAM_POLICY_TEXT[key].label}</Text>
            <Text style={s.hint}>{TEAM_POLICY_TEXT[key].hint}</Text>
          </View>
          <Switch
            value={state[key]}
            disabled={!state.can_change || busy}
            trackColor={{ true: colors.accent }}
            accessibilityLabel={TEAM_POLICY_TEXT[key].label}
            onValueChange={(on) => change(key, on)}
          />
        </View>
      ))}
      {!state.can_change && (
        <Text style={s.hint}>Owners and admins can change these.</Text>
      )}
      {error ? (
        <Text style={s.error} accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
    </View>
  );
}

const s = themed(() =>
  StyleSheet.create({
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      paddingVertical: 10,
    },
    section: { paddingVertical: 12, gap: 4 },
    text: { flex: 1, minWidth: 0, gap: 2 },
    title: { fontFamily: fonts.medium, fontSize: 15, color: colors.text },
    hint: { fontFamily: fonts.regular, fontSize: 13, color: colors.muted },
    error: { fontFamily: fonts.regular, fontSize: 13, color: colors.danger },
  }),
);
