import React, { useEffect, useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import type { AssistantBudgetView } from "@orbyn/core";
import { Button } from "../../components/Button";
import { SmallAction } from "../../components/SmallAction";
import { Pressable } from "../../motion";
import { client } from "../../lib/api";
import { colors, fonts, radii, themed } from "../../theme";
import { shared } from "../../styles";
import { SettingsSection } from "./SettingsSection";

type Lane = "background" | "overnight";
type Budgets = Record<Lane, AssistantBudgetView>;
type Draft = Record<
  "daily_token_limit" | "hourly_start_limit" | "per_run_token_limit",
  string
>;
const limits: { key: keyof Draft; label: string; min: number; max: number }[] =
  [
    {
      key: "daily_token_limit",
      label: "Daily tokens",
      min: 1000,
      max: 10_000_000,
    },
    { key: "hourly_start_limit", label: "Starts per hour", min: 1, max: 100 },
    {
      key: "per_run_token_limit",
      label: "Tokens per run",
      min: 1000,
      max: 200_000,
    },
  ];
const draftOf = (value: AssistantBudgetView): Draft => ({
  daily_token_limit: String(value.daily_token_limit),
  hourly_start_limit: String(value.hourly_start_limit),
  per_run_token_limit: String(value.per_run_token_limit),
});

export function AssistantBudgetSection({ userId }: { userId: string }) {
  const [budgets, setBudgets] = useState<Budgets | null>(null);
  const [lane, setLane] = useState<Lane>("background");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  useEffect(() => {
    let live = true;
    setBudgets(null);
    if (userId)
      void client.assistantBudgets().then(
        (value) => {
          if (live) setBudgets(value);
        },
        () => {
          if (live) setError("Couldn't load limits.");
        },
      );
    return () => {
      live = false;
    };
  }, [userId]);
  const current = budgets?.[lane];
  const save = async () => {
    if (!current || !draft || busy) return;
    const values = Object.fromEntries(
      limits.map(({ key }) => [key, Number(draft[key])]),
    ) as Record<keyof Draft, number>;
    if (
      limits.some(
        ({ key, min, max }) =>
          !Number.isInteger(values[key]) ||
          values[key] < min ||
          values[key] > max,
      )
    ) {
      setError("Check the limit values.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const next = await client.replaceAssistantBudget(lane, {
        revision: current.revision,
        ...values,
      });
      setBudgets((before) => before && { ...before, [lane]: next });
      setDraft(null);
      setNotice("Limits saved");
    } catch {
      setError("Couldn't save limits. Reload if they changed elsewhere.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <SettingsSection title="Work limits">
      <View style={s.lanes}>
        {(["background", "overnight"] as const).map((option) => (
          <Pressable
            key={option}
            accessibilityRole="button"
            accessibilityState={{ selected: option === lane }}
            onPress={() => {
              setLane(option);
              setDraft(null);
              setError("");
              setNotice("");
            }}
            style={[s.lane, lane === option && s.selected]}
          >
            <Text style={s.laneText}>
              {option === "background" ? "Background" : "Overnight"}
            </Text>
          </Pressable>
        ))}
      </View>
      {current ? (
        <>
          <Text style={shared.small}>
            {current.estimated_tokens.toLocaleString()} /{" "}
            {current.daily_token_limit.toLocaleString()} estimated tokens today
          </Text>
          <Text style={shared.small}>
            {current.starts_last_hour} / {current.hourly_start_limit} starts
            this hour
          </Text>
          {draft ? (
            <>
              {limits.map(({ key, label }) => (
                <View key={key} style={s.field}>
                  <Text style={s.label}>{label}</Text>
                  <TextInput
                    accessibilityLabel={label}
                    keyboardType="number-pad"
                    maxLength={8}
                    value={draft[key]}
                    editable={!busy}
                    style={s.input}
                    onChangeText={(value) =>
                      setDraft(
                        (before) => before && { ...before, [key]: value },
                      )
                    }
                  />
                </View>
              ))}
              <View style={s.actions}>
                <SmallAction
                  label={busy ? "Saving…" : "Save limits"}
                  disabled={busy}
                  onPress={() => void save()}
                />
                <SmallAction
                  label="Cancel"
                  disabled={busy}
                  onPress={() => setDraft(null)}
                />
              </View>
            </>
          ) : (
            <Button
              title="Edit limits"
              secondary
              onPress={() => setDraft(draftOf(current))}
            />
          )}
        </>
      ) : (
        <Text style={shared.small}>{error || "Loading limits…"}</Text>
      )}
      {!!error && current && (
        <Text accessibilityRole="alert" style={s.error}>
          {error}
        </Text>
      )}
      {!!notice && (
        <Text accessibilityLiveRegion="polite" style={shared.small}>
          {notice}
        </Text>
      )}
    </SettingsSection>
  );
}

const s = themed(() =>
  StyleSheet.create({
    lanes: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    lane: {
      minHeight: 44,
      paddingHorizontal: 12,
      justifyContent: "center",
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radii.input,
    },
    selected: {
      borderColor: colors.accent,
      backgroundColor: colors.surfaceMuted,
    },
    laneText: { color: colors.text, fontFamily: fonts.medium, fontSize: 14 },
    field: { gap: 6 },
    label: { color: colors.text, fontFamily: fonts.medium, fontSize: 14 },
    input: {
      minHeight: 44,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radii.input,
      paddingHorizontal: 12,
      color: colors.text,
      fontSize: 15,
    },
    actions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    error: { color: colors.danger, fontFamily: fonts.medium },
  }),
);
