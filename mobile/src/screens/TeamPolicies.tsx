import React, { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { TEAM_POLICY_TEXT, type TeamPolicies as Policies } from "@orbyn/core";
import { Switch } from "../components/Switch";
import { client } from "../lib/api";
import { errorText } from "../lib/errors";
import { shared } from "../styles";
import { colors, fonts, themed } from "../theme";

/**
 * A team's switches (OTH-04) on the phone: publishing its pages to the web,
 * the assistant on its pages, and its booking pages for people outside.
 * Everyone in the team sees them; owners and admins change them.
 */
export function TeamPolicies({ teamId }: { teamId: string }) {
  const [state, setState] = useState<Policies | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    client.getTeamPolicies(teamId).then(setState, () => setState(null));
  }, [teamId]);
  if (!state) return null;
  const change = (key: "publishing" | "assistant" | "booking", on: boolean) => {
    const was = state;
    setState({ ...state, [key]: on });
    client.setTeamPolicies(teamId, { [key]: on }).then(
      (next) => {
        setError("");
        setState(next);
      },
      (e) => {
        setError(errorText(e));
        setState(was);
      },
    );
  };
  return (
    <View style={shared.card}>
      <Text style={shared.sectionTitle}>Team switches</Text>
      {(["publishing", "assistant", "booking"] as const).map((key) => (
        <View key={key} style={s.row}>
          <View style={s.text}>
            <Text style={s.title}>{TEAM_POLICY_TEXT[key].label}</Text>
            <Text style={s.hint}>{TEAM_POLICY_TEXT[key].hint}</Text>
          </View>
          <Switch
            value={state[key]}
            disabled={!state.can_change}
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
    text: { flex: 1, gap: 2 },
    title: { fontFamily: fonts.medium, fontSize: 15, color: colors.text },
    hint: { fontFamily: fonts.regular, fontSize: 13, color: colors.muted },
    error: { fontFamily: fonts.regular, fontSize: 13, color: colors.danger },
  }),
);
