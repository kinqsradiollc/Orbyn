import React, { useCallback, useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import type { ReminderNudgeSettings } from "@orbyn/core";
import { client } from "../lib/api";
import { Button } from "../components/Button";
import { Switch } from "../components/Switch";
import { Field } from "../components/Field";
import { ErrorBanner } from "../components/ErrorBanner";
import { InlineDetails } from "../components/InlineDetails";
import { DateTimeControl } from "../components/DateTimeControl";
import { shared } from "../styles";
import { colors } from "../theme";

/** The phone's personal reminder channels and quiet window. */
export function ReminderNudges({
  busy,
  run,
}: {
  busy: boolean;
  run: (fn: () => Promise<void>) => Promise<unknown>;
}) {
  const [value, setValue] = useState<ReminderNudgeSettings | null>(null);
  const [picking, setPicking] = useState<"quiet_start" | "quiet_end" | null>(
    null,
  );
  const mounted = useRef(true);
  const request = useRef(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    const epoch = ++request.current;
    setLoading(true);
    try {
      const next = await client.reminderNudgeSettings();
      if (!mounted.current || epoch !== request.current) return;
      setValue(next);
      setError("");
    } catch {
      if (mounted.current && epoch === request.current)
        setError("Couldn't load reminders.");
    } finally {
      if (mounted.current && epoch === request.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    mounted.current = true;
    void load();
    return () => {
      mounted.current = false;
      ++request.current;
    };
  }, [load]);
  if (!value)
    return (
      <View style={shared.card}>
        <Text style={shared.label}>Reminders</Text>
        <ErrorBanner error={error} />
        {loading ? (
          <Text style={shared.small}>Loading reminders…</Text>
        ) : (
          <Button
            title="Retry reminders"
            secondary
            disabled={busy}
            onPress={() => void load()}
          />
        )}
      </View>
    );
  const date = new Date();
  if (picking) {
    const [hours, minutes] = value[picking].split(":").map(Number);
    date.setHours(hours, minutes, 0, 0);
  }
  return (
    <View style={shared.card}>
      <Text style={shared.label}>Reminders</Text>
      <Text style={shared.small}>Up to three reminders a day.</Text>
      {(["enabled", "chat", "push", "email"] as const).map((key) => {
        const label = {
          enabled: "Send reminders",
          chat: "Private chat",
          push: "Push",
          email: "Email",
        }[key];
        return (
          <View
            key={key}
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              minHeight: 44,
            }}
          >
            <Text style={[shared.small, { flex: 1 }]}>{label}</Text>
            <Switch
              accessibilityLabel={label}
              value={value[key]}
              disabled={busy}
              trackColor={{ true: colors.accent }}
              onValueChange={(enabled) =>
                setValue({ ...value, [key]: enabled })
              }
            />
          </View>
        );
      })}
      {(["quiet_start", "quiet_end"] as const).map((key) => (
        <Field
          label={
            key === "quiet_start" ? "Quiet hours start" : "Quiet hours end"
          }
          key={key}
        >
          <Button
            title={value[key]}
            disabled={busy}
            onPress={() => setPicking(key)}
          />
        </Field>
      ))}
      {picking && (
        <DateTimeControl
          mode="time"
          value={date}
          onChange={(event, chosen) => {
            if (!busy && chosen && event.type === "set")
              setValue({
                ...value,
                [picking]: `${String(chosen.getHours()).padStart(2, "0")}:${String(chosen.getMinutes()).padStart(2, "0")}`,
              });
            setPicking(null);
          }}
        />
      )}
      <Text style={shared.small}>Quiet hours use your planning time zone.</Text>
      <InlineDetails title="Reminder delivery">
        <Text style={shared.small}>
          Email covers overdue work and underbooked deadlines. Each item can
          prompt once in 24 hours. Stop an item's reminders from its Reminders
          chat card. No AI request is made.
        </Text>
      </InlineDetails>
      <Button
        title="Save reminders"
        disabled={busy}
        onPress={() =>
          void run(async () => {
            const next = await client.updateReminderNudgeSettings(value);
            if (mounted.current) setValue(next);
          })
        }
      />
    </View>
  );
}
